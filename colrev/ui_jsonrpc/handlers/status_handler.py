"""Handler for status and validation operations."""

import logging
from typing import Any, Dict

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter

logger = logging.getLogger(__name__)


class StatusHandler:
    """Handle status-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize status handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def get_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get status of a CoLRev project.

        Args:
            params: Method parameters (project_id required)

        Returns:
            Status information including completion statistics
        """
        project_id = params["project_id"]
        logger.info(f"Getting status for project {project_id}")

        # Get status statistics from ReviewManager
        status_stats = self.review_manager.get_status_stats()

        # Format and return response
        return response_formatter.format_status_response(
            project_id=project_id,
            project_path=self.review_manager.path,
            status_stats=status_stats,
        )

    def status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run status operation (alias for get_status).

        Args:
            params: Method parameters

        Returns:
            Status information
        """
        return self.get_status(params)

    def validate(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate the CoLRev project.

        Expected params:
            project_id (str): Project identifier
            scope (str, optional): Scope of validation (default: "HEAD")
            filter_setting (str, optional): Filter setting (default: "general")

        Args:
            params: Method parameters (project_id required)

        Returns:
            Validation results
        """
        from colrev.ui_jsonrpc import validation

        project_id = params["project_id"]
        scope = validation.get_optional_param(params, "scope", "HEAD")
        filter_setting = validation.get_optional_param(params, "filter_setting", "general")

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
