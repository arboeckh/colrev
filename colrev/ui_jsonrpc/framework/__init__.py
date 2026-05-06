"""Typed handler framework for the CoLRev JSON-RPC layer.

Every JSON-RPC method is defined as a triple:
    (RequestModel: BaseModel, ResponseModel: BaseModel, handler: Callable)
registered via the ``@rpc_method`` decorator. The dispatcher then owns:

- param validation (Pydantic),
- ReviewManager lifecycle (constructed with interactive_mode=True),
- injection of the LazyWriteGitRepo,
- response serialization.

No handler commits. Commits are only produced by the dedicated
``commit_changes`` endpoint. Write handlers stage changes via
``dataset.save_records_dict(partial=True)`` or native operation methods.

Two classes of methods are first-class:
1. **CoLRev-wrapped**: pass ``operation_type=OperationsType.<x>``; the framework
   knows this method wraps a core operation.
2. **UI-native / custom**: omit ``operation_type``; the handler still receives
   a ReviewManager + repo handle but no operation lifecycle is triggered.
"""

from colrev.ui_jsonrpc.framework.base_handler import BaseHandler
from colrev.ui_jsonrpc.framework.context import HandlerContext
from colrev.ui_jsonrpc.framework.decorator import rpc_method
from colrev.ui_jsonrpc.framework.domain import ProgressEvent
from colrev.ui_jsonrpc.framework.domain import ProgressEventKind
from colrev.ui_jsonrpc.framework.domain import RecordPayload
from colrev.ui_jsonrpc.framework.domain import RecordStateName
from colrev.ui_jsonrpc.framework.domain import RecordSummary
from colrev.ui_jsonrpc.framework.events import CapturingEmitter
from colrev.ui_jsonrpc.framework.events import emit_progress
from colrev.ui_jsonrpc.framework.events import install_default_emitter
from colrev.ui_jsonrpc.framework.events import make_progress_callback
from colrev.ui_jsonrpc.framework.events import set_emitter
from colrev.ui_jsonrpc.framework.lazy_git import LazyWriteGitRepo
from colrev.ui_jsonrpc.framework.models import NoProjectRequest
from colrev.ui_jsonrpc.framework.models import PingResponse
from colrev.ui_jsonrpc.framework.models import ProjectResponse
from colrev.ui_jsonrpc.framework.models import ProjectScopedRequest
from colrev.ui_jsonrpc.framework.models import SuccessResponse
from colrev.ui_jsonrpc.framework.registry import registry

__all__ = [
    "BaseHandler",
    "CapturingEmitter",
    "HandlerContext",
    "LazyWriteGitRepo",
    "NoProjectRequest",
    "PingResponse",
    "ProgressEvent",
    "ProgressEventKind",
    "ProjectResponse",
    "ProjectScopedRequest",
    "RecordPayload",
    "RecordStateName",
    "RecordSummary",
    "SuccessResponse",
    "emit_progress",
    "install_default_emitter",
    "make_progress_callback",
    "registry",
    "rpc_method",
    "set_emitter",
]
