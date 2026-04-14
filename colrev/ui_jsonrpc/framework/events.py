"""Progress event emission channel.

Long-running handlers call ``emit_progress(ProgressEvent(...))`` to publish
structured status updates. Events go out as JSON-RPC 2.0 notifications (no
``id`` field) on stdout — the same transport used for request responses.

The frontend subscribes via ``window.colrev.onProgress(callback)`` and
receives typed, discriminated events instead of regex-parsing stderr logs.

A global emitter callback is set by the stdio server loop so handlers don't
need to know about transport details. Tests override the emitter to capture
events in-memory.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
from typing import Callable
from typing import List
from typing import Optional

from colrev.ui_jsonrpc.framework.domain import ProgressEvent

logger = logging.getLogger(__name__)

# The emitter is a single callable that knows how to publish a progress event.
# Default behavior: write a JSON-RPC notification line to stdout.
EmitterFn = Callable[[ProgressEvent], None]

_emitter_lock = threading.Lock()
_emitter: Optional[EmitterFn] = None


def _default_stdout_emitter(event: ProgressEvent) -> None:
    """Emit as a JSON-RPC 2.0 notification on stdout (no ``id``)."""
    notification = {
        "jsonrpc": "2.0",
        "method": "progress",
        "params": event.model_dump(mode="json", exclude_none=True),
    }
    # Transport is line-delimited JSON; stdout is the single wire.
    sys.stdout.write(json.dumps(notification) + "\n")
    sys.stdout.flush()


def set_emitter(fn: Optional[EmitterFn]) -> None:
    """Install a custom emitter (e.g., for tests). ``None`` disables emission."""
    global _emitter
    with _emitter_lock:
        _emitter = fn


def install_default_emitter() -> None:
    """Activate stdout-based emission. Called by the stdio server at startup."""
    set_emitter(_default_stdout_emitter)


def emit_progress(event: ProgressEvent) -> None:
    """Publish a progress event to the current emitter, if any.

    Safe no-op when no emitter is installed (e.g., under pytest). Swallows
    emission errors — progress is best-effort and must never break the
    handler's actual work.
    """
    with _emitter_lock:
        fn = _emitter
    if fn is None:
        return
    try:
        fn(event)
    except Exception:  # noqa: BLE001
        logger.exception("progress emission failed")


class CapturingEmitter:
    """Test helper: collect emitted events in a list.

    Usage::

        with CapturingEmitter() as events:
            handler.do_work()
        assert events[0].kind == ProgressEventKind.search_progress
    """

    def __init__(self) -> None:
        self.events: List[ProgressEvent] = []
        self._prev: Optional[EmitterFn] = None

    def __enter__(self) -> List[ProgressEvent]:
        with _emitter_lock:
            self._prev = _emitter
        set_emitter(self.events.append)
        return self.events

    def __exit__(self, *_exc) -> None:
        set_emitter(self._prev)
