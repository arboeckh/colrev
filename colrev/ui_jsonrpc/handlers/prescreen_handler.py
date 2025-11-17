"""Handler for prescreen operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class PrescreenHandler:
    """Handle prescreen-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize prescreen handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def prescreen(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute prescreen operation.

        Expected params:
            project_id (str): Project identifier
            split_str (str, optional): Split string for parallel prescreening (default: "NA")

        Args:
            params: Method parameters

        Returns:
            Prescreen operation results
        """
        project_id = params["project_id"]
        split_str = validation.get_optional_param(params, "split_str", "NA")

        logger.info(f"Running prescreen operation for project {project_id}")

        # Get prescreen operation
        prescreen_operation = self.review_manager.get_prescreen_operation(
            notify_state_transition_operation=True
        )

        # Execute prescreen
        prescreen_operation.main(split_str=split_str)

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="prescreen",
            project_id=project_id,
            details={"message": "Prescreen completed", "split_str": split_str},
        )
