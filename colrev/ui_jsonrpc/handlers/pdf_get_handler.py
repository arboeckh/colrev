"""Handler for PDF retrieval operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class PDFGetHandler:
    """Handle pdf-get-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize PDF get handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def pdf_get(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute PDF retrieval operation.

        Expected params:
            project_id (str): Project identifier

        Args:
            params: Method parameters

        Returns:
            PDF get operation results
        """
        project_id = params["project_id"]

        logger.info(f"Running pdf-get operation for project {project_id}")

        # Get pdf-get operation
        pdf_get_operation = self.review_manager.get_pdf_get_operation(
            notify_state_transition_operation=True
        )

        # Execute pdf-get
        pdf_get_operation.main()

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="pdf_get",
            project_id=project_id,
            details={"message": "PDF retrieval completed"},
        )
