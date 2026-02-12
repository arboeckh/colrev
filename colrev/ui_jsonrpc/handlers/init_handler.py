"""Handler for project initialization operations."""

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List

import colrev.ops.init
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class InitHandler:
    """Handle init-related JSON-RPC methods."""

    @staticmethod
    def init_project(params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Initialize a CoLRev project with full data quality features.

        Expected params:
            project_id (str): Unique identifier for the project
            review_type (str, optional): Type of review (default: colrev.literature_review)
            example (bool, optional): Include example records (default: False)
            force_mode (bool, optional): Force initialization (default: True)
            light (bool, optional): Light mode without Docker (default: True for JSON-RPC)
            base_path (str, optional): Base path for projects (default: ./projects)

        Args:
            params: Method parameters

        Returns:
            Success response with project details

        Raises:
            ValueError: If project_id is missing or initialization fails

        Note:
            Pre-commit hooks are automatically installed for data quality validation.
        """
        # Validate and get project path (uses sanitized ID for folder name)
        target_path = validation.validate_project_path(params)
        project_id = validation.sanitize_project_id(params["project_id"])
        title = params.get("title", project_id)

        # Get optional parameters
        review_type = validation.get_optional_param(
            params, "review_type", "colrev.literature_review"
        )
        example = validation.get_optional_param(params, "example", False)
        force_mode = validation.get_optional_param(params, "force_mode", True)
        light = validation.get_optional_param(
            params, "light", True
        )  # Default to light mode for JSON-RPC

        logger.info(f"Initializing project {project_id} at {target_path}")

        # Create base directory if it doesn't exist
        target_path.parent.mkdir(parents=True, exist_ok=True)

        # Create target directory
        target_path.mkdir(parents=True, exist_ok=True)
        target_path = target_path.resolve()  # Convert to absolute path

        # Save current working directory before initialization
        original_cwd = os.getcwd()

        try:
            # Initialize CoLRev project (this also initializes git repo with pre-commit hooks)
            colrev.ops.init.Initializer(
                review_type=review_type,
                target_path=target_path,
                example=example,
                force_mode=force_mode,
                light=light,
                exact_call=f"jsonrpc:init_project:{project_id}",
            )

            logger.info(f"Project {project_id} initialized successfully")

            # Store the user's readable title in settings.json
            settings_path = target_path / "settings.json"
            if settings_path.exists() and title != project_id:
                with open(settings_path) as f:
                    settings = json.load(f)
                settings["project"]["title"] = title
                with open(settings_path, "w") as f:
                    json.dump(settings, f, indent=4)

            # Format and return response
            return response_formatter.format_init_response(
                project_id=project_id,
                project_path=target_path,
                review_type=review_type,
            )

        except Exception as e:
            logger.exception(f"Failed to initialize project {project_id}")
            raise ValueError(f"Failed to initialize project: {str(e)}")
        finally:
            # Always restore the original working directory
            os.chdir(original_cwd)

    @staticmethod
    def list_projects(params: Dict[str, Any]) -> Dict[str, Any]:
        """
        List all CoLRev projects in the base path.

        Expected params:
            base_path (str, optional): Base path for projects (default: ./projects)

        Args:
            params: Method parameters

        Returns:
            Success response with list of projects

        Note:
            A directory is considered a CoLRev project if it contains
            a settings.json file in the expected location.
        """
        base_path_str = params.get("base_path", "./projects")
        base_path = Path(base_path_str)

        logger.info(f"Listing projects in {base_path}")

        projects: List[Dict[str, Any]] = []

        if not base_path.exists():
            logger.info(f"Base path {base_path} does not exist, returning empty list")
            return {
                "success": True,
                "projects": projects,
            }

        # Scan directories in base_path
        for item in base_path.iterdir():
            if not item.is_dir():
                continue

            # Check if it's a CoLRev project by looking for settings.json
            settings_file = item / "settings.json"
            if settings_file.exists():
                project_id = item.name

                # Read title from settings.json
                title = project_id
                try:
                    with open(settings_file) as f:
                        settings = json.load(f)
                    title = settings.get("project", {}).get("title", project_id)
                except (json.JSONDecodeError, KeyError):
                    pass

                projects.append({
                    "id": project_id,
                    "path": str(item.resolve()),
                    "title": title,
                })
                logger.debug(f"Found project: {project_id}")

        logger.info(f"Found {len(projects)} projects")

        return {
            "success": True,
            "projects": projects,
        }

    @staticmethod
    def delete_project(params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Delete a CoLRev project.

        Expected params:
            project_id (str): Unique identifier for the project
            base_path (str, optional): Base path for projects (default: ./projects)

        Args:
            params: Method parameters

        Returns:
            Success response

        Raises:
            ValueError: If project_id is missing or project doesn't exist
        """
        project_id = params.get("project_id")
        if not project_id:
            raise ValueError("project_id is required")

        base_path_str = params.get("base_path", "./projects")
        base_path = Path(base_path_str)
        project_path = base_path / project_id

        logger.info(f"Deleting project {project_id} at {project_path}")

        if not project_path.exists():
            raise ValueError(f"Project '{project_id}' does not exist")

        # Verify it's a CoLRev project
        settings_file = project_path / "settings.json"
        if not settings_file.exists():
            raise ValueError(f"'{project_id}' is not a valid CoLRev project")

        try:
            # Remove the entire project directory
            shutil.rmtree(project_path)
            logger.info(f"Project {project_id} deleted successfully")

            return {
                "success": True,
                "message": f"Project '{project_id}' deleted successfully",
                "project_id": project_id,
            }

        except Exception as e:
            logger.exception(f"Failed to delete project {project_id}")
            raise ValueError(f"Failed to delete project: {str(e)}")
