"""HandlerContext: the per-request object threaded through the framework."""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import List
from typing import Optional

import git as gitmodule

import colrev.review_manager


@dataclass
class HandlerContext:
    """Everything a handler might need beyond the request model itself.

    Constructed by the Dispatcher before calling the handler. Contains the
    (already-validated) project path, the active ReviewManager (configured
    per the method's precondition policy), and the MethodSpec that describes
    this call.

    For methods with ``requires_project=False``, ``project_path`` and
    ``review_manager`` are both ``None``.
    """

    method_name: str
    project_id: Optional[str]
    project_path: Optional[Path]
    review_manager: Optional[colrev.review_manager.ReviewManager]
    _repos: List[gitmodule.Repo] = field(default_factory=list, repr=False)

    def open_repo(self, path: Path | str) -> gitmodule.Repo:
        """A ``git.Repo`` that the dispatcher closes when the request ends.

        An unclosed ``Repo`` leaves a ``git cat-file`` child running in the
        project directory, which on Windows keeps the directory from being
        deleted or renamed.
        """
        repo = gitmodule.Repo(str(path))
        self._repos.append(repo)
        return repo

    def close_repos(self) -> None:
        """Close every repo opened through :meth:`open_repo`."""
        repos, self._repos = self._repos, []
        for repo in repos:
            repo.close()
