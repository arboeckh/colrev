"""@rpc_method decorator: attaches a MethodSpecDraft to a handler method.

Registration into the global registry happens when the surrounding
:class:`BaseHandler` subclass is processed by ``__init_subclass__``;
the draft is finalised there by attaching ``handler`` and ``handler_cls``.
"""

from __future__ import annotations

from typing import Callable
from typing import Optional
from typing import Type

from pydantic import BaseModel

from colrev.constants import OperationsType
from colrev.ui_jsonrpc.framework.registry import MethodSpecDraft


def rpc_method(
    *,
    name: str,
    request: Type[BaseModel],
    response: Type[BaseModel],
    operation_type: Optional[OperationsType] = None,
    requires_project: bool = True,
) -> Callable:
    """Mark a handler method as an RPC endpoint.

    Args:
        name: JSON-RPC method string.
        request: Pydantic request model class.
        response: Pydantic response model class.
        operation_type: If this wraps a CoLRev operation, the OperationsType.
            None for UI-native methods.
        requires_project: False for project-list / ping / init endpoints.
    """

    draft = MethodSpecDraft(
        name=name,
        request_model=request,
        response_model=response,
        operation_type=operation_type,
        requires_project=requires_project,
    )

    def decorator(fn: Callable) -> Callable:
        fn.__rpc_draft__ = draft  # type: ignore[attr-defined]
        return fn

    return decorator
