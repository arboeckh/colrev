"""Main JSON-RPC request handler and router."""

import logging
import os
from typing import Any, Dict, Optional

import colrev.review_manager
from colrev.ui_jsonrpc import error_handler, validation
from colrev.ui_jsonrpc.handlers import (
    DataHandler,
    DedupeHandler,
    InitHandler,
    PrepHandler,
    SearchHandler,
    ScreenHandler,
    StatusHandler,
)

logger = logging.getLogger(__name__)


class JSONRPCHandler:
    """Handle JSON-RPC 2.0 requests and route to appropriate operation handlers."""

    def __init__(self):
        """Initialize the JSON-RPC handler."""
        # Handlers will be initialized per-project as needed
        pass

    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process JSON-RPC 2.0 request and return response.

        Args:
            request: JSON-RPC request dictionary

        Returns:
            JSON-RPC response dictionary
        """
        # Validate JSON-RPC 2.0 structure
        if request.get("jsonrpc") != "2.0":
            return error_handler.create_error_response(
                error_handler.INVALID_REQUEST,
                "Invalid Request",
                "jsonrpc version must be 2.0",
                request.get("id"),
            )

        method = request.get("method")
        params = request.get("params", {})
        request_id = request.get("id")

        if not method:
            return error_handler.create_error_response(
                error_handler.INVALID_REQUEST,
                "Invalid Request",
                "method is required",
                request_id,
            )

        # Route to appropriate method handler
        try:
            result = self._route_method(method, params)
            return {
                "jsonrpc": "2.0",
                "result": result,
                "id": request_id,
            }

        except Exception as e:
            logger.exception(f"Error executing method {method}")
            return error_handler.handle_exception(e, request_id)

    def _route_method(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Route method to appropriate handler.

        Args:
            method: JSON-RPC method name
            params: Method parameters

        Returns:
            Method result dictionary

        Raises:
            ValueError: If method is not found
        """
        # Methods that don't require a project
        if method == "ping":
            return {"status": "pong"}
        elif method == "init_project":
            return InitHandler.init_project(params)

        # Methods that require an existing project
        elif method in ["get_status", "status", "validate"]:
            return self._handle_with_review_manager(
                method, params, StatusHandler
            )
        elif method in ["search"]:
            return self._handle_with_review_manager(
                method, params, SearchHandler
            )
        elif method in ["prep"]:
            return self._handle_with_review_manager(
                method, params, PrepHandler
            )
        elif method in ["dedupe"]:
            return self._handle_with_review_manager(
                method, params, DedupeHandler
            )
        elif method in ["screen"]:
            return self._handle_with_review_manager(
                method, params, ScreenHandler
            )
        elif method in ["data"]:
            return self._handle_with_review_manager(
                method, params, DataHandler
            )
        else:
            raise ValueError(f"Method '{method}' not found")

    def _handle_with_review_manager(
        self,
        method: str,
        params: Dict[str, Any],
        handler_class: type,
    ) -> Dict[str, Any]:
        """
        Handle method that requires ReviewManager.

        Args:
            method: Method name
            params: Method parameters
            handler_class: Handler class to instantiate

        Returns:
            Method result dictionary
        """
        # Validate project exists
        project_path = validation.validate_existing_project(params)

        # Save current directory and change to project directory
        original_cwd = os.getcwd()

        try:
            os.chdir(project_path)

            # Create ReviewManager
            review_manager = colrev.review_manager.ReviewManager(
                path_str=str(project_path),
                force_mode=params.get("force", False),
                verbose_mode=params.get("verbose", False),
            )

            # Create handler instance
            handler = handler_class(review_manager)

            # Call the method
            if hasattr(handler, method):
                method_func = getattr(handler, method)
                return method_func(params)
            else:
                raise ValueError(f"Handler {handler_class.__name__} does not support method '{method}'")

        finally:
            # Always restore original directory
            os.chdir(original_cwd)
