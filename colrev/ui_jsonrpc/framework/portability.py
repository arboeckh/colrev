"""Project files that are byte-identical on every platform.

The app's users collaborate through one GitHub repository, so what a Windows
collaborator commits must be what a Mac collaborator would commit, and what
either of them pulls must open on the other's machine. Core colrev writes its
files in text mode and puts ``str(Path)`` into them, which on Windows means
CRLF line endings and ``\\`` path separators. Core is vendored and must not be
edited, so the JSON-RPC layer corrects both:

- :func:`heal_search_history` / :func:`normalize_history_files` keep the
  ``data/search/*_search_history.json`` path fields in POSIX form, and heal
  files a Windows machine already saved in the backslash form.
- :func:`normalize_project_text_files` / :func:`normalize_text_file` turn the
  CRLF core wrote into LF, in the tracked text files colrev owns. It runs
  before such a file is staged (see ``LazyWriteGitRepo.add_changes``) and
  after every project-scoped request, on platforms whose text mode writes CRLF.
- :func:`project_file` reads a record's ``file`` field in either separator form.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any
from typing import List

import git as gitmodule

logger = logging.getLogger(__name__)

# Fields of a search-history file that hold a project-relative path.
HISTORY_PATH_KEYS = ("search_results_path", "search_history_path")

# Tracked text files colrev (or the app) writes whole, by file name.
_OWNED_TEXT_NAMES = frozenset(
    {
        "records.bib",
        "settings.json",
        ".gitignore",
        ".gitattributes",
        "status.yaml",
        "colrev_app.json",
        "data.csv",
    }
)
_HISTORY_SUFFIX = "_search_history.json"

GITATTRIBUTES_LINES = ("* text=auto eol=lf", "*.pdf binary")


def crlf_platform() -> bool:
    """Whether text-mode writes on this platform produce CRLF (Windows)."""
    return os.linesep == "\r\n"


def to_posix(value: Any) -> str:
    """A stored path as ``/``-separated text, whichever separator it was saved with."""
    return str(value).replace("\\", "/")


def project_file(project_path: Path, value: Any) -> Path:
    """The path a record's ``file`` field names, readable on every platform.

    A ``file`` saved on Windows (``data\\pdfs\\ID.pdf``) is one odd file name
    on macOS and Linux; both separator forms are read as the POSIX path.
    """
    path = Path(to_posix(value))
    return path if path.is_absolute() else project_path / path


def is_owned_text_file(path: Path) -> bool:
    """Whether ``path`` is one of the tracked text files colrev owns."""
    return path.name in _OWNED_TEXT_NAMES or path.name.endswith(_HISTORY_SUFFIX)


# -- line endings ------------------------------------------------------------


def normalize_text_file(path: Path) -> bool:
    """Rewrite CRLF as LF in ``path``. Returns True when the file changed."""
    try:
        data = path.read_bytes()
    except OSError:
        return False
    if b"\r\n" not in data:
        return False
    path.write_bytes(data.replace(b"\r\n", b"\n"))
    return True


def normalize_project_text_files(project_path: Path) -> List[Path]:
    """LF-normalise every colrev-owned tracked text file of the project.

    Only the working-tree files are rewritten; nothing is staged. Returns the
    files that changed.
    """
    candidates = [project_path / name for name in _OWNED_TEXT_NAMES]
    candidates.append(project_path / "data" / "data" / "data.csv")
    search_dir = project_path / "data" / "search"
    if search_dir.is_dir():
        candidates.extend(search_dir.glob(f"**/*{_HISTORY_SUFFIX}"))
    changed = []
    for path in candidates:
        if path.is_file() and normalize_text_file(path):
            changed.append(path)
    return changed


def lf_sweep(project_path: Path) -> List[Path]:
    """:func:`normalize_project_text_files` on platforms whose text mode writes CRLF."""
    if not crlf_platform():
        return []
    return normalize_project_text_files(project_path)


def write_gitattributes(project_path: Path) -> bool:
    """Make the project's ``.gitattributes`` pin LF endings (and PDFs binary).

    Keeps the lines already there (core ships ``*.pdf binary``); the
    catch-all comes first because a later, more specific pattern wins.
    Returns True when the file changed.
    """
    path = project_path / ".gitattributes"
    existing = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    lines = list(existing)
    for wanted in reversed(GITATTRIBUTES_LINES):
        if wanted not in lines:
            lines.insert(0, wanted)
    # Order: the catch-all first, then whatever else was there.
    catch_all = GITATTRIBUTES_LINES[0]
    lines.remove(catch_all)
    lines.insert(0, catch_all)
    if lines == existing:
        return False
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    return True


# -- search-history files ----------------------------------------------------


def _write_json_lf(path: Path, data: Any) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, indent=4, ensure_ascii=False)


def normalize_history_file(path: Path) -> bool:
    """POSIX path fields and LF endings in one history file; True if rewritten."""
    try:
        raw = path.read_bytes()
    except OSError:
        return False
    if b"\\" not in raw and b"\r\n" not in raw:
        return False
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return False
    if not isinstance(data, dict):
        return False
    for key in HISTORY_PATH_KEYS:
        if isinstance(data.get(key), str):
            data[key] = to_posix(data[key])
    _write_json_lf(path, data)
    return True


def history_files(project_path: Path) -> List[Path]:
    """The project's ``*_search_history.json`` files."""
    search_dir = project_path / "data" / "search"
    if not search_dir.is_dir():
        return []
    return sorted(search_dir.glob(f"**/*{_HISTORY_SUFFIX}"))


def normalize_history_files(project_path: Path) -> List[Path]:
    """:func:`normalize_history_file` for every history file. Returns those rewritten."""
    return [p for p in history_files(project_path) if normalize_history_file(p)]


def _heal_stray_history_files(project_path: Path) -> None:
    """Fix history files literally named ``data\\search\\db1_search_history.json``.

    A macOS project that read a Windows-saved source saves it a second time
    under its backslash path, as a file *in* ``data/search``. The stray copy
    is moved to the real name, or dropped when the real file exists.
    """
    search_dir = project_path / "data" / "search"
    if not search_dir.is_dir():
        return
    strays = [p for p in search_dir.glob("*") if "\\" in p.name and p.is_file()]
    if not strays:
        return
    repo = gitmodule.Repo(project_path)
    try:
        tracked = {entry[0] for entry in repo.index.entries}
        for stray in strays:
            real = search_dir / stray.name.rsplit("\\", 1)[-1]
            stray_key = f"data/search/{stray.name}"
            if real.exists():
                stray.unlink()
            else:
                stray.rename(real)
            logger.warning("Healed misnamed search-history file %s", stray_key)
            if stray_key in tracked:
                repo.index.remove([stray_key])
                if real.exists():
                    repo.index.add([f"data/search/{real.name}"])
                repo.index.write()
    finally:
        repo.close()


def heal_search_history(project_path: Path) -> None:
    """Make a project saved on Windows readable: run before a ReviewManager is built.

    Rewrites backslash path fields to POSIX form (colrev reads the field with
    the platform's own separator, so on macOS ``data\\search\\db1.bib`` names no
    file) and removes the stray duplicates described in
    :func:`_heal_stray_history_files`. A no-op on a healthy project.
    """
    try:
        _heal_stray_history_files(project_path)
        healed = normalize_history_files(project_path)
        if healed:
            logger.warning(
                "Rewrote backslash paths in %d search-history file(s)", len(healed)
            )
    except Exception:  # noqa: BLE001 — healing is best-effort, never blocks opening
        logger.exception("Could not heal the search-history files of %s", project_path)


# -- open handles ------------------------------------------------------------


def close_log_handlers(project_path: Path) -> None:
    """Close and detach every log file handler that writes inside the project.

    Core's report logger keeps ``<project>/.report.log`` open for the life of
    the process; Windows cannot delete or rename a directory with an open file.
    The next ``ReviewManager`` sets its loggers up again.
    """
    root = os.path.normcase(os.path.abspath(project_path))
    loggers: List[Any] = [logging.getLogger()]
    loggers.extend(
        item
        for item in list(logging.Logger.manager.loggerDict.values())
        if isinstance(item, logging.Logger)
    )
    for log in loggers:
        for handler in list(log.handlers):
            if not isinstance(handler, logging.FileHandler):
                continue
            target = os.path.normcase(os.path.abspath(handler.baseFilename))
            if target == root or target.startswith(root + os.sep):
                log.removeHandler(handler)
                handler.close()
