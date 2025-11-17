"""Handler for load operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class LoadHandler:
    """Handle load-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize load handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def load(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute load operation to import search results.

        Expected params:
            project_id (str): Project identifier
            keep_ids (bool, optional): Keep original IDs (default: False)

        Args:
            params: Method parameters

        Returns:
            Load operation results
        """
        project_id = params["project_id"]
        keep_ids = validation.get_optional_param(params, "keep_ids", False)

        logger.info(f"Running load operation for project {project_id}")

        # Get load operation
        load_operation = self.review_manager.get_load_operation()

        # Execute load
        load_operation.main(keep_ids=keep_ids)

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="load",
            project_id=project_id,
            details={"message": "Load completed", "keep_ids": keep_ids},
        )
