#!/usr/bin/env python
"""The stdio server over a real pipe: UTF-8 regardless of the platform default.

On Windows the packaged app starts the server with a piped stdin that Python
would decode with the ANSI code page. These tests run the server as a
subprocess with ``PYTHONIOENCODING=cp1252`` and ``PYTHONUTF8`` unset, so the
server has to fix the encoding itself.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any
from typing import List

import pytest

from colrev.ui_jsonrpc import transport

TEXTS = ["café", "Müller", "”", "Á", "论文 テスト", "Łódź"]


def _run_server(stdin_bytes: bytes) -> List[Any]:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONUTF8"}
    env["PYTHONIOENCODING"] = "cp1252"
    proc = subprocess.run(
        [sys.executable, "-m", "colrev.ui_jsonrpc.server"],
        input=stdin_bytes,
        capture_output=True,
        env=env,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", errors="replace")
    return [json.loads(line) for line in proc.stdout.decode("utf-8").splitlines()]


def _line(request: dict) -> bytes:
    return json.dumps(request, ensure_ascii=False).encode("utf-8") + b"\n"


def test_non_ascii_requests_get_their_own_response_with_text_intact() -> None:
    # `ping` ignores params; the id of each response must match its request.
    stdin = b"".join(
        _line({"jsonrpc": "2.0", "method": "ping", "params": {"text": t}, "id": i})
        for i, t in enumerate(TEXTS, start=1)
    )
    responses = _run_server(stdin)
    assert [r["id"] for r in responses] == list(range(1, len(TEXTS) + 1))
    assert all(r["result"]["status"] == "pong" for r in responses)


def test_text_is_decoded_as_utf8_not_the_ansi_code_page() -> None:
    # `list_projects` echoes a path-derived title back, so a base path with
    # non-ASCII characters shows whether stdin was decoded correctly.
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as root:
        # A non-ASCII profile name, as in %APPDATA%\\ColRev\\projects\\<login>.
        tmp = str(Path(root) / "Müller-café")
        for name in ("café", "Müller ”", "论文"):
            project = Path(tmp) / name
            project.mkdir(parents=True)
            (project / "settings.json").write_text(
                json.dumps({"project": {"title": name}}, ensure_ascii=False),
                encoding="utf-8",
            )
        responses = _run_server(
            _line(
                {
                    "jsonrpc": "2.0",
                    "method": "list_projects",
                    "params": {"base_path": tmp},
                    "id": 1,
                }
            )
        )
    assert len(responses) == 1 and responses[0]["id"] == 1, responses
    titles = sorted(p["title"] for p in responses[0]["result"]["projects"])
    assert titles == sorted(["café", "Müller ”", "论文"])


def test_invalid_utf8_is_answered_with_the_request_id_and_the_loop_survives() -> None:
    bad = b'{"jsonrpc": "2.0", "method": "ping", "params": {"t": "\xff\x81"}, "id": 5}\n'
    good = _line({"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 6})
    responses = _run_server(bad + good)
    assert responses[0]["id"] == 5
    assert responses[0]["error"]["code"] == -32700
    assert responses[1]["id"] == 6
    assert responses[1]["result"]["status"] == "pong"


def test_unparsable_line_still_answers_with_the_recoverable_id() -> None:
    bad = b'{"jsonrpc": "2.0", "method": "ping", "params": {oops}, "id": "abc-1"}\n'
    responses = _run_server(bad)
    assert responses[0]["error"]["code"] == -32700
    assert responses[0]["id"] == "abc-1"


def test_blank_lines_do_not_shut_the_server_down() -> None:
    ping = _line({"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 9})
    responses = _run_server(b"\n  \n" + ping + b"\n\n" + ping)
    assert [r["id"] for r in responses] == [9, 9]


def test_non_object_request_is_an_invalid_request() -> None:
    responses = _run_server(b"[1, 2]\n")
    assert responses[0]["error"]["code"] == -32600


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_floats_are_serialised_as_null(bad: float) -> None:
    line = transport.dumps(
        {"jsonrpc": "2.0", "result": {"similarity": bad, "xs": [1.5, bad]}, "id": 1}
    )
    parsed = json.loads(line, parse_constant=lambda c: pytest.fail(c))
    assert parsed["result"] == {"similarity": None, "xs": [1.5, None]}
