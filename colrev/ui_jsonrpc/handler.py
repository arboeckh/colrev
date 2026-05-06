"""Main JSON-RPC request entry point.

All routing is handled by the typed framework dispatcher
(:mod:`colrev.ui_jsonrpc.framework.dispatcher`). Method registration happens
as a side effect of importing :mod:`colrev.ui_jsonrpc.framework_handlers`,
which is deferred until the first non-``ping`` request so the packaged
server can respond to readiness probes before the heavy colrev/ops/review
imports finish loading.

The legacy if/elif router and `_handle_with_review_manager` plumbing lived
here through Phase B/C migration and were deleted once every handler moved
into the framework. For the wrapper that defers GitRepo write ops, see
:class:`colrev.ui_jsonrpc.framework.LazyWriteGitRepo`.
"""

import logging
import threading
from typing import Any
from typing import Dict
from typing import Optional
from typing import TYPE_CHECKING

from colrev.ui_jsonrpc import error_handler
from colrev.ui_jsonrpc.framework.models import PingResponse

if TYPE_CHECKING:
    from colrev.ui_jsonrpc.framework.dispatcher import Dispatcher

logger = logging.getLogger(__name__)


class JSONRPCHandler:
    """Handle JSON-RPC 2.0 requests via the typed framework dispatcher."""

    def __init__(self) -> None:
        # The dispatcher (and, transitively, colrev.review_manager + every
        # handler module) is constructed on first non-ping request. The
        # packaged app uses this window to show a splash and let the user
        # see that the process is alive.
        self._dispatcher: Optional["Dispatcher"] = None
        self._dispatcher_lock = threading.Lock()

    def preload(self) -> None:
        """Force dispatcher construction now. Called from a background
        thread in server.py so the heavy import cost is paid while the
        renderer is still painting, not on the first user action."""
        try:
            self._ensure_dispatcher()
        except Exception:  # noqa: BLE001 — preload is best-effort
            logger.exception("Background handler preload failed")

    def _ensure_dispatcher(self) -> "Dispatcher":
        if self._dispatcher is not None:
            return self._dispatcher
        with self._dispatcher_lock:
            if self._dispatcher is None:
                from colrev.ui_jsonrpc.framework.dispatcher import Dispatcher

                # Importing the framework_handlers package registers every
                # @rpc_method-decorated handler into the global registry.
                import colrev.ui_jsonrpc.framework_handlers  # noqa: F401

                self._dispatcher = Dispatcher()
        return self._dispatcher

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

        # Fast path: the readiness probe must not block on dispatcher
        # construction. Uses the same PingResponse model as SystemHandler.ping.
        if method == "ping":
            return {
                "jsonrpc": "2.0",
                "result": PingResponse().model_dump(mode="json", exclude_none=True),
                "id": request_id,
            }

        try:
            dispatcher = self._ensure_dispatcher()
            result = dispatcher.dispatch(method, params)
            return {"jsonrpc": "2.0", "result": result, "id": request_id}

        except Exception as exc:  # noqa: BLE001 — translated to JSON-RPC error
            logger.exception("Error executing method %s", method)
            return error_handler.handle_exception(exc, request_id)
