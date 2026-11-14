"""Typed domain errors for the JSON-RPC layer.

These exist so ``error_handler.map_exception_to_error_code`` can give domain
failures their own JSON-RPC error codes instead of collapsing everything
raised as ``ValueError`` into ``-32602 INVALID_PARAMS``. They subclass
``ValueError`` for backward compatibility with call sites that still catch
broadly.
"""
from __future__ import annotations


class MethodNotFoundError(ValueError):
    """The requested JSON-RPC method is not registered (→ -32601)."""


class ManagedTaskActiveError(ValueError):
    """A decision was made outside the active managed review task covering it.

    Decisions on records that a managed dual-review task covers must be made
    on a reviewer branch with the task's id, so that they go through
    reconciliation (→ -32008).
    """


class NotFoundError(ValueError):
    """A referenced resource (project, record, source) does not exist."""


class InvalidStateError(ValueError):
    """The project (or record) is in the wrong state for this call.

    The request itself is well-formed; the state it meets is not: a record is
    not ready for screening, the project is on the wrong branch, a merge is
    blocked, a required endpoint is not configured (→ -32009).
    """


class ProjectFileUnreadableError(ValueError):
    """A project file cannot be read or parsed (→ -32010).

    ``path`` names the file (relative to the project when possible), so the UI
    can say which one is broken (conflict markers in ``settings.json``, a
    truncated ``*_search_history.json``).
    """

    def __init__(self, path: str, reason: str) -> None:
        super().__init__(f"Cannot read {path}: {reason}")
        self.path = path
        self.reason = reason
