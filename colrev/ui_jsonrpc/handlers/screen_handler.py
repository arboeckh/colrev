"""Handler for screening operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter

logger = logging.getLogger(__name__)


class ScreenHandler:
    """Handle screen-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize screen handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def screen(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute screening operation.

        Expected params:
            project_id (str): Project identifier

        Args:
            params: Method parameters

        Returns:
            Screen operation results
        """
        project_id = params["project_id"]

        logger.info(f"Running screen operation for project {project_id}")

        # Get screen operation
        screen_operation = self.review_manager.get_screen_operation(
            notify_state_transition_operation=True
        )

        # Execute screen
        screen_operation.main()

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="screen",
            project_id=project_id,
            details={"message": "Screening completed"},
        )
