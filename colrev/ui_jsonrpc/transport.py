"""The JSON-RPC wire: a private handle to the original stdout.

The dispatcher redirects OS fd 1 to ``/dev/null`` for the duration of every
project-scoped handler so that stray writes (third-party libraries, child
processes) cannot corrupt the line-delimited JSON-RPC stream. But responses
and progress notifications must still reach the client *during* that window.

The fix: ``init_wire()`` is called once at server startup, **before** any
redirect, and ``dup``s fd 1 into a private file object. Everything that
belongs on the wire (responses, notifications) is written through
``write_line()``, which uses that private handle and is therefore immune to
later fd 1 redirection. The per-request devnull redirect then only affects
writers that were never supposed to touch the wire.

When the wire has not been initialised (tests, direct handler use),
``write_line`` falls back to ``sys.stdout`` so existing capture-based tests
keep working.
"""
from __future__ import annotations

import os
import sys
import threading
from contextlib import contextmanager
from typing import Iterator
from typing import Optional
from typing import TextIO

_lock = threading.Lock()
_wire: Optional[TextIO] = None


def init_wire() -> None:
    """Capture the current fd 1 as the permanent JSON-RPC wire.

    Must run at server startup before any fd redirection. Idempotent.
    """
    global _wire
    with _lock:
        if _wire is None:
            _wire = os.fdopen(
                os.dup(1), "w", encoding="utf-8", newline="\n", buffering=1
            )


def write_line(line: str) -> None:
    """Write one line to the wire, atomically with respect to other writers.

    Progress events can be emitted from worker threads while the main loop
    writes responses — the lock keeps lines from interleaving.
    """
    with _lock:
        out: TextIO = _wire if _wire is not None else sys.stdout
        out.write(line + "\n")
        out.flush()


_redirect_lock = threading.Lock()
_redirect_depth = 0
_redirect_saved_fd: Optional[int] = None


@contextmanager
def stdout_to_devnull() -> Iterator[None]:
    """Point OS fd 1 at /dev/null so stray writers cannot reach the wire.

    Re-entrant and thread-safe: the preload thread and the request loop may
    overlap, so the first entry saves fd 1 and the last exit restores it.
    Python's own ``sys.stdout`` buffer is flushed *while still redirected*
    before the restore, so a buffered partial line goes to /dev/null instead
    of being glued to the next JSON line on the wire.
    """
    global _redirect_depth, _redirect_saved_fd
    with _redirect_lock:
        if _redirect_depth == 0:
            _redirect_saved_fd = os.dup(1)
            devnull_fd = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull_fd, 1)
            os.close(devnull_fd)
        _redirect_depth += 1
    try:
        yield
    finally:
        with _redirect_lock:
            _redirect_depth -= 1
            if _redirect_depth == 0 and _redirect_saved_fd is not None:
                try:
                    sys.stdout.flush()
                except (OSError, ValueError):
                    pass
                os.dup2(_redirect_saved_fd, 1)
                os.close(_redirect_saved_fd)
                _redirect_saved_fd = None


def _reset_for_tests() -> None:
    """Close and forget the wire so tests can re-init against a fresh fd 1."""
    global _wire
    with _lock:
        if _wire is not None:
            try:
                _wire.close()
            except OSError:
                pass
            _wire = None
