"""Handler for metadata preparation operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.constants import DefectCodes
from colrev.settings import PrepRound
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class PrepHandler:
    """Handle prep-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize prep handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def prep(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute metadata preparation operation.

        Expected params:
            project_id (str): Project identifier
            skip_commit (bool, optional): Skip git commit (default: False)
            use_minimal_prep (bool, optional): Skip external API calls (default: False)
                When True, uses empty prep_package_endpoints to transition records
                from md_imported to md_prepared without running external enrichment.

        Args:
            params: Method parameters

        Returns:
            Prep operation results
        """
        project_id = params["project_id"]
        skip_commit = validation.get_optional_param(params, "skip_commit", False)
        use_minimal_prep = validation.get_optional_param(
            params, "use_minimal_prep", False
        )

        logger.info(f"Running prep operation for project {project_id}")

        original_prep_rounds = None
        original_defects_to_ignore = None

        if use_minimal_prep:
            # Store original settings to restore later
            original_prep_rounds = self.review_manager.settings.prep.prep_rounds
            original_defects_to_ignore = (
                self.review_manager.settings.prep.defects_to_ignore
            )

            # Set minimal prep rounds with no external API packages
            # This still transitions records from md_imported -> md_prepared
            self.review_manager.settings.prep.prep_rounds = [
                PrepRound(name="minimal", prep_package_endpoints=[])
            ]

            # Skip ALL quality model checkers for minimal prep
            # This ensures records transition directly from md_imported to md_prepared
            # without any quality checks (which could move them to md_needs_manual_preparation)
            all_defect_codes = [
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
            self.review_manager.settings.prep.defects_to_ignore = list(
                original_defects_to_ignore
            ) + all_defect_codes

            logger.info("Using minimal prep (no external API calls)")

        try:
            # Get prep operation
            prep_operation = self.review_manager.get_prep_operation(
                notify_state_transition_operation=True
            )

            # Execute prep
            # Note: prep.main() doesn't take skip_commit, it always commits
            prep_operation.main()

            # Return success response
            return response_formatter.format_operation_response(
                operation_name="prep",
                project_id=project_id,
                details={
                    "message": "Metadata preparation completed",
                    "minimal_prep": use_minimal_prep,
                },
            )
        finally:
            if original_prep_rounds is not None:
                # Restore original settings (don't save to disk)
                self.review_manager.settings.prep.prep_rounds = original_prep_rounds
            if original_defects_to_ignore is not None:
                self.review_manager.settings.prep.defects_to_ignore = (
                    original_defects_to_ignore
                )
