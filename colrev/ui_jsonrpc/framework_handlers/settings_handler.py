"""Framework-native settings handler.

Implements ``get_settings`` and ``update_settings`` atop the typed framework.

Settings are deeply nested Pydantic models (see ``colrev/settings.py``). Rather
than re-type every nested field, the request/response carry the full settings
dict with ``ConfigDict(extra='allow')`` on a thin wrapper. The handler delegates
field-level updates to the existing in-place attribute writes on the loaded
``ProjectSettings`` model.

Writes stage changes via ``save_settings()``; commits are driven explicitly
via the ``commit_changes`` endpoint in ``git_handler``.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any
from typing import Dict
from typing import List

from pydantic import ConfigDict

from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class GetSettingsRequest(ProjectScopedRequest):
    pass


class GetSettingsResponse(ProjectResponse):
    # Settings is the full nested dict from Settings.model_dump(); we allow
    # arbitrary structure rather than re-typing every nested field.
    model_config = ConfigDict(extra="allow")

    settings: Dict[str, Any]


class UpdateSettingsRequest(ProjectScopedRequest):
    # The frontend sends a partial settings object; we validate structure
    # (must be a dict) and delegate field updates to the loaded Pydantic model.
    settings: Dict[str, Any]


class UpdateSettingsResponse(ProjectResponse):
    operation: str
    message: str
    details: Dict[str, Any]


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


def _convert_enums(obj: Any) -> Any:
    """Recursively convert Enum values to their string form for JSON output."""
    if isinstance(obj, dict):
        return {k: _convert_enums(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_enums(item) for item in obj]
    if isinstance(obj, Enum):
        return obj.value
    return obj


class SettingsHandler(BaseHandler):
    """Settings JSON-RPC methods."""

    # -- get_settings --------------------------------------------------------

    @rpc_method(
        name="get_settings",
        request=GetSettingsRequest,
        response=GetSettingsResponse,
        writes=False,
    )
    def get_settings(self, req: GetSettingsRequest) -> GetSettingsResponse:
        assert self.review_manager is not None
        logger.info("Getting settings for project %s", req.project_id)

        settings = self.review_manager.settings
        # Don't use mode='json' — the Settings model has a custom model_dump
        # override that serializes ExtendedSearchFile sources correctly.
        settings_dict = settings.model_dump()
        settings_dict = _convert_enums(settings_dict)

        return GetSettingsResponse(
            project_id=req.project_id,
            settings=settings_dict,
        )

    # -- update_settings -----------------------------------------------------

    @rpc_method(
        name="update_settings",
        request=UpdateSettingsRequest,
        response=UpdateSettingsResponse,
        writes=True,
    )
    def update_settings(
        self, req: UpdateSettingsRequest
    ) -> UpdateSettingsResponse:
        assert self.review_manager is not None

        if not req.settings:
            raise ValueError("settings parameter is required")

        logger.info("Updating settings for project %s", req.project_id)

        updated_fields: List[str] = []
        current_settings = self.review_manager.settings

        # Update project settings
        if "project" in req.settings:
            project_updates = req.settings["project"]
            if isinstance(project_updates, dict):
                for key, value in project_updates.items():
                    if hasattr(current_settings.project, key):
                        setattr(current_settings.project, key, value)
                        updated_fields.append(f"project.{key}")

        # Update operation settings
        operation_fields = [
            "search", "prep", "dedupe", "prescreen",
            "pdf_get", "pdf_prep", "screen", "data",
        ]
        for field in operation_fields:
            if field in req.settings:
                field_updates = req.settings[field]
                if isinstance(field_updates, dict):
                    settings_obj = getattr(current_settings, field)
                    for key, value in field_updates.items():
                        if hasattr(settings_obj, key):
                            setattr(settings_obj, key, value)
                            updated_fields.append(f"{field}.{key}")

        # Save the updated settings
        self.review_manager.save_settings()

        return UpdateSettingsResponse(
            project_id=req.project_id,
            operation="update_settings",
            message="Update_settings operation completed successfully",
            details={
                "message": f"Updated {len(updated_fields)} setting(s)",
                "updated_fields": updated_fields,
            },
        )
