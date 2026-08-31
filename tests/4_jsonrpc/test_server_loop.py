#!/usr/bin/env python
"""The stdio server loop: parse errors and loop survival.

``run_stdio_server`` is the outermost seam between the Electron main process
and the dispatcher. A malformed line on stdin must produce a JSON-RPC
``-32700`` parse error (with ``id: null`` — the id is unknowable) and, just as
important, must NOT kill the loop: the next well-formed request still gets
served.

Driven in-process: stdin is a StringIO, responses are captured by patching the
module-level ``write_jsonrpc_response``, and the wire/preload machinery is
stubbed out so no fd duplication or handler warm-up happens under pytest.
"""
from __future__ import annotations

import io
import json
import sys

from colrev.ui_jsonrpc import server
from colrev.ui_jsonrpc.framework import set_emitter
from colrev.ui_jsonrpc.handler import JSONRPCHandler


def _run_server_with_stdin(monkeypatch, stdin_text: str) -> list:
    responses: list = []
    monkeypatch.setattr(server, "write_jsonrpc_response", responses.append)
    monkeypatch.setattr(server.transport, "init_wire", lambda: None)
    monkeypatch.setattr(JSONRPCHandler, "preload", lambda self: None)
    monkeypatch.setattr(sys, "stdin", io.StringIO(stdin_text))
    try:
        server.run_stdio_server()  # returns on EOF
    finally:
        set_emitter(None)  # undo install_default_emitter
    return responses


def test_malformed_json_yields_parse_error_and_the_loop_survives(monkeypatch) -> None:
    ping = json.dumps({"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 7})
    responses = _run_server_with_stdin(
        monkeypatch, '{"jsonrpc": "2.0", "method": broken\n' + ping + "\n"
    )

    assert len(responses) == 2

    parse_error = responses[0]
    assert parse_error["jsonrpc"] == "2.0"
    assert parse_error["error"]["code"] == -32700
    assert parse_error["error"]["message"] == "Parse error"
    # The request id is unrecoverable from a line that never parsed.
    assert parse_error["id"] is None

    # The loop kept going: the next line was served normally.
    ping_response = responses[1]
    assert ping_response["id"] == 7
    assert "error" not in ping_response
    assert ping_response["result"]["status"] == "pong"
