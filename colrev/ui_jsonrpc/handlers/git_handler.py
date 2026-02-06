"""Handler for Git operations.

JSON-RPC Endpoints:
    - get_git_status: Get Git repository status

See docs/source/api/jsonrpc/git.rst for full endpoint documentation.
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter

logger = logging.getLogger(__name__)


class GitHandler:
    """Handle Git-related JSON-RPC methods.

    This handler provides endpoints for Git repository operations
    like status, commit, and branch management.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize git handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def get_git_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get Git repository status.

        Returns comprehensive Git status information including current branch,
        uncommitted changes, and remote tracking status.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - git (dict): Git status information with:
                    - branch (str): Current branch name
                    - is_clean (bool): No uncommitted changes
                    - uncommitted_changes (int): Number of changed files
                    - untracked_files (list): List of untracked file paths
                    - modified_files (list): List of modified file paths
                    - staged_files (list): List of staged file paths
                    - ahead (int): Commits ahead of remote
                    - behind (int): Commits behind remote
                    - remote_url (str|null): Remote repository URL
                    - last_commit (dict): Last commit info (hash, message, author, timestamp)
        """
        project_id = params["project_id"]
        logger.info(f"Getting git status for project {project_id}")

        # Get the GitRepo wrapper and underlying gitpython Repo
        git_wrapper = self.review_manager.dataset.git_repo
        git_repo = git_wrapper.repo  # The actual gitpython Repo object

        # Get current branch
        try:
            branch = git_repo.active_branch.name
        except TypeError:
            # Detached HEAD state
            branch = str(git_repo.head.commit)[:8]

        # Get changed files
        untracked_files = git_repo.untracked_files
        modified_files = [item.a_path for item in git_repo.index.diff(None)]

        # Get staged files (handle empty repo case)
        try:
            staged_files = [item.a_path for item in git_repo.index.diff("HEAD")]
        except Exception:
            # Empty repo or no HEAD - treat all indexed files as staged
            staged_files = list(git_repo.index.entries.keys()) if git_repo.index.entries else []

        # Calculate is_clean
        is_clean = (
            len(untracked_files) == 0
            and len(modified_files) == 0
            and len(staged_files) == 0
        )

        # Get remote tracking info
        ahead = 0
        behind = 0
        remote_url = None

        try:
            if git_repo.remotes:
                origin = git_repo.remotes[0]
                remote_url = origin.url

                # Get tracking branch
                tracking_branch = git_repo.active_branch.tracking_branch()
                if tracking_branch:
                    # Count commits ahead/behind
                    ahead = len(list(git_repo.iter_commits(
                        f"{tracking_branch}..{branch}"
                    )))
                    behind = len(list(git_repo.iter_commits(
                        f"{branch}..{tracking_branch}"
                    )))
        except Exception as e:
            logger.debug(f"Could not get remote info: {e}")

        # Get last commit info
        last_commit = self._get_last_commit_info(git_repo)

        return {
            "success": True,
            "project_id": project_id,
            "git": {
                "branch": branch,
                "is_clean": is_clean,
                "uncommitted_changes": len(modified_files) + len(staged_files),
                "untracked_files": untracked_files,
                "modified_files": modified_files,
                "staged_files": staged_files,
                "ahead": ahead,
                "behind": behind,
                "remote_url": remote_url,
                "last_commit": last_commit,
            },
        }

    def _get_last_commit_info(self, git_repo) -> Optional[Dict[str, Any]]:
        """Get information about the last commit."""
        try:
            commit = git_repo.head.commit
            return {
                "hash": commit.hexsha,
                "short_hash": commit.hexsha[:8],
                "message": commit.message.strip(),
                "author": commit.author.name,
                "email": commit.author.email,
                "timestamp": commit.committed_datetime.isoformat(),
            }
        except Exception as e:
            logger.debug(f"Could not get last commit info: {e}")
            return None
