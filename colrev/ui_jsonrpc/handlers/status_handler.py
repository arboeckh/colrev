"""Handler for status and validation operations.

JSON-RPC Endpoints:
    - get_status: Get comprehensive project status with record counts by state
    - status: Alias for get_status
    - validate: Validate project state and check for issues
    - get_operation_info: Get information about what a specific operation will do

See docs/api/jsonrpc/status.md for full endpoint documentation.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

import colrev.review_manager
from colrev.constants import OperationsType, RecordState
from colrev.ui_jsonrpc import response_formatter, validation as param_validation

logger = logging.getLogger(__name__)


# Mapping of operation names to their descriptions
OPERATION_DESCRIPTIONS = {
    "search": "Search configured sources for records",
    "load": "Import search results into main records file",
    "prep": "Prepare and clean metadata for imported records",
    "dedupe": "Identify and merge duplicate records",
    "prescreen": "Screen records based on titles and abstracts",
    "pdf_get": "Retrieve PDF documents for included records",
    "pdf_prep": "Prepare and validate retrieved PDFs",
    "screen": "Full-text screening of records",
    "data": "Data extraction and synthesis",
}

# Mapping of operation names to the states they process
OPERATION_INPUT_STATES = {
    "search": None,  # Special case: searches sources, not records
    "load": RecordState.md_retrieved,
    "prep": RecordState.md_imported,
    "dedupe": RecordState.md_prepared,
    "prescreen": RecordState.md_processed,
    "pdf_get": RecordState.rev_prescreen_included,
    "pdf_prep": RecordState.pdf_imported,
    "screen": RecordState.pdf_prepared,
    "data": RecordState.rev_included,
}


class StatusHandler:
    """Handle status-related JSON-RPC methods.

    This handler provides endpoints for querying project status, validating
    project state, and getting information about available operations.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize status handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def get_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get comprehensive status of a CoLRev project.

        Returns detailed record counts by state, next recommended operation,
        and project completeness information.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - path (str): Absolute path to project
                - status (dict): Comprehensive status information with:
                    - overall (dict): Record counts by state
                    - currently (dict): Records currently in each state
                    - next_operation (str|null): Recommended next operation
                    - completeness_condition (bool): Whether review is complete
                    - atomic_steps (int): Total atomic steps
                    - completed_atomic_steps (int): Completed atomic steps
                    - has_changes (bool): Whether there are uncommitted changes
                    - duplicates_removed (int): Number of merged duplicates

        Raises:
            ValueError: If project_id is missing
        """
        project_id = params["project_id"]
        logger.info(f"Getting status for project {project_id}")

        # Get status statistics from ReviewManager
        status_stats = self.review_manager.get_status_stats()

        # Check for uncommitted changes (check entire repository)
        from pathlib import Path
        has_changes = self.review_manager.dataset.git_repo.has_changes(Path("."))

        # Determine next operation based on current state
        next_operation = self._determine_next_operation(status_stats)

        # Format comprehensive response
        return response_formatter.format_comprehensive_status_response(
            project_id=project_id,
            project_path=self.review_manager.path,
            status_stats=status_stats,
            next_operation=next_operation,
            has_changes=has_changes,
        )

    def status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run status operation (alias for get_status).

        Args:
            params: Method parameters (see get_status)

        Returns:
            Status information (see get_status)
        """
        return self.get_status(params)

    def validate(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate the CoLRev project state.

        Runs validation checks to identify issues with records, settings,
        or repository state.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - scope (str, optional): Validation scope - "HEAD" (default),
                    commit hash, or "all"
                - filter_setting (str, optional): Filter for validation type -
                    "general" (default), "prep", "dedupe", etc.

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "validate"
                - project_id (str): Project identifier
                - details (dict): Validation results with:
                    - message (str): Summary message
                    - result: Validation result data
        """
        project_id = params["project_id"]
        scope = param_validation.get_optional_param(params, "scope", "HEAD")
        filter_setting = param_validation.get_optional_param(
            params, "filter_setting", "general"
        )

        logger.info(f"Validating project {project_id}")

        # Get validate operation
        validate_operation = self.review_manager.get_validate_operation()

        # Run validation
        result = validate_operation.main(scope=scope, filter_setting=filter_setting)

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="validate",
            project_id=project_id,
            details={"message": "Validation completed", "result": result},
        )

    def get_operation_info(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get information about what a specific operation will do.

        Provides a preview of an operation before running it, including
        whether it can run, how many records will be affected, why
        it might not be runnable, and whether it needs to be re-run.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - operation (str): Operation name (required) - one of:
                    "search", "load", "prep", "dedupe", "prescreen",
                    "pdf_get", "pdf_prep", "screen", "data"

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): Operation name
                - can_run (bool): Whether operation can be executed
                - reason (str|null): Why operation cannot run (if can_run=False)
                - needs_rerun (bool): Whether operation needs to be re-run
                - needs_rerun_reason (str|null): Why operation needs re-run
                - affected_records (int): Number of records that will be affected
                - description (str): Human-readable description of operation

        Raises:
            ValueError: If operation name is invalid
        """
        project_id = params["project_id"]
        operation = params.get("operation")

        if not operation:
            raise ValueError("operation parameter is required")

        if operation not in OPERATION_DESCRIPTIONS:
            valid_ops = ", ".join(OPERATION_DESCRIPTIONS.keys())
            raise ValueError(
                f"Invalid operation '{operation}'. Valid operations: {valid_ops}"
            )

        logger.info(f"Getting operation info for {operation} in project {project_id}")

        # Get status to determine affected records
        status_stats = self.review_manager.get_status_stats()

        # Check if operation can run and get affected record count
        can_run, reason, affected_records = self._check_operation_runnable(
            operation, status_stats
        )

        # Check if operation needs to be re-run
        needs_rerun, needs_rerun_reason = self._check_needs_rerun(
            operation, status_stats
        )

        return {
            "success": True,
            "operation": operation,
            "can_run": can_run,
            "reason": reason,
            "needs_rerun": needs_rerun,
            "needs_rerun_reason": needs_rerun_reason,
            "affected_records": affected_records,
            "description": OPERATION_DESCRIPTIONS[operation],
        }

    def _determine_next_operation(self, status_stats) -> Optional[str]:
        """
        Determine the next recommended operation based on current status.

        Args:
            status_stats: StatusStats object from ReviewManager

        Returns:
            Name of next operation to run, or None if review is complete
        """
        currently = status_stats.currently

        # Check each stage in order
        if currently.md_retrieved > 0:
            return "load"
        if currently.md_imported > 0 or currently.md_needs_manual_preparation > 0:
            return "prep"
        if currently.md_prepared > 0:
            return "dedupe"
        if currently.md_processed > 0:
            return "prescreen"
        if currently.rev_prescreen_included > 0 or currently.pdf_needs_manual_retrieval > 0:
            return "pdf_get"
        if currently.pdf_imported > 0 or currently.pdf_needs_manual_preparation > 0:
            return "pdf_prep"
        if currently.pdf_prepared > 0:
            return "screen"
        if currently.rev_included > 0:
            return "data"

        # Check if there are sources that haven't been searched
        sources = self.review_manager.settings.sources
        for source in sources:
            # If source has no records, suggest search
            # This is a simplified check - actual implementation may need more logic
            pass

        return None  # Review is complete or no records

    def _check_operation_runnable(
        self, operation: str, status_stats
    ) -> tuple[bool, Optional[str], int]:
        """
        Check if an operation can be run and count affected records.

        Args:
            operation: Name of operation to check
            status_stats: StatusStats object from ReviewManager

        Returns:
            Tuple of (can_run, reason, affected_records)
        """
        currently = status_stats.currently
        affected_records = 0
        reason = None

        if operation == "search":
            # Search can always run if sources are configured
            sources = self.review_manager.settings.sources
            if not sources:
                return False, "No search sources configured", 0
            return True, None, len(sources)

        elif operation == "load":
            affected_records = currently.md_retrieved
            if affected_records == 0:
                reason = "No records to load (run search first)"
                return False, reason, 0

        elif operation == "prep":
            affected_records = (
                currently.md_imported + currently.md_needs_manual_preparation
            )
            if affected_records == 0:
                reason = "No records to prepare (run load first)"
                return False, reason, 0

        elif operation == "dedupe":
            affected_records = currently.md_prepared
            if affected_records == 0:
                reason = "No records to deduplicate (run prep first)"
                return False, reason, 0

        elif operation == "prescreen":
            affected_records = currently.md_processed
            if affected_records == 0:
                reason = "No records to prescreen (run dedupe first)"
                return False, reason, 0

        elif operation == "pdf_get":
            affected_records = (
                currently.rev_prescreen_included + currently.pdf_needs_manual_retrieval
            )
            if affected_records == 0:
                reason = "No records need PDF retrieval (run prescreen first)"
                return False, reason, 0

        elif operation == "pdf_prep":
            affected_records = (
                currently.pdf_imported + currently.pdf_needs_manual_preparation
            )
            if affected_records == 0:
                reason = "No PDFs to prepare (run pdf_get first)"
                return False, reason, 0

        elif operation == "screen":
            affected_records = currently.pdf_prepared
            if affected_records == 0:
                reason = "No records to screen (run pdf_prep first)"
                return False, reason, 0

        elif operation == "data":
            affected_records = currently.rev_included
            if affected_records == 0:
                reason = "No records for data extraction (run screen first)"
                return False, reason, 0

        return True, None, affected_records

    def _check_needs_rerun(
        self, operation: str, status_stats
    ) -> tuple[bool, Optional[str]]:
        """
        Check if an operation needs to be re-run due to changed settings.

        For search: Compares current source settings vs search history files.
        For other operations: Checks if there are records in input states.

        Args:
            operation: Name of operation to check
            status_stats: StatusStats object from ReviewManager

        Returns:
            Tuple of (needs_rerun, reason)
        """
        if operation == "search":
            return self._check_search_needs_rerun()

        # For other operations, check if they have input records to process
        currently = status_stats.currently
        input_state = OPERATION_INPUT_STATES.get(operation)

        if input_state is None:
            return False, None

        # Map input states to their counts
        state_counts = {
            RecordState.md_retrieved: currently.md_retrieved,
            RecordState.md_imported: (
                currently.md_imported + currently.md_needs_manual_preparation
            ),
            RecordState.md_prepared: currently.md_prepared,
            RecordState.md_processed: currently.md_processed,
            RecordState.rev_prescreen_included: (
                currently.rev_prescreen_included + currently.pdf_needs_manual_retrieval
            ),
            RecordState.pdf_imported: (
                currently.pdf_imported + currently.pdf_needs_manual_preparation
            ),
            RecordState.pdf_prepared: currently.pdf_prepared,
            RecordState.rev_included: currently.rev_included,
        }

        count = state_counts.get(input_state, 0)
        if count > 0:
            return True, f"{count} record(s) pending for {operation}"

        return False, None

    def _check_search_needs_rerun(self) -> tuple[bool, Optional[str]]:
        """
        Check if search needs to be re-run by comparing current settings
        with search history files.

        Returns:
            Tuple of (needs_rerun, reason)
        """
        sources = self.review_manager.settings.sources

        if not sources:
            return False, None

        modified_sources = []

        for source in sources:
            history_path = self.review_manager.path / source.get_search_history_path()

            # If no history file exists, search hasn't been run yet
            if not history_path.is_file():
                modified_sources.append(source.platform)
                continue

            # Load history and compare with current settings
            try:
                with open(history_path, "r", encoding="utf-8") as f:
                    history = json.load(f)

                # Compare key fields that affect search results
                if self._source_settings_changed(source, history):
                    modified_sources.append(source.platform)

            except (json.JSONDecodeError, OSError) as e:
                logger.warning(f"Error reading search history {history_path}: {e}")
                modified_sources.append(source.platform)

        if modified_sources:
            if len(modified_sources) == 1:
                return True, f"{modified_sources[0]} settings modified since last run"
            return True, f"{len(modified_sources)} sources modified since last run"

        return False, None

    def _source_settings_changed(self, source, history: dict) -> bool:
        """
        Compare current source settings with saved history.

        Args:
            source: Current ExtendedSearchFile object
            history: Saved history dict from JSON file

        Returns:
            True if settings have changed, False otherwise
        """
        # Compare search_string (query)
        current_query = getattr(source, "search_string", "") or ""
        history_query = history.get("search_string", "") or ""
        if current_query != history_query:
            return True

        # Compare search_parameters if present
        current_params = getattr(source, "search_parameters", {}) or {}
        history_params = history.get("search_parameters", {}) or {}
        if current_params != history_params:
            return True

        return False
