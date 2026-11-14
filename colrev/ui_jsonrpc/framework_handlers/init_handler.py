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
import stat
import subprocess
import sys
import uuid
from pathlib import Path
from typing import List
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

import colrev.ops.init
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import portability
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


def _ensure_gitattributes(target_path: Path) -> None:
    """Pin LF line endings for the project's text files, and renormalise them.

    ``* text=auto eol=lf`` makes git store LF whatever the platform's text
    mode wrote (core colrev writes CRLF on Windows), so what a Windows
    collaborator commits is what a Mac one would. ``--renormalize`` converts
    the files the initial commits already hold. Best effort: a project
    without the file still works, the RPC layer writes LF itself.
    """
    try:
        portability.write_gitattributes(target_path)
        for args in (
            ["git", "add", ".gitattributes"],
            ["git", "add", "--renormalize", "."],
            ["git", "commit", "--no-verify", "-m", "Add .gitattributes (LF line endings)"],
        ):
            if args[1] == "commit":
                staged = subprocess.run(
                    ["git", "diff", "--cached", "--quiet"],
                    cwd=str(target_path),
                    capture_output=True,
                )
                if staged.returncode == 0:
                    return
            result = subprocess.run(
                args, cwd=str(target_path), capture_output=True, text=True
            )
            if result.returncode != 0:
                logger.warning(
                    "%s failed at %s: %s",
                    " ".join(args[:2]),
                    target_path,
                    result.stderr.strip(),
                )
                return
    except OSError as exc:
        logger.warning("Could not add .gitattributes at %s: %s", target_path, exc)


# A project being deleted is first renamed to ``<TRASH_PREFIX><id>-<random>``
# (hidden, and never a valid project id: ids hold no dots), then removed.
TRASH_PREFIX = ".colrev-trash-"


def _clear_readonly_and_retry(func, path, _exc) -> None:  # type: ignore[no-untyped-def]
    """``rmtree`` error handler: clear the read-only bit and retry.

    Git writes its objects read-only, which Windows refuses to unlink.
    """
    for target in (os.path.dirname(path), path):
        try:
            os.chmod(target, stat.S_IWRITE | stat.S_IREAD | stat.S_IEXEC)
        except OSError:
            pass
    func(path)


def remove_tree(path: Path) -> None:
    """``shutil.rmtree`` that also removes read-only files (git objects)."""
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_clear_readonly_and_retry)
    else:  # pragma: no cover — onexc is 3.12+
        shutil.rmtree(
            path, onerror=lambda func, p, exc_info: _clear_readonly_and_retry(func, p, exc_info)
        )


def purge_trash(base_path: Path) -> None:
    """Remove what an earlier ``delete_project`` could not (best effort)."""
    if not base_path.is_dir():
        return
    for item in base_path.iterdir():
        if item.name.startswith(TRASH_PREFIX) and item.is_dir():
            try:
                remove_tree(item)
            except OSError as exc:
                logger.warning("Could not remove leftover %s: %s", item, exc)


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
        # Reuse the validation helpers for path traversal protection.
        params = {"project_id": req.project_id, "base_path": req.base_path}
        target_path = validation.validate_project_path(params)
        project_id = req.project_id
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
                with open(settings_path, encoding="utf-8") as f:
                    settings = json.load(f)
                settings["project"]["title"] = title
                with open(settings_path, "w", encoding="utf-8", newline="\n") as f:
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

            _ensure_gitattributes(target_path)

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
        timeout_class="fast",
    )
    def list_projects(self, req: ListProjectsRequest) -> ListProjectsResponse:
        base_path = Path(req.base_path)
        logger.info("Listing projects in %s", base_path)

        projects: List[ProjectListItem] = []

        if not base_path.exists():
            logger.info("Base path %s does not exist, returning empty list", base_path)
            return ListProjectsResponse(projects=projects)

        purge_trash(base_path)
        for item in base_path.iterdir():
            if not item.is_dir() or item.name.startswith(TRASH_PREFIX):
                continue

            settings_file = item / "settings.json"
            if not settings_file.exists():
                continue

            project_id = item.name
            title = project_id
            try:
                with open(settings_file, encoding="utf-8") as f:
                    settings = json.load(f)
                title = settings.get("project", {}).get("title", project_id)
            except (OSError, ValueError, KeyError, AttributeError):
                # One unreadable or malformed settings.json (ValueError covers
                # JSONDecodeError and UnicodeDecodeError) must not fail the list.
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
        # Same rule as every other project call: an id that could leave the
        # base path must never reach rmtree.
        project_id = validation.validate_project_id(req.project_id)
        base_path = Path(req.base_path)
        project_path = base_path / project_id

        logger.info("Deleting project %s at %s", project_id, project_path)

        if not project_path.exists():
            raise ValueError(f"Project '{project_id}' does not exist")

        settings_file = project_path / "settings.json"
        if not settings_file.exists():
            raise ValueError(f"'{project_id}' is not a valid CoLRev project")

        # Close what this process keeps open in the project: Windows cannot
        # delete or rename a directory that holds an open file.
        portability.close_log_handlers(project_path)

        # All or nothing for the user: the rename either takes the whole
        # project out of the list at once or fails and leaves it untouched.
        # A removal that then fails halfway leaves a hidden leftover that is
        # never listed and is removed on the next list/delete.
        trash = base_path / f"{TRASH_PREFIX}{project_id}-{uuid.uuid4().hex[:8]}"
        try:
            os.rename(project_path, trash)
        except OSError as e:
            logger.exception("Failed to delete project %s", project_id)
            raise ValueError(
                f"Failed to delete project: {e}. "
                "Close anything using the project's folder and try again."
            ) from e

        message = f"Project '{project_id}' deleted successfully"
        try:
            remove_tree(trash)
        except OSError:
            logger.exception("Could not remove all files of project %s", project_id)
            message += (
                "; some files could not be removed and will be removed later"
            )
        purge_trash(base_path)
        logger.info("Project %s deleted", project_id)
        return DeleteProjectResponse(message=message, project_id=project_id)
