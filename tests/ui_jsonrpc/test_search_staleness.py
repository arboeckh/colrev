"""Tests for search-source staleness detection."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from colrev.ui_jsonrpc.framework.search_staleness import check_source_staleness
from colrev.ui_jsonrpc.framework.search_staleness import preserve_last_run_snapshot
from colrev.ui_jsonrpc.framework.search_staleness import restore_last_run_snapshot
from colrev.ui_jsonrpc.framework.search_staleness import stale_reason_for_source


def _write_history(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_stale_when_current_query_differs_from_last_run_config(tmp_path: Path) -> None:
    history_path = tmp_path / "pubmed_search_history.json"
    _write_history(
        history_path,
        {
            "platform": "colrev.pubmed",
            "search_string": "new query",
            "search_parameters": {"url": "https://example.test/new"},
            "last_run": "2026-06-01T12:00:00+00:00",
            "last_run_config": {
                "search_string": "old query",
                "search_parameters": {"url": "https://example.test/old"},
            },
        },
    )

    source = SimpleNamespace(
        search_string="new query",
        search_parameters={"url": "https://example.test/new"},
    )

    is_stale, reason = check_source_staleness(source, history_path)

    assert is_stale is True
    assert reason == "Search query changed"


def test_not_stale_when_current_query_matches_last_run_config(tmp_path: Path) -> None:
    history_path = tmp_path / "pubmed_search_history.json"
    payload = {
        "platform": "colrev.pubmed",
        "search_string": "same query",
        "search_parameters": {"url": "https://example.test/same"},
        "last_run": "2026-06-01T12:00:00+00:00",
        "last_run_config": {
            "search_string": "same query",
            "search_parameters": {"url": "https://example.test/same"},
        },
    }
    _write_history(history_path, payload)

    source = SimpleNamespace(
        search_string="same query",
        search_parameters={"url": "https://example.test/same"},
    )

    is_stale, reason = check_source_staleness(source, history_path)

    assert is_stale is False
    assert reason is None


def test_restore_last_run_snapshot_after_settings_save(tmp_path: Path) -> None:
    history_path = tmp_path / "pubmed_search_history.json"
    _write_history(
        history_path,
        {
            "platform": "colrev.pubmed",
            "search_string": "old query",
            "search_parameters": {"url": "https://example.test/old"},
            "last_run": "2026-06-01T12:00:00+00:00",
        },
    )

    snapshot, last_run = preserve_last_run_snapshot(history_path)
    assert snapshot == {
        "search_string": "old query",
        "search_parameters": {"url": "https://example.test/old"},
    }
    assert last_run == "2026-06-01T12:00:00+00:00"

    _write_history(
        history_path,
        {
            "platform": "colrev.pubmed",
            "search_string": "new query",
            "search_parameters": {"url": "https://example.test/new"},
        },
    )

    restore_last_run_snapshot(history_path, snapshot, last_run)

    history = json.loads(history_path.read_text(encoding="utf-8"))
    source = SimpleNamespace(
        search_string="new query",
        search_parameters={"url": "https://example.test/new"},
    )

    assert history["last_run"] == "2026-06-01T12:00:00+00:00"
    assert stale_reason_for_source(source, history) == "Search query changed"
