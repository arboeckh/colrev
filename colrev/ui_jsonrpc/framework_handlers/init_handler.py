"""Framework-native init handler.

Implements the no-project methods that manage project directories:
``init_project``, ``list_projects`` and ``delete_project``. These don't
receive a ReviewManager; they operate on the ``base_path`` directory tree.

Response shapes match the legacy handlers exactly — the frontend parses
``{success, project_id, path, review_type, message}`` for init,
``{success, projects: [...]}`` for list, and
``{success, message, project_id}`` for delete.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import List
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

import colrev.ops.init
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import NoProjectRequest
from colrev.ui_jsonrpc.framework import SuccessResponse
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


def _ensure_main_branch(target_path: Path) -> None:
    """Rename the initial branch to ``main`` if git created it as something else.

    Packaged-app environments resolve to dugite's bundled git, which has no
    user config, so ``init.defaultBranch`` is unset and ``git init`` defaults
    to ``master``. ``git branch -M main`` force-renames the current branch
    and atomically updates ``HEAD``; it's idempotent on a repo already on
    ``main``. Uses subprocess directly (not gitpython) — gitpython's
    ``Head.rename`` was observed leaving ``.git/HEAD`` dangling at
    ``refs/heads/master`` after the ref had been renamed away, which broke
    downstream ``git push`` with ``src refspec master does not match any``.
    """
    result = subprocess.run(
        ["git", "branch", "-M", "main"],
        cwd=str(target_path),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        logger.warning(
            "Branch normalize to main failed at %s: %s",
            target_path,
            result.stderr.strip(),
        )


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class InitProjectRequest(NoProjectRequest):
    project_id: str
    title: Optional[str] = None
    review_type: str = "colrev.literature_review"
    example: bool = False
    force_mode: bool = True
    light: bool = True
    base_path: str = "./projects"


class InitProjectResponse(SuccessResponse):
    project_id: str
    path: str
    review_type: str
    message: str


class ListProjectsRequest(NoProjectRequest):
    base_path: str = "./projects"


class ProjectListItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    path: str
    title: str


class ListProjectsResponse(SuccessResponse):
    projects: List[ProjectListItem]


class DeleteProjectRequest(NoProjectRequest):
    project_id: str
    base_path: str = "./projects"


class DeleteProjectResponse(SuccessResponse):
    message: str
    project_id: str


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class InitHandler(BaseHandler):
    """Project lifecycle endpoints (no ReviewManager)."""

    @rpc_method(
        name="init_project",
        request=InitProjectRequest,
        response=InitProjectResponse,
        requires_project=False,
        writes=True,
    )
    def init_project(self, req: InitProjectRequest) -> InitProjectResponse:
        # Reuse validation/sanitization helpers for path traversal protection.
        params = {"project_id": req.project_id, "base_path": req.base_path}
        target_path = validation.validate_project_path(params)
        project_id = validation.sanitize_project_id(req.project_id)
        title = req.title if req.title else project_id

        logger.info("Initializing project %s at %s", project_id, target_path)

        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.mkdir(parents=True, exist_ok=True)
        target_path = target_path.resolve()

        original_cwd = os.getcwd()
        try:
            colrev.ops.init.Initializer(
                review_type=req.review_type,
                target_path=target_path,
                example=req.example,
                force_mode=req.force_mode,
                light=req.light,
                exact_call=f"jsonrpc:init_project:{project_id}",
            )

            logger.info("Project %s initialized successfully", project_id)

            _ensure_main_branch(target_path)

            settings_path = target_path / "settings.json"
            if settings_path.exists() and title != project_id:
                with open(settings_path) as f:
                    settings = json.load(f)
                settings["project"]["title"] = title
                with open(settings_path, "w") as f:
                    json.dump(settings, f, indent=4)

                subprocess.run(
                    ["git", "add", "settings.json"],
                    cwd=str(target_path),
                    capture_output=True,
                )
                subprocess.run(
                    ["git", "commit", "-m", "Set project title"],
                    cwd=str(target_path),
                    capture_output=True,
                )

            return InitProjectResponse(
                project_id=project_id,
                path=str(target_path.resolve()),
                review_type=req.review_type,
                message=f"Project initialized successfully at {target_path}",
            )

        except Exception as e:
            logger.exception("Failed to initialize project %s", project_id)
            raise ValueError(f"Failed to initialize project: {str(e)}") from e
        finally:
            os.chdir(original_cwd)

    @rpc_method(
        name="list_projects",
        request=ListProjectsRequest,
        response=ListProjectsResponse,
        requires_project=False,
        writes=False,
    )
    def list_projects(self, req: ListProjectsRequest) -> ListProjectsResponse:
        base_path = Path(req.base_path)
        logger.info("Listing projects in %s", base_path)

        projects: List[ProjectListItem] = []

        if not base_path.exists():
            logger.info("Base path %s does not exist, returning empty list", base_path)
            return ListProjectsResponse(projects=projects)

        for item in base_path.iterdir():
            if not item.is_dir():
                continue

            settings_file = item / "settings.json"
            if not settings_file.exists():
                continue

            project_id = item.name
            title = project_id
            try:
                with open(settings_file) as f:
                    settings = json.load(f)
                title = settings.get("project", {}).get("title", project_id)
            except (json.JSONDecodeError, KeyError):
                pass

            projects.append(
                ProjectListItem(
                    id=project_id,
                    path=str(item.resolve()),
                    title=title,
                )
            )
            logger.debug("Found project: %s", project_id)

        logger.info("Found %d projects", len(projects))
        return ListProjectsResponse(projects=projects)

    @rpc_method(
        name="delete_project",
        request=DeleteProjectRequest,
        response=DeleteProjectResponse,
        requires_project=False,
        writes=True,
    )
    def delete_project(self, req: DeleteProjectRequest) -> DeleteProjectResponse:
        project_id = req.project_id
        base_path = Path(req.base_path)
        project_path = base_path / project_id

        logger.info("Deleting project %s at %s", project_id, project_path)

        if not project_path.exists():
            raise ValueError(f"Project '{project_id}' does not exist")

        settings_file = project_path / "settings.json"
        if not settings_file.exists():
            raise ValueError(f"'{project_id}' is not a valid CoLRev project")

        try:
            shutil.rmtree(project_path)
            logger.info("Project %s deleted successfully", project_id)
            return DeleteProjectResponse(
                message=f"Project '{project_id}' deleted successfully",
                project_id=project_id,
            )
        except Exception as e:
            logger.exception("Failed to delete project %s", project_id)
            raise ValueError(f"Failed to delete project: {str(e)}") from e
