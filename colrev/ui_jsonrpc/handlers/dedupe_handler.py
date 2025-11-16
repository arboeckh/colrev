"""Handler for deduplication operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter

logger = logging.getLogger(__name__)


class DedupeHandler:
    """Handle dedupe-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize dedupe handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def dedupe(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute deduplication operation.

        Expected params:
            project_id (str): Project identifier

        Args:
            params: Method parameters

        Returns:
            Dedupe operation results
        """
        project_id = params["project_id"]

        logger.info(f"Running dedupe operation for project {project_id}")

        # Get dedupe operation
        dedupe_operation = self.review_manager.get_dedupe_operation(
            notify_state_transition_operation=True
        )

        # Execute dedupe
        dedupe_operation.main()

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="dedupe",
            project_id=project_id,
            details={"message": "Deduplication completed"},
        )
