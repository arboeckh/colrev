"""Helpers for a project's search-source files in the JSON-RPC layer.

- :func:`posix` — the wire form of a project-relative path (``/`` on every OS).
- :func:`unreadable_sources` / :func:`status_stats_isolated` — one search file
  colrev cannot parse must not take the whole status down with it.
- :func:`ensure_sources_readable` — the same check as a precondition for ``load``.
- :func:`stage_source_files` / :func:`stage_removal` — stage what a write
  handler touched, so the next engine operation is not refused for unstaged
  changes (colrev's ``UnstagedGitChangesError``).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from typing import Dict
from typing import Iterator
from typing import List
from typing import Tuple

import colrev.exceptions as colrev_exceptions

logger = logging.getLogger(__name__)


def posix(path: Any) -> str:
    """A path as ``/``-separated text, whatever the platform's separator."""
    return Path(str(path)).as_posix()


class SearchFileUnreadableError(colrev_exceptions.CoLRevException):
    """A search source's results file cannot be parsed."""


def unreadable_sources(review_manager: Any) -> List[Dict[str, str]]:
    """The non-metadata sources whose results file colrev cannot count.

    Each entry names the source: ``{"platform", "filename", "error"}``.
    """
    from colrev.loader import load_utils

    unreadable: List[Dict[str, str]] = []
    for source in review_manager.settings.sources:
        if source.is_md_source():
            continue
        try:
            load_utils.get_nr_records(
                review_manager.path / source.search_results_path
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Cannot read search file %s: %s", source.search_results_path, exc
            )
            unreadable.append(
                {
                    "platform": str(source.platform),
                    "filename": posix(source.search_results_path),
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    return unreadable


def ensure_sources_readable(review_manager: Any) -> None:
    """Raise a :class:`SearchFileUnreadableError` naming the first bad source."""
    unreadable = unreadable_sources(review_manager)
    if not unreadable:
        return
    first = unreadable[0]
    extra = f" (and {len(unreadable) - 1} more)" if len(unreadable) > 1 else ""
    raise SearchFileUnreadableError(
        f"Cannot read the search file '{first['filename']}' of source "
        f"{first['platform']}: {first['error']}{extra}. "
        "Replace the file or remove the source."
    )


@contextmanager
def _only_readable_sources(review_manager: Any) -> Iterator[List[Dict[str, str]]]:
    unreadable = unreadable_sources(review_manager)
    bad = {u["filename"] for u in unreadable}
    all_sources = review_manager.settings.sources
    review_manager.settings.sources = [
        s for s in all_sources if posix(s.search_results_path) not in bad
    ]
    try:
        yield unreadable
    finally:
        review_manager.settings.sources = all_sources


def status_stats_isolated(review_manager: Any) -> Tuple[Any, List[Dict[str, str]]]:
    """``review_manager.get_status_stats()`` without the unreadable sources.

    Core sums the records of every source file and raises on the first one it
    cannot parse. The unreadable sources are left out of the count and
    returned beside the stats so the caller can name them.
    """
    with _only_readable_sources(review_manager) as unreadable:
        return review_manager.get_status_stats(), unreadable


def stage_source_files(review_manager: Any) -> None:
    """Stage settings and every source's history file.

    ``save_settings()`` rewrites each ``*_search_history.json`` without staging it.
    """
    git_repo = review_manager.dataset.git_repo
    git_repo.add_changes(review_manager.paths.settings)
    for source in review_manager.settings.sources:
        history = review_manager.path / source.get_search_history_path()
        if history.is_file():
            git_repo.add_changes(history)


def stage_removal(review_manager: Any, path: Path) -> None:
    """Stage the deletion of a file that is gone from the working tree.

    A file git never tracked has nothing to stage.
    """
    relative = path.relative_to(review_manager.path) if path.is_absolute() else path
    repo = review_manager.dataset.git_repo.repo
    if relative.as_posix() in {key[0] for key in repo.index.entries}:
        review_manager.dataset.git_repo.add_changes(relative, remove=True)
