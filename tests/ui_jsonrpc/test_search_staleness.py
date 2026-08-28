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


def test_snapshot_restore_round_trips_with_core_writer(tmp_path: Path) -> None:
    """Format-drift guard: ``restore_last_run_snapshot`` rewrites a file that
    core's ``ExtendedSearchFile.save()`` owns. The restored file must still
    load through core's constructor (the settings loader builds sources via
    ``ExtendedSearchFile(**json.load(...))``) and keep core's keys intact.
    """
    import os

    from colrev.search_file import ExtendedSearchFile

    cwd = os.getcwd()
    os.chdir(tmp_path)
    try:
        source = ExtendedSearchFile(
            search_string="old query",
            platform="colrev.pubmed",
            search_results_path=Path("data/search/pubmed.bib"),
            search_type="API",
            version="0.1.0",
        )
        history_path = tmp_path / "data/search/pubmed_search_history.json"
        history_path.parent.mkdir(parents=True, exist_ok=True)

        # App writer stamps the run metadata core doesn't know about.
        source.save(history_path)
        history = json.loads(history_path.read_text(encoding="utf-8"))
        history["last_run"] = "2026-06-01T12:00:00+00:00"
        history["last_run_config"] = {
            "search_string": "old query",
            "search_parameters": {},
        }
        history_path.write_text(json.dumps(history, indent=4), encoding="utf-8")

        core_keys = set(source.to_dict().keys()) - {"search_history_path"}

        # Settings save flow: preserve → core rewrites the file → restore.
        snapshot, last_run = preserve_last_run_snapshot(history_path)
        source.search_string = "new query"
        source.save(history_path)
        restore_last_run_snapshot(history_path, snapshot, last_run)

        restored = json.loads(history_path.read_text(encoding="utf-8"))
        # Core's own keys survive the restore untouched...
        assert core_keys <= set(restored.keys())
        # ...the run metadata is re-attached...
        assert restored["last_run"] == "2026-06-01T12:00:00+00:00"
        assert restored["last_run_config"]["search_string"] == "old query"
        # ...and core can still construct a source from the restored file
        # (mirrors colrev/settings.py load_settings).
        reloaded = ExtendedSearchFile(**restored)
        assert reloaded.search_string == "new query"
        assert stale_reason_for_source(reloaded, restored) == "Search query changed"
    finally:
        os.chdir(cwd)
