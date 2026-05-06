"""LazyWriteGitRepo: defers update_gitignore() (and its git add, which acquires
.git/index.lock) until a write method is actually called.

Lives here instead of handler.py so the framework owns all ReviewManager
injection. Behavior identical to the original ``_LazyWriteGitRepo`` in
colrev/ui_jsonrpc/handler.py.
"""

from __future__ import annotations

from pathlib import Path

import git as gitmodule

import colrev.review_manager
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

    def __getattr__(self, name):
        return getattr(self._ensure_full(), name)


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
