"""Framework-native prep handler."""

from __future__ import annotations

import logging

from colrev.constants import DefectCodes
from colrev.constants import OperationsType
from colrev.settings import PrepRound
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


class PrepRequest(ProjectScopedRequest):
    use_minimal_prep: bool = False


class PrepResponse(ProjectResponse):
    operation: str
    details: dict


# Quality model checkers to ignore during minimal prep so records transition
# md_imported -> md_prepared without being diverted to md_needs_manual_preparation.
_ALL_DEFECT_CODES = [
    DefectCodes.MISSING,
    DefectCodes.RECORD_NOT_IN_TOC,
    DefectCodes.INCONSISTENT_WITH_ENTRYTYPE,
    DefectCodes.CONTAINER_TITLE_ABBREVIATED,
    DefectCodes.DOI_NOT_MATCHING_PATTERN,
    DefectCodes.ERRONEOUS_SYMBOL_IN_FIELD,
    DefectCodes.ERRONEOUS_TERM_IN_FIELD,
    DefectCodes.ERRONEOUS_TITLE_FIELD,
    DefectCodes.HTML_TAGS,
    DefectCodes.IDENTICAL_VALUES_BETWEEN_TITLE_AND_CONTAINER,
    DefectCodes.INCOMPLETE_FIELD,
    DefectCodes.INCONSISTENT_CONTENT,
    DefectCodes.INCONSISTENT_WITH_DOI_METADATA,
    DefectCodes.ISBN_NOT_MATCHING_PATTERN,
    DefectCodes.LANGUAGE_FORMAT_ERROR,
    DefectCodes.LANGUAGE_UNKNOWN,
    DefectCodes.MOSTLY_ALL_CAPS,
    DefectCodes.NAME_ABBREVIATED,
    DefectCodes.NAME_FORMAT_SEPARTORS,
    DefectCodes.NAME_FORMAT_TITLES,
    DefectCodes.NAME_PARTICLES,
    DefectCodes.PAGE_RANGE,
    DefectCodes.PUBMED_ID_NOT_MATCHING_PATTERN,
    DefectCodes.THESIS_WITH_MULTIPLE_AUTHORS,
    DefectCodes.YEAR_FORMAT,
]


class PrepHandler(BaseHandler):
    """Metadata preparation operation."""

    @rpc_method(
        name="prep",
        request=PrepRequest,
        response=PrepResponse,
        operation_type=OperationsType.prep,
        notify=True,
        writes=True,
    )
    def prep(self, req: PrepRequest) -> PrepResponse:
        assert self.review_manager is not None
        logger.info("Running prep operation for project %s", req.project_id)

        original_prep_rounds = None
        original_defects_to_ignore = None

        if req.use_minimal_prep:
            original_prep_rounds = self.review_manager.settings.prep.prep_rounds
            original_defects_to_ignore = (
                self.review_manager.settings.prep.defects_to_ignore
            )
            self.review_manager.settings.prep.prep_rounds = [
                PrepRound(name="minimal", prep_package_endpoints=[])
            ]
            self.review_manager.settings.prep.defects_to_ignore = (
                list(original_defects_to_ignore) + _ALL_DEFECT_CODES
            )
            logger.info("Using minimal prep (no external API calls)")

        try:
            prep_operation = self.op(OperationsType.prep, notify=True)
            # prep.main() is a batch colrev op and commits on its own.
            prep_operation.main()

            return PrepResponse(
                project_id=req.project_id,
                operation="prep",
                details={
                    "message": "Metadata preparation completed",
                    "minimal_prep": req.use_minimal_prep,
                },
            )
        finally:
            if original_prep_rounds is not None:
                self.review_manager.settings.prep.prep_rounds = original_prep_rounds
            if original_defects_to_ignore is not None:
                self.review_manager.settings.prep.defects_to_ignore = (
                    original_defects_to_ignore
                )
