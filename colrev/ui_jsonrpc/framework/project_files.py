"""Check that the project files a ReviewManager loads can be read.

``ReviewManager`` parses ``settings.json`` and every
``data/search/**/*_search_history.json`` on construction. When one of them is
broken (conflict markers left by a pull or merge, a history file truncated by a
process killed mid-write), the failure should name the file instead of
surfacing as whatever exception the JSON parser raised — which, being a
``ValueError``, would otherwise be reported as "invalid params".
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

import colrev.review_manager
from colrev.ui_jsonrpc.errors import ProjectFileUnreadableError
from colrev.ui_jsonrpc.framework import portability

SETTINGS_FILE = "settings.json"


def _read_json(project_path: Path, path: Path) -> None:
    rel = path.relative_to(project_path).as_posix()
    try:
        with open(path, encoding="utf-8") as file:
            json.load(file)
    except json.JSONDecodeError as exc:
        raise ProjectFileUnreadableError(
            rel, f"not valid JSON ({exc.msg} at line {exc.lineno}, column {exc.colno})"
        ) from exc
    except UnicodeDecodeError as exc:
        raise ProjectFileUnreadableError(rel, "not valid UTF-8 text") from exc
    except OSError as exc:
        raise ProjectFileUnreadableError(rel, str(exc.strerror or exc)) from exc


def check_project_files_readable(project_path: Path) -> None:
    """Raise ``ProjectFileUnreadableError`` naming the first unreadable file.

    A missing ``settings.json`` is left to ``ReviewManager`` (a repo-setup
    problem, not an unreadable file).
    """
    project_path = Path(project_path)
    settings = project_path / SETTINGS_FILE
    if settings.is_file():
        _read_json(project_path, settings)
    search_dir = project_path / "data" / "search"
    if search_dir.is_dir():
        for history in sorted(search_dir.glob("**/*_search_history.json")):
            _read_json(project_path, history)


def build_review_manager(
    project_path, *, verbose_mode: bool = False
) -> colrev.review_manager.ReviewManager:
    """Build the ReviewManager for a project, naming the file that is broken.

    Settings and search-history files are checked first so that a broken one
    fails with ``ProjectFileUnreadableError`` (-32010, naming the file) instead
    of a bare JSON-parser ``ValueError`` (-32602) or a generic setup error.
    """
    # A source a Windows machine saved with backslash paths reads as another,
    # missing file here: heal before colrev loads the settings.
    portability.heal_search_history(Path(project_path))
    check_project_files_readable(Path(project_path))
    return colrev.review_manager.ReviewManager(
        path_str=str(project_path),
        verbose_mode=verbose_mode,
        high_level_operation=True,
    )


def write_json_atomic(path: Path, data: Any, **dump_kwargs: Any) -> None:
    """Write ``data`` as JSON to ``path`` without ever leaving a partial file.

    Writes to a temporary file in the same directory, then ``os.replace``s it
    over ``path``: a process killed mid-write leaves either the old file or the
    new one, never a truncated one.
    """
    path = Path(path)
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as file:
            json.dump(data, file, **dump_kwargs)
            file.flush()
            os.fsync(file.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
