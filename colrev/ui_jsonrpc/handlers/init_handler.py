"""Handler for project initialization operations."""

import logging
import os
from pathlib import Path
from typing import Any, Dict

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
        # Validate and get project path
        target_path = validation.validate_project_path(params)
        project_id = params["project_id"]

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
