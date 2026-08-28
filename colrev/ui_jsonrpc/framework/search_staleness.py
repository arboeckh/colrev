"""Search-source staleness helpers for the JSON-RPC layer.

ColRev stores the current source config in ``*_search_history.json`` files
(the same files that record ``last_run``). After a query edit, ``save_settings``
overwrites that file, so we keep a ``last_run_config`` snapshot from the last
successful search and compare against that instead of the file as a whole.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from typing import Dict
from typing import List
from typing import Optional
from typing import Tuple

logger = logging.getLogger(__name__)

# Source types whose staleness is never tracked: FILES sources are local
# PDF/import buckets, MD sources are metadata-provider mirrors. Neither is
# "run" by the user, so they can't be stale.
_UNTRACKED_SEARCH_TYPES = {"FILES", "MD"}


def run_config_snapshot(source: Any) -> Dict[str, Any]:
    return {
        "search_string": getattr(source, "search_string", "") or "",
        "search_parameters": getattr(source, "search_parameters", {}) or {},
    }


def last_run_config_from_history(history: dict) -> dict:
    if "last_run_config" in history:
        return history["last_run_config"]
    # Legacy histories only stored the run config at top level.
    return {
        "search_string": history.get("search_string", "") or "",
        "search_parameters": history.get("search_parameters", {}) or {},
    }


def stale_reason_for_source(source: Any, history: dict) -> Optional[str]:
    """Return a human-readable stale reason, or None if the source is current."""
    if not history.get("last_run"):
        return "Search has not been run"

    baseline = last_run_config_from_history(history)
    current_query = getattr(source, "search_string", "") or ""
    if current_query != baseline.get("search_string", ""):
        return "Search query changed"

    current_params = getattr(source, "search_parameters", {}) or {}
    if current_params != baseline.get("search_parameters", {}):
        return "Search parameters changed"

    return None


def check_source_staleness(source: Any, history_path: Path) -> Tuple[bool, Optional[str]]:
    if not history_path.is_file():
        return True, "Search has not been run"

    try:
        with open(history_path, "r", encoding="utf-8") as f:
            history = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Error reading search history %s: %s", history_path, exc)
        return True, "Unable to read search history"

    reason = stale_reason_for_source(source, history)
    if reason is None:
        return False, None
    return True, reason


def stale_source_entries(review_manager: Any) -> List[Dict[str, Optional[str]]]:
    """THE staleness definition for a project's search sources.

    Returns one entry per stale source. A source is stale when its search
    has never been run (no history file / no ``last_run``) or its query or
    parameters changed since the last run. FILES/MD sources are never stale.

    Both the status payload (``get_status``) and ``get_sources`` derive
    from this single definition — the renderer must not recompute it.
    """
    entries: List[Dict[str, Optional[str]]] = []
    for source in review_manager.settings.sources:
        search_type = getattr(
            getattr(source, "search_type", None), "value", None
        ) or str(getattr(source, "search_type", ""))
        if search_type in _UNTRACKED_SEARCH_TYPES:
            continue
        history_path = review_manager.path / source.get_search_history_path()
        is_stale, reason = check_source_staleness(source, history_path)
        if is_stale:
            entries.append(
                {
                    "platform": getattr(source, "platform", None),
                    "filename": str(getattr(source, "search_results_path", "")),
                    "reason": reason,
                }
            )
    return entries


def preserve_last_run_snapshot(history_path: Path) -> Tuple[Optional[dict], Optional[str]]:
    """Capture the last-run snapshot before a settings save overwrites the file."""
    if not history_path.is_file():
        return None, None

    try:
        with open(history_path, "r", encoding="utf-8") as f:
            history = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Error reading search history %s: %s", history_path, exc)
        return None, None

    last_run = history.get("last_run")
    snapshot = history.get("last_run_config")
    if snapshot is None and last_run:
        snapshot = last_run_config_from_history(history)
    return snapshot, last_run


def restore_last_run_snapshot(
    history_path: Path,
    snapshot: Optional[dict],
    last_run: Optional[str],
) -> None:
    """Re-attach the last-run snapshot after ``save_settings`` rewrites history."""
    if snapshot is None or not history_path.is_file():
        return

    try:
        with open(history_path, "r", encoding="utf-8") as f:
            history = json.load(f)
        history["last_run_config"] = snapshot
        if last_run:
            history["last_run"] = last_run
        with open(history_path, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=4, ensure_ascii=False)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Error restoring search history %s: %s", history_path, exc)
