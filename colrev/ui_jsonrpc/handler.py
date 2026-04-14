"""Main JSON-RPC request entry point.

All routing is handled by the typed framework dispatcher
(:mod:`colrev.ui_jsonrpc.framework.dispatcher`). Method registration happens
as a side effect of importing :mod:`colrev.ui_jsonrpc.framework_handlers`,
which is done once in :meth:`JSONRPCHandler.__init__`.

The legacy if/elif router and `_handle_with_review_manager` plumbing lived
here through Phase B/C migration and were deleted once every handler moved
into the framework. For the wrapper that defers GitRepo write ops, see
:class:`colrev.ui_jsonrpc.framework.LazyWriteGitRepo`.
"""

import logging
from typing import Any
from typing import Dict

from colrev.ui_jsonrpc import error_handler
from colrev.ui_jsonrpc.framework.dispatcher import Dispatcher

logger = logging.getLogger(__name__)


class JSONRPCHandler:
    """Handle JSON-RPC 2.0 requests via the typed framework dispatcher."""

    def __init__(self) -> None:
        # Importing the framework_handlers package registers every
        # @rpc_method-decorated handler into the global registry.
        import colrev.ui_jsonrpc.framework_handlers  # noqa: F401

        self._dispatcher = Dispatcher()

    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Process a JSON-RPC 2.0 request and return a response envelope."""
        if request.get("jsonrpc") != "2.0":
            return error_handler.create_error_response(
                error_handler.INVALID_REQUEST,
                "Invalid Request",
                "jsonrpc version must be 2.0",
                request.get("id"),
            )

        method = request.get("method")
        params = request.get("params", {}) or {}
        request_id = request.get("id")

        if not method:
            return error_handler.create_error_response(
                error_handler.INVALID_REQUEST,
                "Invalid Request",
                "method is required",
                request_id,
            )

        try:
            result = self._dispatcher.dispatch(method, params)
            return {"jsonrpc": "2.0", "result": result, "id": request_id}

        except Exception as exc:  # noqa: BLE001 — translated to JSON-RPC error
            logger.exception("Error executing method %s", method)
            return error_handler.handle_exception(exc, request_id)
