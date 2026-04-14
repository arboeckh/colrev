"""BaseHandler: every handler class inherits from this.

Subclassing triggers registration: every method decorated with ``@rpc_method``
on the class is inserted into the global ``registry`` when the class is
declared. Subclasses only define methods — no boilerplate __init__ or routing.
"""

from __future__ import annotations

from typing import Optional

import colrev.review_manager
from colrev.constants import OperationsType
from colrev.ui_jsonrpc.framework.context import HandlerContext
from colrev.ui_jsonrpc.framework.registry import MethodSpec
from colrev.ui_jsonrpc.framework.registry import registry


class BaseHandler:
    """Shared base for typed JSON-RPC handler classes.

    Provides:
    - ``self.review_manager``: set by the dispatcher (None for no-project methods).
    - ``self.ctx``: the HandlerContext for this request.
    - ``self.op(op_type, *, notify)``: helper to construct a CoLRev operation,
      validated against the declared ``operation_type`` of the method spec.

    No commit logic. Writes stage; commits happen only via the
    ``commit_changes`` method.
    """

    def __init__(self, ctx: HandlerContext):
        self.ctx = ctx
        self.review_manager: Optional[colrev.review_manager.ReviewManager] = (
            ctx.review_manager
        )

    def __init_subclass__(cls, **kwargs) -> None:
        """Register every @rpc_method-decorated method on the subclass."""
        super().__init_subclass__(**kwargs)
        for attr_name in dir(cls):
            # Skip inherited / underscore attributes cheaply
            if attr_name.startswith("_"):
                continue
            attr = getattr(cls, attr_name, None)
            meta = getattr(attr, "__rpc_meta__", None)
            if meta is None:
                continue
            # Avoid double-registering if a subclass re-exposes a parent method
            if registry.has(meta["name"]):
                continue
            spec = MethodSpec(
                name=meta["name"],
                request_model=meta["request"],
                response_model=meta["response"],
                handler=attr,
                handler_cls=cls,
                operation_type=meta["operation_type"],
                notify_state_transition=meta["notify"],
                writes=meta["writes"],
                requires_project=meta["requires_project"],
            )
            registry.register(spec)

    def op(
        self,
        op_type: OperationsType,
        *,
        notify: Optional[bool] = None,
    ):
        """Get a CoLRev operation via review_manager's factory.

        Args:
            op_type: The CoLRev OperationsType.
            notify: Override for notify_state_transition_operation. If None,
                uses the MethodSpec's ``notify_state_transition`` setting.
        """
        if self.review_manager is None:
            raise RuntimeError(
                "op() called on a handler context without a ReviewManager — "
                "this method was declared with requires_project=False."
            )
        effective_notify = (
            notify
            if notify is not None
            else self._spec().notify_state_transition
        )
        factory_name = f"get_{op_type.name}_operation"
        factory = getattr(self.review_manager, factory_name, None)
        if factory is None:
            raise RuntimeError(
                f"ReviewManager has no factory {factory_name!r} for "
                f"operation_type {op_type!r}."
            )
        return factory(notify_state_transition_operation=effective_notify)

    def _spec(self) -> MethodSpec:
        return registry.get(self.ctx.method_name)
