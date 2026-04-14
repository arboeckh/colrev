"""@rpc_method decorator: attaches a MethodSpec to a handler method.

Registration into the global registry happens lazily — the first time a
BaseHandler subclass is imported and its methods are inspected. This avoids
the decorator firing before all models are importable.
"""

from __future__ import annotations

from typing import Callable
from typing import Optional
from typing import Type

from pydantic import BaseModel

from colrev.constants import OperationsType


def rpc_method(
    *,
    name: str,
    request: Type[BaseModel],
    response: Type[BaseModel],
    operation_type: Optional[OperationsType] = None,
    notify: bool = False,
    writes: bool = False,
    requires_project: bool = True,
) -> Callable:
    """Mark a handler method as an RPC endpoint.

    The actual registration into the global registry happens when the handler
    class is processed by ``BaseHandler.__init_subclass__``. This decorator
    only attaches metadata to the function.

    Args:
        name: JSON-RPC method string.
        request: Pydantic request model class.
        response: Pydantic response model class.
        operation_type: If this wraps a CoLRev operation, the OperationsType.
            None for UI-native methods.
        notify: Forwarded to ``get_*_operation(notify_state_transition_operation=...)``.
        writes: Hint that this method mutates state (records.bib, settings, git).
            Does NOT cause auto-commit.
        requires_project: False for project-list / ping / init endpoints.
    """

    def decorator(fn: Callable) -> Callable:
        fn.__rpc_meta__ = {  # type: ignore[attr-defined]
            "name": name,
            "request": request,
            "response": response,
            "operation_type": operation_type,
            "notify": notify,
            "writes": writes,
            "requires_project": requires_project,
        }
        return fn

    return decorator
