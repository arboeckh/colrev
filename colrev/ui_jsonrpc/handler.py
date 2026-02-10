"""Main JSON-RPC request handler and router."""
import io
import logging
import os
import sys
from typing import Any
from typing import Dict

import colrev.review_manager
from colrev.ui_jsonrpc import error_handler
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.handlers import DataHandler
from colrev.ui_jsonrpc.handlers import DedupeHandler
from colrev.ui_jsonrpc.handlers import GitHandler
from colrev.ui_jsonrpc.handlers import InitHandler
from colrev.ui_jsonrpc.handlers import LoadHandler
from colrev.ui_jsonrpc.handlers import PDFGetHandler
from colrev.ui_jsonrpc.handlers import PDFPrepHandler
from colrev.ui_jsonrpc.handlers import PrepHandler
from colrev.ui_jsonrpc.handlers import PrescreenHandler
from colrev.ui_jsonrpc.handlers import RecordsHandler
from colrev.ui_jsonrpc.handlers import ScreenHandler
from colrev.ui_jsonrpc.handlers import SearchHandler
from colrev.ui_jsonrpc.handlers import SettingsHandler
from colrev.ui_jsonrpc.handlers import StatusHandler

logger = logging.getLogger(__name__)


class JSONRPCHandler:
    """Handle JSON-RPC 2.0 requests and route to appropriate operation handlers."""

    def __init__(self):
        """Initialize the JSON-RPC handler."""
        # Handlers will be initialized per-project as needed

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
        elif method == "list_projects":
            return InitHandler.list_projects(params)
        elif method == "delete_project":
            return InitHandler.delete_project(params)

        # Methods that require an existing project

        # Status operations
        elif method in [
            "get_status",
            "status",
            "validate",
            "get_operation_info",
            "get_preprocessing_summary",
        ]:
            return self._handle_with_review_manager(method, params, StatusHandler)

        # Settings operations
        elif method in ["get_settings", "update_settings"]:
            return self._handle_with_review_manager(method, params, SettingsHandler)

        # Records operations
        elif method in ["get_records", "get_record", "update_record"]:
            return self._handle_with_review_manager(method, params, RecordsHandler)

        # Git operations
        elif method in ["get_git_status"]:
            return self._handle_with_review_manager(method, params, GitHandler)

        # Search operations
        elif method in [
            "search",
            "get_sources",
            "add_source",
            "update_source",
            "remove_source",
            "upload_search_file",
            "get_source_records",
        ]:
            return self._handle_with_review_manager(method, params, SearchHandler)

        # Load operations
        elif method in ["load"]:
            return self._handle_with_review_manager(method, params, LoadHandler)

        # Prep operations
        elif method in ["prep"]:
            return self._handle_with_review_manager(method, params, PrepHandler)

        # Dedupe operations
        elif method in ["dedupe"]:
            return self._handle_with_review_manager(method, params, DedupeHandler)

        # Prescreen operations
        elif method in [
            "prescreen",
            "get_prescreen_queue",
            "prescreen_record",
            "enrich_record_metadata",
            "batch_enrich_records",
        ]:
            return self._handle_with_review_manager(method, params, PrescreenHandler)

        # PDF get operations
        elif method in ["pdf_get"]:
            return self._handle_with_review_manager(method, params, PDFGetHandler)

        # PDF prep operations
        elif method in ["pdf_prep"]:
            return self._handle_with_review_manager(method, params, PDFPrepHandler)

        # Screen operations
        elif method in ["screen", "get_screen_queue", "screen_record"]:
            return self._handle_with_review_manager(method, params, ScreenHandler)

        # Data operations
        elif method in ["data"]:
            return self._handle_with_review_manager(method, params, DataHandler)

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

        # OS-level fd redirect: captures output from child processes (e.g. bib_dedupe
        # multiprocessing workers) that bypass Python-level sys.stdout redirects.
        saved_stdout_fd = os.dup(1)
        devnull_fd = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull_fd, 1)
        os.close(devnull_fd)

        # Python-level redirect as belt-and-suspenders
        original_stdout = sys.stdout
        stdout_buffer = io.StringIO()
        sys.stdout = stdout_buffer

        try:
            os.chdir(project_path)

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
                raise ValueError(
                    f"Handler {handler_class.__name__} does not support method '{method}'"
                )

        finally:
            # Restore Python-level stdout first, then OS-level fd 1
            sys.stdout = original_stdout
            os.dup2(saved_stdout_fd, 1)
            os.close(saved_stdout_fd)
            os.chdir(original_cwd)
