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

import logging
import os
import re
import time
from pathlib import Path
from typing import Any
from typing import Callable
from typing import Dict
from typing import TypeVar

from git import GitCommandError
from pydantic import ValidationError

import colrev.exceptions as colrev_exceptions
import colrev.review_manager
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.framework.context import HandlerContext
from colrev.ui_jsonrpc.framework.lazy_git import install_lazy_git_repo
from colrev.ui_jsonrpc.framework.registry import MethodSpec
from colrev.ui_jsonrpc.framework.registry import registry

logger = logging.getLogger(__name__)

# Lock-contention patterns we retry transparently. External tools (user's
# terminal, IDE git integration, antivirus on Windows) can grab `.git/index.lock`
# briefly — the main-process git mutex stops our own paths from racing, but
# third-party holders still surface as transient errors here.
_LOCK_ERROR_PATTERNS = (
    re.compile(r"index\.lock"),
    re.compile(r"Unable to create .*\.lock"),
    re.compile(r"File exists.*\.lock"),
)
_LOCK_RETRY_BACKOFFS_SEC: tuple[float, ...] = (0.1, 0.3, 0.9)

_T = TypeVar("_T")


def _is_lock_error(exc: BaseException) -> bool:
    if isinstance(exc, colrev_exceptions.GitNotAvailableError):
        return True
    message = str(exc)
    return any(pat.search(message) for pat in _LOCK_ERROR_PATTERNS)


def _retry_on_lock(method_name: str, fn: Callable[[], _T]) -> _T:
    """Run ``fn`` with transparent retry on git index-lock contention."""
    last_exc: BaseException | None = None
    for attempt, backoff in enumerate((0.0,) + _LOCK_RETRY_BACKOFFS_SEC):
        if backoff:
            time.sleep(backoff)
        try:
            return fn()
        except (GitCommandError, colrev_exceptions.GitNotAvailableError) as exc:
            if not _is_lock_error(exc):
                raise
            last_exc = exc
            logger.warning(
                "Git lock contention on %s (attempt %d): %s",
                method_name,
                attempt + 1,
                exc,
            )
    assert last_exc is not None  # loop always executes at least once
    raise last_exc


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
            return _retry_on_lock(
                method, lambda: self._dispatch_project_scoped(spec, request_obj)
            )
        return _retry_on_lock(method, lambda: self._dispatch_no_project(spec, request_obj))

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

        # OS-level fd 1 redirect so child processes (and Python-level prints)
        # can't pollute stdout — stdout is the JSON-RPC transport, nothing
        # else may write to it.
        saved_stdout_fd = os.dup(1)
        devnull_fd = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull_fd, 1)
        os.close(devnull_fd)

        try:
            os.chdir(project_path)
            review_manager = colrev.review_manager.ReviewManager(
                path_str=str(project_path),
                interactive_mode=True,
                verbose_mode=getattr(request_obj, "verbose", False),
                high_level_operation=True,
            )
            install_lazy_git_repo(review_manager, Path(project_path))

            ctx = HandlerContext(
                method_name=spec.name,
                project_id=getattr(request_obj, "project_id", None),
                project_path=project_path,
                review_manager=review_manager,
            )
            handler = spec.handler_cls(ctx)
            response_obj = spec.handler(handler, request_obj)

            return _serialize(spec, response_obj)

        finally:
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
