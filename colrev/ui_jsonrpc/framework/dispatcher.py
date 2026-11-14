"""Dispatcher: turns a JSON-RPC request into a typed handler call.

Replaces the hand-rolled if/elif router in ``handler.py``. Every registered
method flows through one code path:

1. Look up MethodSpec by method name.
2. Validate params against ``spec.request_model`` (Pydantic).
3. If ``spec.requires_project``: construct a ``ReviewManager`` rooted at the
   resolved project path, apply ``spec.precondition`` (the engine's operation
   preconditions apply unchanged unless the method is a per-record
   manual-decision endpoint), inject LazyWriteGitRepo. ``spec.git_only``
   methods get no ReviewManager: they must work on a project whose settings or
   search-history files are broken.
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
from typing import List
from typing import TypeVar

from git import GitCommandError
from pydantic import ValidationError

import colrev.exceptions as colrev_exceptions
from colrev.ui_jsonrpc import transport
from colrev.ui_jsonrpc import validation
from colrev.ui_jsonrpc.framework import portability
from colrev.ui_jsonrpc.framework.context import HandlerContext
from colrev.ui_jsonrpc.framework.lazy_git import IndexLockedError
from colrev.ui_jsonrpc.framework.lazy_git import close_lazy_git_repo
from colrev.ui_jsonrpc.framework.lazy_git import install_lazy_git_repo
from colrev.ui_jsonrpc.framework.project_files import build_review_manager
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
    # GitPython's own lock failure is an OSError/IOError naming the lock file.
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
        except IndexLockedError:
            raise  # already waited a bounded time in lazy_git; do not wait again
        except (
            GitCommandError,
            colrev_exceptions.GitNotAvailableError,
            OSError,
        ) as exc:
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
    if isinstance(last_exc, colrev_exceptions.GitNotAvailableError):
        raise last_exc
    # Still locked after the retries: report it as -32006, not -32603.
    raise IndexLockedError() from last_exc


def _as_lock_error(exc: BaseException) -> BaseException:
    """The exception to raise for a failure that ran inside a handler body.

    A handler that already ran is not re-run, so a lock failure inside it is
    reported as -32006 right away (the user can retry the action) instead of
    being retried here.
    """
    if isinstance(exc, IndexLockedError):
        return exc
    if isinstance(
        exc, (GitCommandError, colrev_exceptions.GitNotAvailableError, OSError)
    ) and _is_lock_error(exc):
        if isinstance(exc, colrev_exceptions.GitNotAvailableError):
            return exc
        locked = IndexLockedError()
        locked.__cause__ = exc
        return locked
    return exc


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
        return _retry_on_lock(
            method, lambda: self._dispatch_no_project(spec, request_obj)
        )

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
        with transport.stdout_to_devnull():
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

        # OS-level fd 1 redirect so child processes (and Python-level prints)
        # can't pollute the JSON-RPC stream. Responses and progress events are
        # written through the private wire handle captured at server startup
        # (see colrev.ui_jsonrpc.transport), so this redirect only silences
        # writers that were never supposed to touch the wire.
        with transport.stdout_to_devnull():
            return self._run_project_scoped(spec, request_obj, project_path)

    def _build_context(
        self,
        spec: MethodSpec,
        request_obj,
        project_path,
        built: List[HandlerContext],
    ) -> HandlerContext:
        """Construct the ReviewManager (unless git-only) and the handler context.

        Every context built is appended to ``built`` so that the request's
        cleanup (:meth:`_release`) reaches all of them, retried ones too.
        """
        review_manager = None
        if not spec.git_only:
            review_manager = build_review_manager(
                project_path,
                verbose_mode=getattr(request_obj, "verbose", False),
            )
            if spec.precondition == "manual_decision":
                # Narrow engine relaxation (see colrev/PATCHES.md): per-record
                # prescreen/screen decisions may run with only data/records.bib
                # dirty, mirroring the engine's prep_man precedent.
                review_manager.manual_decision_mode = True
            install_lazy_git_repo(review_manager, Path(project_path))
            _keep_history_portable(review_manager, Path(project_path))

        ctx = HandlerContext(
            method_name=spec.name,
            project_id=getattr(request_obj, "project_id", None),
            project_path=Path(project_path),
            review_manager=review_manager,
        )
        built.append(ctx)
        return ctx

    def _call_handler(
        self, spec: MethodSpec, request_obj, ctx: HandlerContext
    ) -> Dict[str, Any]:
        """Run the handler once. On failure, drop the project's records cache.

        A handler that fails part-way through a save can leave the process-wide
        records cache ahead of ``records.bib`` (see colrev/PATCHES.md), so
        later reads would serve a change that was never written.
        """
        try:
            handler = spec.handler_cls(ctx)
            response_obj = spec.handler(handler, request_obj)
            return _serialize(spec, response_obj)
        except BaseException:
            if ctx.review_manager is not None:
                try:
                    ctx.review_manager.dataset.invalidate_records_cache()
                except Exception:  # noqa: BLE001
                    logger.debug("Could not invalidate records cache", exc_info=True)
            raise

    def _run_project_scoped(
        self,
        spec: MethodSpec,
        request_obj,
        project_path,
    ) -> Dict[str, Any]:
        original_cwd = os.getcwd()
        built: List[HandlerContext] = []
        try:
            os.chdir(project_path)
            if spec.writes:
                # Building the context runs no handler code, so it is safe to
                # retry on lock contention. The handler body is not: it may
                # already have hit the network or saved records, and running
                # it again would repeat that. A lock failure inside it is
                # reported (-32006) and the user retries the action.
                ctx = _retry_on_lock(
                    spec.name,
                    lambda: self._build_context(
                        spec, request_obj, project_path, built
                    ),
                )
                try:
                    return self._call_handler(spec, request_obj, ctx)
                except Exception as exc:
                    mapped = _as_lock_error(exc)
                    if mapped is exc:
                        raise
                    raise mapped from exc
            # Read-only methods are idempotent: retry the whole call.
            return _retry_on_lock(
                spec.name,
                lambda: self._call_handler(
                    spec,
                    request_obj,
                    self._build_context(spec, request_obj, project_path, built),
                ),
            )
        finally:
            os.chdir(original_cwd)
            self._release(built, Path(project_path), spec.writes)

    @staticmethod
    def _release(
        built: List[HandlerContext],
        project_path: Path,
        writes: bool,
    ) -> None:
        """End-of-request cleanup: LF files, no open handles on the project."""
        try:
            if writes:
                portability.lf_sweep(project_path)
        except OSError:
            logger.exception("Could not normalise line endings in %s", project_path)
        finally:
            for ctx in built:
                ctx.close_repos()
                close_lazy_git_repo(ctx.review_manager)
            portability.close_log_handlers(project_path)


def _keep_history_portable(review_manager: Any, project_path: Path) -> None:
    """After every ``save_settings``, put the history files' paths in POSIX form.

    Core writes ``str(Path)`` into ``data/search/*_search_history.json``, which
    on Windows is ``data\\search\\db1.bib``. Pulled onto a Mac that makes the
    source unreadable (see :mod:`colrev.ui_jsonrpc.framework.portability`).
    """
    original = review_manager.save_settings

    def save_settings(*args: Any, **kwargs: Any) -> Any:
        result = original(*args, **kwargs)
        portability.normalize_history_files(project_path)
        return result

    review_manager.save_settings = save_settings


def _serialize(spec: MethodSpec, response_obj) -> Dict[str, Any]:
    """Produce the result dict. Handlers must return ``spec.response_model``.

    Nullable fields serialize as ``null`` (no ``exclude_none``) so the wire
    shape matches the generated TypeScript types, where optional model fields
    are ``field?: T | null``.
    """
    if isinstance(response_obj, spec.response_model):
        return response_obj.model_dump(mode="json")
    raise TypeError(
        f"Handler for {spec.name!r} returned {type(response_obj).__name__}; "
        f"expected {spec.response_model.__name__}."
    )
