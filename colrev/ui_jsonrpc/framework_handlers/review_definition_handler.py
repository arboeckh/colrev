"""Framework-native review definition handler.

Implements review definition and screening-criteria RPC methods atop the typed
framework.

Writes stage changes via ``save_settings()``; commits are driven explicitly
via the ``commit_changes`` endpoint in ``git_handler``.
"""

from __future__ import annotations

import logging
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

import colrev.settings
from colrev.constants import ScreenCriterionType
from colrev.settings import ScreenCriterion
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class CriterionInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    explanation: str
    comment: Optional[str] = None
    criterion_type: str


class GetReviewDefinitionRequest(ProjectScopedRequest):
    pass


class GetReviewDefinitionResponse(ProjectResponse):
    review_type: str
    title: str
    protocol_url: str
    keywords: List[str]
    objectives: str
    criteria: Dict[str, CriterionInfo]


class UpdateReviewDefinitionRequest(ProjectScopedRequest):
    protocol_url: Optional[str] = None
    keywords: Optional[List[str]] = None
    objectives: Optional[str] = None


class UpdateReviewDefinitionResponse(ProjectResponse):
    operation: str
    details: Dict[str, Any]


class GetScreeningCriteriaRequest(ProjectScopedRequest):
    pass


class GetScreeningCriteriaResponse(ProjectResponse):
    criteria: Dict[str, CriterionInfo]


class AddScreeningCriterionRequest(ProjectScopedRequest):
    name: str
    explanation: str
    criterion_type: str
    comment: Optional[str] = None


class AddScreeningCriterionResponse(ProjectResponse):
    operation: str
    details: Dict[str, Any]


class UpdateScreeningCriterionRequest(ProjectScopedRequest):
    criterion_name: str
    explanation: Optional[str] = None
    comment: Optional[str] = None
    criterion_type: Optional[str] = None


class UpdateScreeningCriterionResponse(ProjectResponse):
    operation: str
    details: Dict[str, Any]


class RemoveScreeningCriterionRequest(ProjectScopedRequest):
    criterion_name: str


class RemoveScreeningCriterionResponse(ProjectResponse):
    operation: str
    details: Dict[str, Any]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _serialize_criteria(
    criteria: Dict[str, ScreenCriterion],
) -> Dict[str, CriterionInfo]:
    result: Dict[str, CriterionInfo] = {}
    for name, criterion in criteria.items():
        result[name] = CriterionInfo(
            explanation=criterion.explanation,
            comment=criterion.comment,
            criterion_type=criterion.criterion_type.value,
        )
    return result


def _parse_criterion_type(criterion_type_str: str) -> ScreenCriterionType:
    try:
        return ScreenCriterionType(criterion_type_str)
    except ValueError:
        valid_options = ScreenCriterionType.get_options()
        raise ValueError(
            f"Invalid criterion_type '{criterion_type_str}'. "
            f"Must be one of: {', '.join(valid_options)}"
        )


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class ReviewDefinitionHandler(BaseHandler):
    """All review-definition JSON-RPC methods."""

    # -- get_review_definition ----------------------------------------------

    @rpc_method(
        name="get_review_definition",
        request=GetReviewDefinitionRequest,
        response=GetReviewDefinitionResponse,
    )
    def get_review_definition(
        self, req: GetReviewDefinitionRequest
    ) -> GetReviewDefinitionResponse:
        assert self.review_manager is not None
        logger.info("Getting review definition for project %s", req.project_id)

        settings = self.review_manager.settings

        protocol_url = ""
        if settings.project.protocol is not None:
            protocol_url = settings.project.protocol.url

        criteria_dict = _serialize_criteria(settings.screen.criteria)

        return GetReviewDefinitionResponse(
            project_id=req.project_id,
            review_type=settings.project.review_type,
            title=settings.project.title,
            protocol_url=protocol_url,
            keywords=settings.project.keywords,
            objectives=settings.screen.explanation or "",
            criteria=criteria_dict,
        )

    # -- update_review_definition --------------------------------------------

    @rpc_method(
        name="update_review_definition",
        request=UpdateReviewDefinitionRequest,
        response=UpdateReviewDefinitionResponse,
    )
    def update_review_definition(
        self, req: UpdateReviewDefinitionRequest
    ) -> UpdateReviewDefinitionResponse:
        assert self.review_manager is not None
        logger.info("Updating review definition for project %s", req.project_id)

        settings = self.review_manager.settings
        updated_fields: List[str] = []

        if req.protocol_url is not None:
            if settings.project.protocol is not None:
                settings.project.protocol.url = req.protocol_url
            else:
                settings.project.protocol = colrev.settings.Protocol(
                    url=req.protocol_url
                )
            updated_fields.append("protocol_url")

        if req.keywords is not None:
            settings.project.keywords = req.keywords
            updated_fields.append("keywords")

        if req.objectives is not None:
            settings.screen.explanation = req.objectives
            updated_fields.append("objectives")

        self.review_manager.save_settings()

        return UpdateReviewDefinitionResponse(
            project_id=req.project_id,
            operation="update_review_definition",
            details={
                "message": f"Updated {len(updated_fields)} field(s)",
                "updated_fields": updated_fields,
            },
        )

    # -- get_screening_criteria ----------------------------------------------

    @rpc_method(
        name="get_screening_criteria",
        request=GetScreeningCriteriaRequest,
        response=GetScreeningCriteriaResponse,
    )
    def get_screening_criteria(
        self, req: GetScreeningCriteriaRequest
    ) -> GetScreeningCriteriaResponse:
        assert self.review_manager is not None
        logger.info("Getting screening criteria for project %s", req.project_id)

        criteria_dict = _serialize_criteria(
            self.review_manager.settings.screen.criteria
        )

        return GetScreeningCriteriaResponse(
            project_id=req.project_id,
            criteria=criteria_dict,
        )

    # -- add_screening_criterion ---------------------------------------------

    @rpc_method(
        name="add_screening_criterion",
        request=AddScreeningCriterionRequest,
        response=AddScreeningCriterionResponse,
    )
    def add_screening_criterion(
        self, req: AddScreeningCriterionRequest
    ) -> AddScreeningCriterionResponse:
        assert self.review_manager is not None

        if not req.name:
            raise ValueError("name parameter is required")
        if not req.explanation:
            raise ValueError("explanation parameter is required")
        if not req.criterion_type:
            raise ValueError("criterion_type parameter is required")

        criterion_type = _parse_criterion_type(req.criterion_type)

        logger.info(
            "Adding screening criterion '%s' to project %s",
            req.name, req.project_id,
        )

        screen_settings = self.review_manager.settings.screen

        if req.name in screen_settings.criteria:
            raise ValueError(
                f"Screening criterion '{req.name}' already exists"
            )

        criterion = ScreenCriterion(
            explanation=req.explanation,
            comment=req.comment,
            criterion_type=criterion_type,
        )
        screen_settings.criteria[req.name] = criterion

        self.review_manager.save_settings()

        return AddScreeningCriterionResponse(
            project_id=req.project_id,
            operation="add_screening_criterion",
            details={
                "message": f"Added screening criterion '{req.name}'",
                "criterion_name": req.name,
            },
        )

    # -- update_screening_criterion ------------------------------------------

    @rpc_method(
        name="update_screening_criterion",
        request=UpdateScreeningCriterionRequest,
        response=UpdateScreeningCriterionResponse,
    )
    def update_screening_criterion(
        self, req: UpdateScreeningCriterionRequest
    ) -> UpdateScreeningCriterionResponse:
        assert self.review_manager is not None

        if not req.criterion_name:
            raise ValueError("criterion_name parameter is required")

        logger.info(
            "Updating screening criterion '%s' in project %s",
            req.criterion_name, req.project_id,
        )

        screen_settings = self.review_manager.settings.screen

        if req.criterion_name not in screen_settings.criteria:
            raise ValueError(
                f"Screening criterion '{req.criterion_name}' not found"
            )

        criterion = screen_settings.criteria[req.criterion_name]
        updated_fields: List[str] = []

        if req.explanation is not None:
            criterion.explanation = req.explanation
            updated_fields.append("explanation")

        if req.comment is not None:
            criterion.comment = req.comment
            updated_fields.append("comment")

        if req.criterion_type is not None:
            criterion.criterion_type = _parse_criterion_type(req.criterion_type)
            updated_fields.append("criterion_type")

        self.review_manager.save_settings()

        return UpdateScreeningCriterionResponse(
            project_id=req.project_id,
            operation="update_screening_criterion",
            details={
                "message": f"Updated screening criterion '{req.criterion_name}'",
                "criterion_name": req.criterion_name,
                "updated_fields": updated_fields,
            },
        )

    # -- remove_screening_criterion ------------------------------------------

    @rpc_method(
        name="remove_screening_criterion",
        request=RemoveScreeningCriterionRequest,
        response=RemoveScreeningCriterionResponse,
    )
    def remove_screening_criterion(
        self, req: RemoveScreeningCriterionRequest
    ) -> RemoveScreeningCriterionResponse:
        assert self.review_manager is not None

        if not req.criterion_name:
            raise ValueError("criterion_name parameter is required")

        logger.info(
            "Removing screening criterion '%s' from project %s",
            req.criterion_name, req.project_id,
        )

        screen_settings = self.review_manager.settings.screen

        if req.criterion_name not in screen_settings.criteria:
            raise ValueError(
                f"Screening criterion '{req.criterion_name}' not found"
            )

        del screen_settings.criteria[req.criterion_name]

        self.review_manager.save_settings()

        return RemoveScreeningCriterionResponse(
            project_id=req.project_id,
            operation="remove_screening_criterion",
            details={
                "message": f"Removed screening criterion '{req.criterion_name}'",
                "criterion_name": req.criterion_name,
            },
        )
