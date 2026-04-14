"""LazyWriteGitRepo: defers update_gitignore() (and its git add, which acquires
.git/index.lock) until a write method is actually called.

Lives here instead of handler.py so the framework owns all ReviewManager
injection. Behavior identical to the original ``_LazyWriteGitRepo`` in
colrev/ui_jsonrpc/handler.py.
"""

from __future__ import annotations

from pathlib import Path

import git as gitmodule

from colrev.constants import FileSets


class LazyWriteGitRepo:
    """GitRepo-compatible wrapper: lazily constructs the full GitRepo.

    Read-only operations (loading records, listing branches) use the cheap
    ``gitmodule.Repo`` directly. The first write method call promotes to a
    full ``colrev.git_repo.GitRepo`` (which runs ``update_gitignore`` and
    ``git add``).
    """

    def __init__(self, path: Path):
        self.path = path.resolve()
        self.repo = gitmodule.Repo(self.path)
        self._full = None  # type: ignore[assignment]

    def _ensure_full(self):
        if self._full is None:
            from colrev.git_repo import GitRepo

            self._full = GitRepo.__new__(GitRepo)
            self._full.path = self.path
            self._full.repo = self.repo
            self._full.update_gitignore(
                add=FileSets.DEFAULT_GIT_IGNORE_ITEMS,
                remove=FileSets.DEPRECATED_GIT_IGNORE_ITEMS,
            )
        return self._full

    def repo_initialized(self) -> bool:
        try:
            self.repo.head.commit
        except ValueError:
            return False
        return True

    def add_changes(self, path, *, remove=False, ignore_missing=False):
        return self._ensure_full().add_changes(
            path, remove=remove, ignore_missing=ignore_missing
        )

    def add_setting_changes(self):
        return self._ensure_full().add_setting_changes()

    def create_commit(self, **kwargs):
        return self._ensure_full().create_commit(**kwargs)

    def records_changed(self):
        return self._ensure_full().records_changed()

    def has_changes(self, relative_path, *, change_type="all"):
        return self._ensure_full().has_changes(relative_path, change_type=change_type)

    def has_record_changes(self, *, change_type="all"):
        return self._ensure_full().has_record_changes(change_type=change_type)

    def stash_unstaged_changes(self):
        return self._ensure_full().stash_unstaged_changes()

    def update_gitignore(self, **kwargs):
        return self._ensure_full().update_gitignore(**kwargs)

    def __getattr__(self, name):
        return getattr(self._ensure_full(), name)
