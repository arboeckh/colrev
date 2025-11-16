"""Handler for metadata preparation operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
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

        Args:
            params: Method parameters

        Returns:
            Prep operation results
        """
        project_id = params["project_id"]
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        logger.info(f"Running prep operation for project {project_id}")

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
            details={"message": "Metadata preparation completed"},
        )
