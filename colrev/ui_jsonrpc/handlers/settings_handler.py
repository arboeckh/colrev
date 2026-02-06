"""Handler for settings operations.

JSON-RPC Endpoints:
    - get_settings: Get current project settings
    - update_settings: Update project settings (partial update)

See docs/source/api/jsonrpc/settings.rst for full endpoint documentation.
"""

import logging
from typing import Any, Dict

import colrev.review_manager
import colrev.settings
from colrev.ui_jsonrpc import response_formatter, validation as param_validation

logger = logging.getLogger(__name__)


class SettingsHandler:
    """Handle settings-related JSON-RPC methods.

    This handler provides endpoints for retrieving and updating project settings.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize settings handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def get_settings(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get current project settings.

        Returns the complete project settings including project metadata,
        search sources, and configuration for all operations.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - settings (dict): Complete project settings with:
                    - project (dict): Project metadata (title, authors, review_type, etc.)
                    - sources (list): Configured search sources
                    - search (dict): Search settings
                    - prep (dict): Preparation settings
                    - dedupe (dict): Deduplication settings
                    - prescreen (dict): Prescreen settings
                    - pdf_get (dict): PDF retrieval settings
                    - pdf_prep (dict): PDF preparation settings
                    - screen (dict): Screening settings
                    - data (dict): Data extraction settings
        """
        project_id = params["project_id"]
        logger.info(f"Getting settings for project {project_id}")

        # Get settings from ReviewManager (Pydantic model)
        settings = self.review_manager.settings

        # Convert to dictionary using Pydantic's model_dump()
        # Note: Don't use mode='json' as it conflicts with custom ExtendedSearchFile serialization
        # The custom model_dump override in Settings handles sources properly
        settings_dict = settings.model_dump()

        # Convert any remaining Enum values to their string representation for JSON serialization
        import json
        from enum import Enum

        def convert_enums(obj):
            """Recursively convert Enum values to strings."""
            if isinstance(obj, dict):
                return {k: convert_enums(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_enums(item) for item in obj]
            elif isinstance(obj, Enum):
                return obj.value
            return obj

        settings_dict = convert_enums(settings_dict)

        return {
            "success": True,
            "project_id": project_id,
            "settings": settings_dict,
        }

    def update_settings(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update project settings (partial update).

        Allows updating specific fields of the project settings without
        requiring the complete settings object. Only the fields provided
        in the settings parameter will be updated.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - settings (dict): Partial settings to update (required)
                    Can include any of: project, search, prep, dedupe,
                    prescreen, pdf_get, pdf_prep, screen, data
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - message (str): Success message
                - updated_fields (list): List of updated top-level fields

        Raises:
            ValueError: If settings parameter is missing or invalid
        """
        project_id = params["project_id"]
        new_settings = params.get("settings")
        skip_commit = param_validation.get_optional_param(
            params, "skip_commit", False
        )

        if not new_settings:
            raise ValueError("settings parameter is required")

        if not isinstance(new_settings, dict):
            raise ValueError("settings must be a dictionary")

        logger.info(f"Updating settings for project {project_id}")

        updated_fields = []
        current_settings = self.review_manager.settings

        # Update project settings
        if "project" in new_settings:
            project_updates = new_settings["project"]
            if isinstance(project_updates, dict):
                for key, value in project_updates.items():
                    if hasattr(current_settings.project, key):
                        setattr(current_settings.project, key, value)
                        updated_fields.append(f"project.{key}")

        # Update operation settings
        operation_fields = [
            "search", "prep", "dedupe", "prescreen",
            "pdf_get", "pdf_prep", "screen", "data"
        ]

        for field in operation_fields:
            if field in new_settings:
                field_updates = new_settings[field]
                if isinstance(field_updates, dict):
                    settings_obj = getattr(current_settings, field)
                    for key, value in field_updates.items():
                        if hasattr(settings_obj, key):
                            setattr(settings_obj, key, value)
                            updated_fields.append(f"{field}.{key}")

        # Save the updated settings
        self.review_manager.save_settings()

        # Create commit if not skipped
        if not skip_commit and updated_fields:
            self.review_manager.create_commit(
                msg=f"Update settings: {', '.join(updated_fields[:3])}{'...' if len(updated_fields) > 3 else ''}",
            )

        return response_formatter.format_operation_response(
            operation_name="update_settings",
            project_id=project_id,
            details={
                "message": f"Updated {len(updated_fields)} setting(s)",
                "updated_fields": updated_fields,
            },
        )
