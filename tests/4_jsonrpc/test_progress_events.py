"""Tests for the structured progress event channel (Phase E)."""

from __future__ import annotations

import json
from io import StringIO
from unittest.mock import patch

from colrev.ui_jsonrpc.framework import CapturingEmitter
from colrev.ui_jsonrpc.framework import ProgressEvent
from colrev.ui_jsonrpc.framework import ProgressEventKind
from colrev.ui_jsonrpc.framework import emit_progress
from colrev.ui_jsonrpc.framework import install_default_emitter
from colrev.ui_jsonrpc.framework import set_emitter


class TestProgressEmission:
    def test_default_emitter_writes_jsonrpc_notification_to_stdout(self):
        """The default emitter formats events as JSON-RPC notifications on stdout."""
        install_default_emitter()
        buf = StringIO()
        with patch("sys.stdout", buf):
            emit_progress(
                ProgressEvent(
                    kind=ProgressEventKind.search_progress,
                    message="Fetching batch 3/10",
                    current=3,
                    total=10,
                )
            )
        set_emitter(None)  # cleanup

        line = buf.getvalue().strip()
        payload = json.loads(line)
        assert payload["jsonrpc"] == "2.0"
        assert payload["method"] == "progress"
        assert "id" not in payload
        assert payload["params"]["kind"] == "search_progress"
        assert payload["params"]["current"] == 3
        assert payload["params"]["total"] == 10
        assert payload["params"]["message"] == "Fetching batch 3/10"

    def test_capturing_emitter_collects_events(self):
        """CapturingEmitter is a context-managed test helper that records all events."""
        with CapturingEmitter() as events:
            emit_progress(
                ProgressEvent(
                    kind=ProgressEventKind.load_progress,
                    message="Loading record 1",
                    current=1,
                    total=5,
                )
            )
            emit_progress(
                ProgressEvent(
                    kind=ProgressEventKind.generic,
                    message="Done",
                )
            )

        assert len(events) == 2
        assert events[0].kind == ProgressEventKind.load_progress
        assert events[0].current == 1
        assert events[1].kind == ProgressEventKind.generic
        assert events[1].message == "Done"

    def test_no_emitter_is_a_noop(self):
        """Without an emitter installed, emit_progress silently does nothing."""
        set_emitter(None)
        # Should not raise.
        emit_progress(
            ProgressEvent(
                kind=ProgressEventKind.generic,
                message="hello",
            )
        )

    def test_emitter_errors_are_swallowed(self):
        """Emission failures must never crash the caller."""

        def bad_emitter(_ev):
            raise RuntimeError("boom")

        set_emitter(bad_emitter)
        try:
            emit_progress(
                ProgressEvent(
                    kind=ProgressEventKind.generic,
                    message="test",
                )
            )  # should not raise
        finally:
            set_emitter(None)


class TestProgressEventSchema:
    def test_extra_fields_allowed(self):
        """ProgressEvent allows extra per-kind fields (extra='allow')."""
        ev = ProgressEvent(
            kind=ProgressEventKind.search_progress,
            message="searching",
            source_name="pubmed",  # not a declared field
            batch_id="abc",
        )
        dumped = ev.model_dump()
        assert dumped["source_name"] == "pubmed"
        assert dumped["batch_id"] == "abc"

    def test_level_defaults_to_info(self):
        ev = ProgressEvent(
            kind=ProgressEventKind.generic,
            message="x",
        )
        assert ev.level == "info"
