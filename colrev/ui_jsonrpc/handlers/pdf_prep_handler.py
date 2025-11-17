"""Handler for PDF preparation operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class PDFPrepHandler:
    """Handle pdf-prep-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize PDF prep handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def pdf_prep(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute PDF preparation operation.

        Expected params:
            project_id (str): Project identifier
            reprocess (bool, optional): Reprocess PDFs (default: False)
            batch_size (int, optional): Batch size for processing (default: 0)

        Args:
            params: Method parameters

        Returns:
            PDF prep operation results
        """
        project_id = params["project_id"]
        reprocess = validation.get_optional_param(params, "reprocess", False)
        batch_size = validation.get_optional_param(params, "batch_size", 0)

        logger.info(f"Running pdf-prep operation for project {project_id}")

        # Get pdf-prep operation
        pdf_prep_operation = self.review_manager.get_pdf_prep_operation(
            notify_state_transition_operation=True
        )

        # Execute pdf-prep
        pdf_prep_operation.main(reprocess=reprocess, batch_size=batch_size)

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="pdf_prep",
            project_id=project_id,
            details={"message": "PDF preparation completed", "reprocess": reprocess, "batch_size": batch_size},
        )
