"""Main JSON-RPC request handler and router."""

import io
import logging
import os
import sys
from typing import Any, Dict, Optional

import colrev.review_manager
from colrev.ui_jsonrpc import error_handler, validation
from colrev.ui_jsonrpc.handlers import (
    DataHandler,
    DedupeHandler,
    InitHandler,
    LoadHandler,
    PDFGetHandler,
    PDFPrepHandler,
    PrepHandler,
    PrescreenHandler,
    ScreenHandler,
    SearchHandler,
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
        elif method in ["load"]:
            return self._handle_with_review_manager(
                method, params, LoadHandler
            )
        elif method in ["prep"]:
            return self._handle_with_review_manager(
                method, params, PrepHandler
            )
        elif method in ["dedupe"]:
            return self._handle_with_review_manager(
                method, params, DedupeHandler
            )
        elif method in ["prescreen"]:
            return self._handle_with_review_manager(
                method, params, PrescreenHandler
            )
        elif method in ["pdf_get"]:
            return self._handle_with_review_manager(
                method, params, PDFGetHandler
            )
        elif method in ["pdf_prep"]:
            return self._handle_with_review_manager(
                method, params, PDFPrepHandler
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

        # Capture stdout to prevent CoLRev operations from polluting JSON-RPC responses
        original_stdout = sys.stdout
        stdout_buffer = io.StringIO()

        try:
            os.chdir(project_path)

            # Redirect stdout to a buffer (not stderr, to avoid TTY issues)
            # JSON-RPC responses use the real stdout, so operations must not print there
            sys.stdout = stdout_buffer

            # Create ReviewManager
            review_manager = colrev.review_manager.ReviewManager(
                path_str=str(project_path),
                force_mode=params.get("force", True),  # Force mode to skip prompts
                verbose_mode=params.get("verbose", False),
                high_level_operation=True,  # Suppress unnecessary output
            )

            # Create handler instance
            handler = handler_class(review_manager)

            # Call the method
            if hasattr(handler, method):
                method_func = getattr(handler, method)
                result = method_func(params)

                # Log captured output to stderr for debugging if needed
                captured = stdout_buffer.getvalue()
                if captured:
                    logger.debug(f"Captured output from {method}: {captured[:500]}")

                return result
            else:
                raise ValueError(f"Handler {handler_class.__name__} does not support method '{method}'")

        finally:
            # Always restore original stdout and directory
            sys.stdout = original_stdout
            os.chdir(original_cwd)
