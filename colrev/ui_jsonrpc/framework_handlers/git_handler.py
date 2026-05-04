"""Framework-native git handler.

Git inspection and explicit commit/discard endpoints. The UI is transitioning
to an "explicit commit" model — write operations stage changes, and the UI
calls ``commit_changes`` / ``discard_changes`` to finalize or revert them.

Response shape matches the legacy handler exactly — the frontend depends on
the ``{success, project_id, git: {...}}`` envelope for ``get_git_status``.
"""

from __future__ import annotations

import logging
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

import git
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class GetGitStatusRequest(ProjectScopedRequest):
    pass


class LastCommitInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    hash: str
    short_hash: str
    message: str
    author: str
    email: str
    timestamp: str


class StagedRecordChange(BaseModel):
    model_config = ConfigDict(extra="allow")

    record_id: str
    change_type: str  # "added" | "modified" | "removed"


class GitStatus(BaseModel):
    model_config = ConfigDict(extra="allow")

    branch: str
    is_clean: bool
    uncommitted_changes: int
    untracked_files: List[str]
    modified_files: List[str]
    staged_files: List[str]
    staged_record_changes: List[StagedRecordChange] = Field(default_factory=list)
    ahead: int
    behind: int
    # Counts for local ``main`` vs ``origin/main`` regardless of the currently
    # checked-out branch. Lets the UI show a "collaborator pushed" banner when
    # the user is working on ``dev`` and a teammate publishes to ``main``.
    main_ahead: int = 0
    main_behind: int = 0
    remote_url: Optional[str] = None
    last_commit: Optional[LastCommitInfo] = None


class GetGitStatusResponse(ProjectResponse):
    git: GitStatus


class CommitChangesRequest(ProjectScopedRequest):
    message: str = Field(..., min_length=1)


class CommitChangesResponse(ProjectResponse):
    committed: bool
    commit_sha: Optional[str] = None
    changed_files: List[str] = Field(default_factory=list)
    message: str


class DiscardChangesRequest(ProjectScopedRequest):
    paths: Optional[List[str]] = None
    confirm: bool = False


class DiscardChangesResponse(ProjectResponse):
    discarded_files: List[str] = Field(default_factory=list)


class ResetToRemoteRequest(ProjectScopedRequest):
    confirm: bool = False


class ResetToRemoteResponse(ProjectResponse):
    reset: bool
    target_ref: str
    discarded_commits: int
    discarded_files: List[str] = Field(default_factory=list)
    message: str


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class GitHandler(BaseHandler):
    """Git repository inspection and explicit commit/discard endpoints."""

    @rpc_method(
        name="get_git_status",
        request=GetGitStatusRequest,
        response=GetGitStatusResponse,
        writes=False,
    )
    def get_git_status(self, req: GetGitStatusRequest) -> GetGitStatusResponse:
        assert self.review_manager is not None
        logger.info("Getting git status for project %s", req.project_id)

        # Use a fresh ``git.Repo`` instance rather than the cached one on
        # ``review_manager.dataset.git_repo``. The cached instance keeps a stale
        # view of the index in some gitpython versions, so ``index.diff("HEAD")``
        # can report zero staged files immediately after ``add_changes``. A
        # fresh Repo re-reads the index from disk.
        git_repo = git.Repo(str(self.review_manager.path))

        # Current branch (or short SHA when detached).
        try:
            branch = git_repo.active_branch.name
        except TypeError:
            branch = str(git_repo.head.commit)[:8]

        untracked_files = list(git_repo.untracked_files)
        modified_files = [item.a_path for item in git_repo.index.diff(None)]

        # Staged files — empty repo has no HEAD.
        staged_diff: List[Any] = []
        try:
            staged_diff = list(git_repo.index.diff("HEAD"))
            staged_files = [item.a_path for item in staged_diff]
        except Exception:
            staged_files = (
                list(git_repo.index.entries.keys()) if git_repo.index.entries else []
            )

        staged_record_changes = self._extract_staged_record_changes(staged_diff)

        is_clean = (
            len(untracked_files) == 0
            and len(modified_files) == 0
            and len(staged_files) == 0
        )

        ahead = 0
        behind = 0
        main_ahead = 0
        main_behind = 0
        remote_url: Optional[str] = None

        try:
            if git_repo.remotes:
                origin = git_repo.remotes[0]
                remote_url = origin.url
                tracking_branch = git_repo.active_branch.tracking_branch()
                if tracking_branch:
                    ahead = len(
                        list(git_repo.iter_commits(f"{tracking_branch}..{branch}"))
                    )
                    behind = len(
                        list(git_repo.iter_commits(f"{branch}..{tracking_branch}"))
                    )

                # Independently report main vs origin/main so the UI can flag
                # "collaborator pushed" even when the user is checked out on
                # a non-main branch (e.g. dev).
                try:
                    origin_main_ref = f"{origin.name}/main"
                    if ("main" in [h.name for h in git_repo.heads]
                            and origin_main_ref in [r.name for r in origin.refs]):
                        main_ahead = len(
                            list(git_repo.iter_commits(f"{origin_main_ref}..main"))
                        )
                        main_behind = len(
                            list(git_repo.iter_commits(f"main..{origin_main_ref}"))
                        )
                except Exception as e:  # noqa: BLE001
                    logger.debug("Could not compute main vs origin/main: %s", e)
        except Exception as e:  # noqa: BLE001
            logger.debug("Could not get remote info: %s", e)

        last_commit = self._get_last_commit_info(git_repo)

        return GetGitStatusResponse(
            project_id=req.project_id,
            git=GitStatus(
                branch=branch,
                is_clean=is_clean,
                uncommitted_changes=len(modified_files) + len(staged_files),
                untracked_files=untracked_files,
                modified_files=modified_files,
                staged_files=staged_files,
                staged_record_changes=staged_record_changes,
                ahead=ahead,
                behind=behind,
                main_ahead=main_ahead,
                main_behind=main_behind,
                remote_url=remote_url,
                last_commit=last_commit,
            ),
        )

    @rpc_method(
        name="commit_changes",
        request=CommitChangesRequest,
        response=CommitChangesResponse,
        writes=True,
    )
    def commit_changes(self, req: CommitChangesRequest) -> CommitChangesResponse:
        assert self.review_manager is not None
        logger.info("commit_changes for project %s", req.project_id)

        repo = git.Repo(self.review_manager.path)

        # Stage every working-tree change (including untracked and deleted
        # files) before inspecting the index. Write handlers are expected to
        # stage as they go, but the "Save" button must never be a dead-end
        # when a file was modified outside an RPC write path (e.g. a data
        # extraction output, or a user edit made while the app was closed).
        try:
            repo.git.add("-A")
        except Exception as e:  # noqa: BLE001
            logger.debug("commit_changes add -A failed: %s", e)

        # Detect staged changes. For a repo with no HEAD yet, any index entries
        # count as staged.
        staged_paths: List[str] = []
        try:
            staged_paths = [item.a_path for item in repo.index.diff("HEAD")]
        except Exception:
            staged_paths = (
                list(repo.index.entries.keys()) if repo.index.entries else []
            )

        if not staged_paths:
            return CommitChangesResponse(
                project_id=req.project_id,
                committed=False,
                commit_sha=None,
                changed_files=[],
                message="No changes to commit",
            )

        self.review_manager.create_commit(msg=req.message, skip_hooks=True)

        commit = repo.head.commit
        commit_sha = commit.hexsha
        try:
            if commit.parents:
                changed_files = [
                    item.a_path or item.b_path
                    for item in commit.parents[0].diff(commit)
                ]
            else:
                # Initial commit: list everything in the tree.
                changed_files = [blob.path for blob in commit.tree.traverse()
                                 if getattr(blob, "type", None) == "blob"]
        except Exception as e:  # noqa: BLE001
            logger.debug("Could not enumerate commit files: %s", e)
            changed_files = list(staged_paths)

        return CommitChangesResponse(
            project_id=req.project_id,
            committed=True,
            commit_sha=commit_sha,
            changed_files=changed_files,
            message=req.message,
        )

    @rpc_method(
        name="discard_changes",
        request=DiscardChangesRequest,
        response=DiscardChangesResponse,
        writes=True,
    )
    def discard_changes(self, req: DiscardChangesRequest) -> DiscardChangesResponse:
        assert self.review_manager is not None
        logger.info(
            "discard_changes for project %s (paths=%s, confirm=%s)",
            req.project_id,
            req.paths,
            req.confirm,
        )

        if req.paths is None and not req.confirm:
            raise ValueError(
                "discard_changes without paths requires confirm=True"
            )

        repo = git.Repo(self.review_manager.path)

        if req.paths:
            # Record what will change before we discard.
            modified_before = {item.a_path for item in repo.index.diff(None)}
            try:
                staged_before = {item.a_path for item in repo.index.diff("HEAD")}
            except Exception:
                staged_before = set()
            targeted = set(req.paths)
            discarded = sorted(
                (modified_before | staged_before) & targeted
            ) or sorted(targeted)

            repo.git.checkout("HEAD", "--", *req.paths)
            return DiscardChangesResponse(
                project_id=req.project_id,
                discarded_files=list(discarded),
            )

        # Full reset path — confirm is True here.
        modified_before = [item.a_path for item in repo.index.diff(None)]
        try:
            staged_before = [item.a_path for item in repo.index.diff("HEAD")]
        except Exception:
            staged_before = []
        discarded = sorted(set(modified_before) | set(staged_before))

        repo.git.reset("--hard", "HEAD")

        return DiscardChangesResponse(
            project_id=req.project_id,
            discarded_files=discarded,
        )

    @rpc_method(
        name="reset_to_remote",
        request=ResetToRemoteRequest,
        response=ResetToRemoteResponse,
        writes=True,
    )
    def reset_to_remote(
        self, req: ResetToRemoteRequest
    ) -> ResetToRemoteResponse:
        """Hard-reset the current branch to match its remote tracking branch.

        Last-resort recovery path for users stuck in a wedged git state.
        Discards:
        - all uncommitted/untracked local changes,
        - all local commits ahead of the remote.

        Requires ``confirm=True`` because the operation is irreversible.
        """
        assert self.review_manager is not None
        logger.info(
            "reset_to_remote for project %s (confirm=%s)",
            req.project_id,
            req.confirm,
        )

        if not req.confirm:
            raise ValueError("reset_to_remote requires confirm=True")

        repo = git.Repo(self.review_manager.path)

        if not repo.remotes:
            raise ValueError(
                "No remote configured. Reset to remote requires an 'origin' "
                "remote; push the project to a remote first."
            )

        try:
            current_branch = repo.active_branch.name
        except TypeError:
            raise ValueError(
                "Cannot reset: HEAD is detached, not on a branch."
            )

        tracking = repo.active_branch.tracking_branch()
        if tracking is None:
            raise ValueError(
                f"Branch '{current_branch}' has no upstream. Push the branch "
                "to the remote first so it has a tracking branch to reset to."
            )
        target_ref = tracking.name

        # Collect what we're about to destroy, for the response.
        try:
            ahead_commits = len(
                list(repo.iter_commits(f"{target_ref}..{current_branch}"))
            )
        except Exception:
            ahead_commits = 0

        modified = [item.a_path for item in repo.index.diff(None)]
        try:
            staged = [item.a_path for item in repo.index.diff("HEAD")]
        except Exception:
            staged = []
        untracked = list(repo.untracked_files)
        discarded_files = sorted(set(modified) | set(staged) | set(untracked))

        # Fetch first so the tracking ref is current.
        try:
            repo.remotes[0].fetch()
        except Exception as e:  # noqa: BLE001
            logger.debug("reset_to_remote: fetch failed: %s", e)

        repo.git.reset("--hard", target_ref)
        # Drop any remaining untracked files / directories.
        repo.git.clean("-fd")

        return ResetToRemoteResponse(
            project_id=req.project_id,
            reset=True,
            target_ref=target_ref,
            discarded_commits=ahead_commits,
            discarded_files=discarded_files,
            message=f"Reset to {target_ref}",
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _get_last_commit_info(self, git_repo: Any) -> Optional[LastCommitInfo]:
        try:
            commit = git_repo.head.commit
            return LastCommitInfo(
                hash=commit.hexsha,
                short_hash=commit.hexsha[:8],
                message=commit.message.strip(),
                author=commit.author.name,
                email=commit.author.email,
                timestamp=commit.committed_datetime.isoformat(),
            )
        except Exception as e:  # noqa: BLE001
            logger.debug("Could not get last commit info: %s", e)
            return None

    def _extract_staged_record_changes(
        self, staged_diff: List[Any]
    ) -> List[StagedRecordChange]:
        """Extract per-record changes from the staged diff.

        For now, surface any staged paths under ``data/`` as change entries
        keyed by path. Full .bib-level record-ID diffing can be layered on
        later without breaking the response shape.
        """
        changes: List[StagedRecordChange] = []
        for item in staged_diff:
            path = item.a_path or item.b_path or ""
            if not path.startswith("data/"):
                continue
            change_type_map: Dict[str, str] = {
                "A": "added",
                "M": "modified",
                "D": "removed",
                "R": "modified",
                "T": "modified",
            }
            raw = getattr(item, "change_type", "M") or "M"
            change_type = change_type_map.get(raw, "modified")
            changes.append(
                StagedRecordChange(record_id=path, change_type=change_type)
            )
        return changes
