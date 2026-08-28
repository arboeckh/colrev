"""Global method registry and MethodSpec definition."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from typing import Iterable
from typing import Optional
from typing import Type

from pydantic import BaseModel

from colrev.constants import OperationsType
from colrev.ui_jsonrpc.errors import MethodNotFoundError


@dataclass(frozen=True)
class MethodSpecDraft:
    """Decorator-time slice of a MethodSpec.

    The decorator can fill these fields, but ``handler_cls`` is only known
    once the surrounding class body has finished executing — so
    ``BaseHandler.__init_subclass__`` finalises a draft into a full
    :class:`MethodSpec` by attaching the handler function and class.
    """

    name: str
    request_model: Type[BaseModel]
    response_model: Type[BaseModel]
    operation_type: Optional[OperationsType] = None
    requires_project: bool = True
    writes: bool = False
    timeout_class: str = "slow"


@dataclass(frozen=True)
class MethodSpec:
    """Complete description of a JSON-RPC method.

    Fields:
        name: JSON-RPC method string (e.g. ``"prescreen_record"``).
        request_model: Pydantic model validating incoming params.
        response_model: Pydantic model for the return value.
        handler: Unbound handler function. Called as ``handler(handler_instance, request)``.
        handler_cls: Handler class (subclass of BaseHandler). Dispatcher instantiates.
        operation_type: If set, framework knows this wraps a CoLRev operation. If None,
            this is a UI-native / custom method — framework provides ReviewManager + repo
            but does not trigger any operation lifecycle.
        requires_project: If True, the request must be a ProjectScopedRequest and the
            dispatcher will construct a ReviewManager. If False (``ping``, ``list_projects``,
            ``init_project``), no ReviewManager is built.
        writes: Hint that this method mutates state (records.bib, settings, git).
            Exported to the frontend schema so the renderer knows to refresh
            git/pending-changes state after a successful call. Does NOT cause
            auto-commit.
        timeout_class: ``"fast"`` for cheap read/status methods the client may
            time out after ~10s of server processing; ``"slow"`` (default) for
            operations with no client-side cap — the client relies on progress
            events and process liveness instead, so a long-running op can never
            end in "timed out in the UI but committed on disk".
    """

    name: str
    request_model: Type[BaseModel]
    response_model: Type[BaseModel]
    handler: Callable
    handler_cls: Type
    operation_type: Optional[OperationsType] = None
    requires_project: bool = True
    writes: bool = False
    timeout_class: str = "slow"


class MethodRegistry:
    """Holds the globally registered MethodSpecs."""

    def __init__(self) -> None:
        self._methods: dict[str, MethodSpec] = {}

    def register(self, spec: MethodSpec) -> None:
        if spec.name in self._methods:
            raise ValueError(
                f"Duplicate RPC method registration: {spec.name!r} "
                f"(existing handler: {self._methods[spec.name].handler_cls.__name__})"
            )
        self._methods[spec.name] = spec

    def get(self, name: str) -> MethodSpec:
        try:
            return self._methods[name]
        except KeyError as exc:
            raise MethodNotFoundError(f"Method {name!r} not found") from exc

    def has(self, name: str) -> bool:
        return name in self._methods

    def all(self) -> Iterable[MethodSpec]:
        return self._methods.values()

    def names(self) -> list[str]:
        return sorted(self._methods.keys())


registry = MethodRegistry()
