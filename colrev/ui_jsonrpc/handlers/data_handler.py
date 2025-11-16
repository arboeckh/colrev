"""Handler for data extraction and synthesis operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter

logger = logging.getLogger(__name__)


class DataHandler:
    """Handle data-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize data handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def data(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute data extraction and synthesis operation.

        Expected params:
            project_id (str): Project identifier

        Args:
            params: Method parameters

        Returns:
            Data operation results
        """
        project_id = params["project_id"]

        logger.info(f"Running data operation for project {project_id}")

        # Get data operation
        data_operation = self.review_manager.get_data_operation(
            notify_state_transition_operation=True
        )

        # Execute data extraction/synthesis
        data_operation.main()

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="data",
            project_id=project_id,
            details={"message": "Data extraction and synthesis completed"},
        )
