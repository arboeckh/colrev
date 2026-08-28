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


class NotFoundError(ValueError):
    """A referenced resource (project, record, source) does not exist."""
