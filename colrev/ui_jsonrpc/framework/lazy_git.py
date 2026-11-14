"""LazyWriteGitRepo: defers update_gitignore() (and its git add, which acquires
.git/index.lock) until a write method is actually called.

Lives here instead of handler.py so the framework owns all ReviewManager
injection. Behavior identical to the original ``_LazyWriteGitRepo`` in
colrev/ui_jsonrpc/handler.py.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any
from typing import Callable
from typing import Iterable
from typing import Optional

import git as gitmodule

import colrev.exceptions as colrev_exceptions
import colrev.review_manager
from colrev.constants import FileSets

logger = logging.getLogger(__name__)

# How long a write waits for a held ``.git/index.lock`` before giving up.
INDEX_LOCK_WAIT_SEC = 3.0
# A lock older than this, with no git process running in the repository, is
# left over from a killed git process and is removed.
STALE_LOCK_AGE_SEC = 15.0
_POLL_SEC = 0.1


class IndexLockedError(colrev_exceptions.GitNotAvailableError):
    """``.git/index.lock`` is held (by a live process) beyond the bounded wait.

    Maps to -32006. The dispatcher does not retry it: the wait already
    happened here.
    """

    def __init__(self) -> None:
        super().__init__()
        self.message = (
            "Another git operation is in progress (.git/index.lock exists). "
            "Try again in a moment."
        )
        self.args = (self.message,)


def _proc_ppid(entry: Path) -> int:
    """Parent pid from /proc/<pid>/stat (the comm field may contain spaces)."""
    stat = (entry / "stat").read_text()
    return int(stat.rsplit(")", 1)[1].split()[1])


def _git_process_running(repo_path: Path) -> bool:
    """Whether a git process other than ourselves may hold the repository's lock.

    Our own children are ignored: GitPython keeps a ``git cat-file --batch``
    child alive per repository, which holds no index lock, and our own git
    calls run only after this check. When processes cannot be listed (no
    psutil, no /proc) this returns False, so the age of the lock alone decides.
    """
    try:
        import psutil  # type: ignore[import-not-found]  # pylint: disable=import-outside-toplevel

        for proc in psutil.process_iter(["name", "cwd", "ppid"]):
            if proc.info.get("ppid") == os.getpid():
                continue
            name = (proc.info.get("name") or "").lower()
            if name in {"git", "git.exe"} and proc.info.get("cwd"):
                try:
                    if Path(proc.info["cwd"]).resolve() == repo_path:
                        return True
                except OSError:
                    continue
        return False
    except ImportError:
        pass
    proc_dir = Path("/proc")
    if not proc_dir.is_dir():
        return False
    for entry in proc_dir.iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            if _proc_ppid(entry) == os.getpid():
                continue
            exe = Path(os.readlink(entry / "exe")).name
            if exe != "git":
                continue
            if Path(os.readlink(entry / "cwd")).resolve() == repo_path:
                return True
        except OSError:
            continue
    return False


def ensure_index_unlocked(
    repo_path: Path,
    *,
    wait_sec: Optional[float] = None,
    stale_after_sec: Optional[float] = None,
) -> None:
    """Make sure ``.git/index.lock`` is gone, in bounded time.

    A stale lock (old, and no git process in the repository) is removed and
    logged. A lock that a live process may hold is waited on for ``wait_sec``,
    then ``IndexLockedError`` is raised. Never waits unbounded.
    """
    wait_sec = INDEX_LOCK_WAIT_SEC if wait_sec is None else wait_sec
    stale_after_sec = STALE_LOCK_AGE_SEC if stale_after_sec is None else stale_after_sec
    lock = repo_path / ".git" / "index.lock"
    deadline = time.monotonic() + wait_sec
    while True:
        try:
            age = time.time() - lock.stat().st_mtime
        except FileNotFoundError:
            return
        except OSError:
            age = 0.0
        if age >= stale_after_sec and not _git_process_running(repo_path):
            try:
                lock.unlink()
                logger.warning(
                    "Removed stale %s (%.0f s old, no git process running)",
                    lock,
                    age,
                )
            except FileNotFoundError:
                pass
            except OSError as exc:
                logger.warning("Could not remove stale %s: %s", lock, exc)
                raise IndexLockedError() from exc
            return
        if time.monotonic() >= deadline:
            raise IndexLockedError()
        time.sleep(_POLL_SEC)


def sync_gitignore(
    repo_path: Path,
    *,
    add: Iterable[str],
    remove: Iterable[str],
) -> bool:
    """Add/remove ``.gitignore`` entries, touching the file only if needed.

    Keeps the file's existing line endings (LF for a new file). Returns True
    when the file was written. Does not stage it.
    """
    path = repo_path / ".gitignore"
    if path.is_file():
        text = path.read_bytes().decode("utf-8")
    else:
        text = ""
    newline = "\r\n" if "\r\n" in text else "\n"
    items = text.splitlines()
    new_items = [x for x in items if x not in set(remove)]
    new_items += [str(a) for a in add if str(a) not in new_items]
    if path.is_file() and new_items == items:
        return False
    with path.open("w", encoding="utf-8", newline="") as file:
        file.write(newline.join(new_items) + newline)
    return True


# GitRepo methods that only read. They run on the cheap ``gitmodule.Repo``
# without promotion, so a read handler can never rewrite ``.gitignore`` or
# touch the index.
_READ_ONLY_METHODS = frozenset(
    {
        "has_changes",
        "has_record_changes",
        "get_untracked_files",
        "records_changed",
        "file_in_history",
        "get_commit_message",
        "get_last_commit_sha",
        "get_tree_hash",
        "get_last_commit_date",
        "get_remote_url",
    }
)


class LazyWriteGitRepo:
    """GitRepo-compatible wrapper: lazily constructs the full GitRepo.

    Read-only operations (loading records, listing branches, ``has_changes``)
    use the cheap ``gitmodule.Repo`` directly. The first other method call
    promotes to a full ``colrev.git_repo.GitRepo`` after syncing
    ``.gitignore`` (only if an entry needs adding or removing). Every promoted
    call first makes sure ``.git/index.lock`` cannot block it unboundedly.
    """

    def __init__(self, path: Path):
        self.path = path.resolve()
        self.repo = gitmodule.Repo(self.path)
        # Reads must not rewrite the index as a side effect of ``git status``.
        self.repo.git.update_environment(GIT_OPTIONAL_LOCKS="0")
        self._full = None  # type: ignore[assignment]
        self._reader: Optional[Any] = None

    def _core(self):
        from colrev.git_repo import GitRepo

        obj = GitRepo.__new__(GitRepo)
        obj.path = self.path
        obj.repo = self.repo
        return obj

    def _ensure_full(self):
        if self._full is None:
            ensure_index_unlocked(self.path)
            if sync_gitignore(
                self.path,
                add=FileSets.DEFAULT_GIT_IGNORE_ITEMS,
                remove=FileSets.DEPRECATED_GIT_IGNORE_ITEMS,
            ):
                self._core().add_changes(Path(".gitignore"))
            self._full = self._core()
        return self._full

    def repo_initialized(self) -> bool:
        try:
            self.repo.head.commit
        except ValueError:
            return False
        return True

    def __getattr__(self, name):
        if name.startswith("__") or name in {"_full", "_reader"}:
            raise AttributeError(name)
        if name in _READ_ONLY_METHODS:
            if self._reader is None:
                self._reader = self._core()
            return getattr(self._reader, name)
        attr = getattr(self._ensure_full(), name)
        if callable(attr):
            return self._guarded(attr)
        return attr

    def _guarded(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        def call(*args: Any, **kwargs: Any) -> Any:
            ensure_index_unlocked(self.path)
            return fn(*args, **kwargs)

        return call


def install_lazy_git_repo(
    review_manager: colrev.review_manager.ReviewManager,
    project_path: Path,
) -> None:
    """Replace ``review_manager.dataset.git_repo`` with a LazyWriteGitRepo.

    ``Dataset.git_repo`` is a ``cached_property`` in core colrev, so we
    overwrite the instance __dict__ entry directly to short-circuit it.
    This is white-box knowledge of core colrev internals; the proper fix
    lives in core (a public ``Dataset.set_git_repo()`` seam) and is tracked
    out-of-scope for this layer's refactor. Keeping the mutation here means
    there is exactly one place to change once that seam exists.
    """
    review_manager.dataset.__dict__["git_repo"] = LazyWriteGitRepo(project_path)
