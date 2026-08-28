"""Regression tests for the JSON-RPC wire (WP-02 §1).

The dispatcher redirects OS fd 1 to /dev/null around every project-scoped
handler. Progress events emitted *inside* that window must still reach the
client — they go through the private wire handle captured at server startup,
not through whatever fd 1 currently points at.
"""
from __future__ import annotations

import json
import os

import pytest

from colrev.ui_jsonrpc import transport
from colrev.ui_jsonrpc.framework import emit_progress
from colrev.ui_jsonrpc.framework import install_default_emitter
from colrev.ui_jsonrpc.framework import ProgressEvent
from colrev.ui_jsonrpc.framework import ProgressEventKind
from colrev.ui_jsonrpc.framework import set_emitter
from colrev.ui_jsonrpc.server import write_jsonrpc_response


@pytest.fixture()
def wire_on_pipe():
    """Point fd 1 at a pipe, init the wire against it, restore afterwards."""
    read_fd, write_fd = os.pipe()
    saved_fd1 = os.dup(1)
    os.dup2(write_fd, 1)
    os.close(write_fd)
    transport._reset_for_tests()
    transport.init_wire()
    try:
        yield read_fd
    finally:
        transport._reset_for_tests()
        os.dup2(saved_fd1, 1)
        os.close(saved_fd1)
        os.close(read_fd)
        set_emitter(None)


def _redirect_fd1_to_devnull():
    """Replicate the dispatcher's per-request redirect."""
    saved = os.dup(1)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.close(devnull)
    return saved


def _restore_fd1(saved: int) -> None:
    os.dup2(saved, 1)
    os.close(saved)


class TestWireSurvivesRedirect:
    def test_progress_emitted_during_fd1_redirect_reaches_client(self, wire_on_pipe):
        """A handler emitting progress inside the dispatcher's devnull window
        must still deliver the notification on the wire."""
        install_default_emitter()

        saved = _redirect_fd1_to_devnull()
        try:
            emit_progress(
                ProgressEvent(
                    kind=ProgressEventKind.search_progress,
                    message="batch 2/5",
                    current=2,
                    total=5,
                )
            )
        finally:
            _restore_fd1(saved)

        raw = os.read(wire_on_pipe, 65536).decode("utf-8")
        payload = json.loads(raw.strip())
        assert payload["method"] == "progress"
        assert payload["params"]["current"] == 2
        assert "id" not in payload

    def test_response_written_during_fd1_redirect_reaches_client(self, wire_on_pipe):
        """Responses go through the same wire and survive the redirect too."""
        saved = _redirect_fd1_to_devnull()
        try:
            write_jsonrpc_response({"jsonrpc": "2.0", "result": {"ok": True}, "id": 7})
        finally:
            _restore_fd1(saved)

        raw = os.read(wire_on_pipe, 65536).decode("utf-8")
        payload = json.loads(raw.strip())
        assert payload["id"] == 7
        assert payload["result"] == {"ok": True}

    def test_stray_print_during_redirect_does_not_pollute_wire(self, wire_on_pipe):
        """Third-party writes to fd 1 inside the window go to devnull, not
        the wire — interleaved with a legitimate progress event."""
        install_default_emitter()

        saved = _redirect_fd1_to_devnull()
        try:
            os.write(1, b"NOT JSON: library debug output\n")
            emit_progress(
                ProgressEvent(kind=ProgressEventKind.generic, message="working")
            )
        finally:
            _restore_fd1(saved)

        raw = os.read(wire_on_pipe, 65536).decode("utf-8")
        lines = [ln for ln in raw.splitlines() if ln.strip()]
        assert len(lines) == 1
        assert json.loads(lines[0])["method"] == "progress"


class TestWireFallback:
    def test_write_line_without_init_falls_back_to_sys_stdout(self, capsys):
        """Tests and direct handler use (no server startup) keep working."""
        transport._reset_for_tests()
        transport.write_line('{"jsonrpc": "2.0"}')
        assert capsys.readouterr().out == '{"jsonrpc": "2.0"}\n'
