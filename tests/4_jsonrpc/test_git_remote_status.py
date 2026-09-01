#!/usr/bin/env python
"""Remote-aware git status and reset_to_remote, against a real bare remote.

``get_git_status``'s ahead/behind counters and the ``main_ahead``/
``main_behind`` pair drive the sync badge and the "collaborator pushed"
banner; ``reset_to_remote`` is the last-resort recovery path. None of that
code ever executed under test because it needs an origin with real refs.

One project with a bare remote and a collaborator clone, built once for the
module: ``colrev init`` dominates the runtime of this package, and every test
here only moves commits around. Tests run in definition order and each one
returns the repo to a synced state, so later tests start from ahead=behind=0.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Generator

import git
import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "git_remote_project"


def _request(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


@dataclass
class RemoteEnv:
    root: Path
    project_path: Path
    repo: git.Repo
    remote_dir: Path
    clone: git.Repo


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def env(tmp_path_factory, session_mocker) -> Generator[RemoteEnv, None, None]:
    root = tmp_path_factory.mktemp("git_remote_projects")
    session_mocker.patch(
        "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )
    session_mocker.patch.object(
        colrev.constants.Filepaths, "REGISTRY_FILE", root / "reg.json"
    )

    project_path = root / PROJECT_ID
    project_path.mkdir()
    original_cwd = os.getcwd()
    os.chdir(project_path)
    try:
        colrev.ops.init.Initializer(
            review_type="literature_review", target_path=project_path, light=True
        )
    finally:
        os.chdir(original_cwd)

    repo = git.Repo(project_path)
    # The init branch name follows the machine's init.defaultBranch; the
    # main_ahead/main_behind fields are keyed to a branch literally named
    # "main", so pin it.
    repo.git.branch("-M", "main")

    remote_dir = root / "remote.git"
    bare = git.Repo.init(remote_dir, bare=True)
    bare.git.symbolic_ref("HEAD", "refs/heads/main")
    repo.create_remote("origin", str(remote_dir))
    repo.git.push("--set-upstream", "origin", "main")
    repo.git.checkout("-b", "dev")
    repo.git.push("--set-upstream", "origin", "dev")

    # A collaborator working from their own clone of the same remote.
    clone_path = root / "collaborator"
    clone = git.Repo.clone_from(str(remote_dir), str(clone_path))
    with clone.config_writer() as writer:
        writer.set_value("user", "name", "Collaborator")
        writer.set_value("user", "email", "collab@example.com")

    yield RemoteEnv(
        root=root,
        project_path=project_path,
        repo=repo,
        remote_dir=remote_dir,
        clone=clone,
    )


@pytest.fixture
def params(env: RemoteEnv) -> dict:
    return {"project_id": PROJECT_ID, "base_path": str(env.root)}


def _git_status(handler: JSONRPCHandler, params: dict) -> dict:
    response = _request(handler, "get_git_status", params)
    assert "error" not in response, response.get("error")
    return response["result"]["git"]


def _collaborator_push(env: RemoteEnv, branch: str, filename: str, message: str) -> None:
    """Commit a file on the collaborator's clone and push it to the remote."""
    env.clone.git.fetch("origin")
    env.clone.git.checkout(branch)
    # The project may have pushed since the clone was made; start from the
    # remote's tip so the push is a fast-forward.
    env.clone.git.reset("--hard", f"origin/{branch}")
    file_path = Path(env.clone.working_dir) / filename
    file_path.write_text(f"{message}\n", encoding="utf-8")
    env.clone.git.add(filename)
    env.clone.git.commit("-m", message)
    env.clone.git.push("origin", branch)


class TestRemoteGitStatus:
    def test_synced_repo_reports_remote_url_and_zero_deltas(
        self, handler, params, env
    ) -> None:
        status = _git_status(handler, params)

        assert status["branch"] == "dev"
        assert status["remote_url"] == str(env.remote_dir)
        assert status["ahead"] == 0
        assert status["behind"] == 0
        assert status["main_ahead"] == 0
        assert status["main_behind"] == 0

    def test_unpushed_local_commit_counts_as_ahead(self, handler, params, env) -> None:
        (env.project_path / "local_note.txt").write_text("local\n", encoding="utf-8")
        env.repo.git.add("local_note.txt")
        env.repo.git.commit("-m", "Local work not yet pushed")

        status = _git_status(handler, params)
        assert status["ahead"] == 1
        assert status["behind"] == 0

        # Resync so the next test starts from a clean slate — and pushing is
        # exactly what clears the counter.
        env.repo.git.push()
        assert _git_status(handler, params)["ahead"] == 0

    def test_remote_commit_counts_as_behind_after_fetch(
        self, handler, params, env
    ) -> None:
        _collaborator_push(env, "dev", "collab_dev.txt", "Collaborator dev work")

        # Until the project fetches, the tracking ref is stale and the UI
        # cannot know: behind stays 0.
        assert _git_status(handler, params)["behind"] == 0

        env.repo.git.fetch("origin")
        status = _git_status(handler, params)
        assert status["behind"] == 1
        assert status["ahead"] == 0

        env.repo.git.merge("origin/dev")  # fast-forward back to synced
        assert _git_status(handler, params)["behind"] == 0

    def test_collaborator_push_to_main_shows_as_main_behind_while_on_dev(
        self, handler, params, env
    ) -> None:
        _collaborator_push(env, "main", "collab_main.txt", "Collaborator publishes to main")
        env.repo.git.fetch("origin")

        status = _git_status(handler, params)
        # Still on dev, and dev itself is fully synced ...
        assert status["branch"] == "dev"
        assert status["ahead"] == 0
        assert status["behind"] == 0
        # ... but local main is now behind origin/main — this is what drives
        # the "collaborator pushed" banner.
        assert status["main_behind"] == 1
        assert status["main_ahead"] == 0


class TestResetToRemote:
    def test_refuses_without_confirm(self, handler, params, env) -> None:
        head_before = env.repo.head.commit.hexsha

        response = _request(handler, "reset_to_remote", params)

        assert "error" in response, "reset_to_remote ran without confirm=True"
        assert env.repo.head.commit.hexsha == head_before

    def test_discards_local_commits_dirty_and_untracked_files(
        self, handler, params, env
    ) -> None:
        # An unpushed commit, a dirty tracked file, and an untracked file —
        # the full wedged-state trifecta reset_to_remote exists for.
        notes = env.project_path / "wedged_notes.txt"
        notes.write_text("committed\n", encoding="utf-8")
        env.repo.git.add("wedged_notes.txt")
        env.repo.git.commit("-m", "Unpushed local commit")
        notes.write_text("dirty on top of the commit\n", encoding="utf-8")
        scratch = env.project_path / "scratch.txt"
        scratch.write_text("untracked\n", encoding="utf-8")

        response = _request(handler, "reset_to_remote", {**params, "confirm": True})
        assert "error" not in response, response.get("error")
        result = response["result"]

        assert result["reset"] is True
        assert result["target_ref"] == "origin/dev"
        assert result["discarded_commits"] == 1
        assert "wedged_notes.txt" in result["discarded_files"]
        assert "scratch.txt" in result["discarded_files"]

        # On-disk: HEAD is exactly origin/dev, tree is clean, files are gone.
        assert env.repo.head.commit.hexsha == env.repo.commit("origin/dev").hexsha
        assert not env.repo.is_dirty(untracked_files=True)
        assert not notes.exists()
        assert not scratch.exists()
