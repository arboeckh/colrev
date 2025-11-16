"""Handler for search operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class SearchHandler:
    """Handle search-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize search handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def search(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute search operation to retrieve records from sources.

        Expected params:
            project_id (str): Project identifier
            source (str, optional): Source selection string (default: "all")
            rerun (bool, optional): Rerun API-based searches (default: False)
            skip_commit (bool, optional): Skip git commit (default: False)

        Args:
            params: Method parameters

        Returns:
            Search operation results
        """
        project_id = params["project_id"]
        source = validation.get_optional_param(params, "source", "all")
        rerun = validation.get_optional_param(params, "rerun", False)
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        logger.info(f"Running search operation for project {project_id}")

        # Get search operation
        search_operation = self.review_manager.get_search_operation()

        # Execute search
        search_operation.main(
            selection_str=source,
            rerun=rerun,
            skip_commit=skip_commit,
        )

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="search",
            project_id=project_id,
            details={
                "source": source,
                "rerun": rerun,
                "message": "Search completed",
            },
        )
