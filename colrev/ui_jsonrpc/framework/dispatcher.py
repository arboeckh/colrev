"""Dispatcher: turns a JSON-RPC request into a typed handler call.

Replaces the hand-rolled if/elif router in ``handler.py``. Every registered
method flows through one code path:

1. Look up MethodSpec by method name.
2. Validate params against ``spec.request_model`` (Pydantic).
3. If ``spec.requires_project``: construct ``ReviewManager(interactive_mode=True)``
   rooted at the resolved project path, inject LazyWriteGitRepo.
4. Instantiate ``spec.handler_cls`` with a HandlerContext.
5. Call the handler, serialize the response via ``model_dump``.
"""

from __future__ import annotations

import io
import logging
import os
import sys
from pathlib import Path
from typing import Any
from typing import Dict

from pydantic import ValidationError

import colrev.review_manager
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.framework.context import HandlerContext
from colrev.ui_jsonrpc.framework.lazy_git import LazyWriteGitRepo
from colrev.ui_jsonrpc.framework.registry import MethodSpec
from colrev.ui_jsonrpc.framework.registry import registry

logger = logging.getLogger(__name__)


class Dispatcher:
    """Single entry point for registered RPC methods."""

    def dispatch(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Run a registered method. Returns the plain result dict.

        Raises ``ValueError`` for unknown methods or validation failures —
        the outer JSONRPCHandler translates these to JSON-RPC error responses
        via ``error_handler.map_exception_to_error_code``.
        """
        spec = registry.get(method)  # raises ValueError if unknown

        try:
            request_obj = spec.request_model.model_validate(params or {})
        except ValidationError as exc:
            # Re-raise as ValueError so error_handler maps it to -32602 INVALID_PARAMS
            raise ValueError(f"Invalid params for {method!r}: {exc}") from exc

        if spec.requires_project:
            return self._dispatch_project_scoped(spec, request_obj)
        return self._dispatch_no_project(spec, request_obj)

    def _dispatch_no_project(
        self,
        spec: MethodSpec,
        request_obj,
    ) -> Dict[str, Any]:
        ctx = HandlerContext(
            method_name=spec.name,
            project_id=None,
            project_path=None,
            review_manager=None,
            writes=spec.writes,
        )
        handler = spec.handler_cls(ctx)
        response_obj = spec.handler(handler, request_obj)
        return _serialize(spec, response_obj)

    def _dispatch_project_scoped(
        self,
        spec: MethodSpec,
        request_obj,
    ) -> Dict[str, Any]:
        # ProjectScopedRequest guarantees project_id. Resolve path via existing
        # validation (reused verbatim for path-traversal protection).
        params_dict = request_obj.model_dump()
        project_path = validation.validate_existing_project(params_dict)

        original_cwd = os.getcwd()

        # OS-level fd 1 redirect so multiprocessing children can't pollute stdout
        # (stdout is the JSON-RPC transport — nothing else may write to it).
        saved_stdout_fd = os.dup(1)
        devnull_fd = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull_fd, 1)
        os.close(devnull_fd)

        original_stdout = sys.stdout
        stdout_buffer = io.StringIO()
        sys.stdout = stdout_buffer

        try:
            os.chdir(project_path)
            review_manager = colrev.review_manager.ReviewManager(
                path_str=str(project_path),
                interactive_mode=True,
                verbose_mode=getattr(request_obj, "verbose", False),
                high_level_operation=True,
            )
            review_manager.dataset.__dict__["git_repo"] = LazyWriteGitRepo(
                Path(project_path)
            )

            ctx = HandlerContext(
                method_name=spec.name,
                project_id=getattr(request_obj, "project_id", None),
                project_path=project_path,
                review_manager=review_manager,
                writes=spec.writes,
            )
            handler = spec.handler_cls(ctx)
            response_obj = spec.handler(handler, request_obj)

            captured = stdout_buffer.getvalue()
            if captured:
                logger.debug(
                    "Captured stdout from %s: %s", spec.name, captured[:500]
                )

            return _serialize(spec, response_obj)

        finally:
            sys.stdout = original_stdout
            os.dup2(saved_stdout_fd, 1)
            os.close(saved_stdout_fd)
            os.chdir(original_cwd)


def _serialize(spec: MethodSpec, response_obj) -> Dict[str, Any]:
    """Produce the result dict. Accepts either a Pydantic model or a dict
    (dict is a migration helper — real handlers return ``spec.response_model``)."""
    if hasattr(response_obj, "model_dump"):
        return response_obj.model_dump(mode="json", exclude_none=True)
    if isinstance(response_obj, dict):
        return response_obj
    raise TypeError(
        f"Handler for {spec.name!r} returned {type(response_obj).__name__}; "
        "expected a Pydantic model or dict."
    )
