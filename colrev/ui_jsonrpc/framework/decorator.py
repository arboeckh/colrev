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
from colrev.ui_jsonrpc.framework.registry import PreconditionPolicy


def rpc_method(
    *,
    name: str,
    request: Type[BaseModel],
    response: Type[BaseModel],
    operation_type: Optional[OperationsType] = None,
    requires_project: bool = True,
    writes: bool = False,
    timeout_class: str = "slow",
    precondition: PreconditionPolicy = "enforce",
) -> Callable:
    """Mark a handler method as an RPC endpoint.

    Args:
        name: JSON-RPC method string.
        request: Pydantic request model class.
        response: Pydantic response model class.
        operation_type: If this wraps a CoLRev operation, the OperationsType.
            None for UI-native methods.
        requires_project: False for project-list / ping / init endpoints.
        writes: True if the handler mutates on-disk project state. Load-bearing
            in the renderer (post-write refresh keys off the exported schema) —
            any handler that commits, saves, or stages files must set it.
        timeout_class: ``"fast"`` for cheap read/status methods (client caps
            server processing at ~10s); ``"slow"`` (default) for everything
            else — no client-side cap, liveness comes from progress events
            and crash detection.
        precondition: Engine precondition policy (see
            :data:`~colrev.ui_jsonrpc.framework.registry.PreconditionPolicy`).
            "manual_decision" is reserved for per-record prescreen/screen
            decision endpoints; everything else keeps the default "enforce".
    """

    if timeout_class not in ("fast", "slow"):
        raise ValueError(
            f"timeout_class must be 'fast' or 'slow', got {timeout_class!r}"
        )

    draft = MethodSpecDraft(
        name=name,
        request_model=request,
        response_model=response,
        operation_type=operation_type,
        requires_project=requires_project,
        writes=writes,
        timeout_class=timeout_class,
        precondition=precondition,
    )

    def decorator(fn: Callable) -> Callable:
        fn.__rpc_draft__ = draft  # type: ignore[attr-defined]
        return fn

    return decorator
