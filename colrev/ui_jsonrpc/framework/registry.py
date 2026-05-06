"""Global method registry and MethodSpec definition."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from typing import Iterable
from typing import Optional
from typing import Type

from pydantic import BaseModel

from colrev.constants import OperationsType


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
    """

    name: str
    request_model: Type[BaseModel]
    response_model: Type[BaseModel]
    handler: Callable
    handler_cls: Type
    operation_type: Optional[OperationsType] = None
    requires_project: bool = True


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
            raise ValueError(f"Method {name!r} not found") from exc

    def has(self, name: str) -> bool:
        return name in self._methods

    def all(self) -> Iterable[MethodSpec]:
        return self._methods.values()

    def names(self) -> list[str]:
        return sorted(self._methods.keys())


registry = MethodRegistry()
