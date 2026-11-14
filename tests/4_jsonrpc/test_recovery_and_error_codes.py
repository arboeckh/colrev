#!/usr/bin/env python
"""Recovery on a broken project, error codes that say what happened, the
records cache after a failed save, retry-on-lock safety, atomic history writes
and the git handler's edge cases.

One project (with a bare remote) is seeded once for the module; an autouse
fixture puts it back on the seed commit and removes stray files before each
test.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Generator

import git
import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc import error_handler
from colrev.ui_jsonrpc.errors import InvalidStateError
from colrev.ui_jsonrpc.errors import ProjectFileUnreadableError
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import registry
from colrev.ui_jsonrpc.framework.dispatcher import Dispatcher
from colrev.ui_jsonrpc.framework.registry import MethodSpec
from colrev.ui_jsonrpc.framework.project_files import write_json_atomic
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "recovery_project"

RECORDS_BIB = """@article{R1,
   colrev_origin                 = {import.bib/R1},
   colrev_status                 = {md_processed},
   title                         = {Title R1},
   author                        = {Doe, Jane},
   year                          = {2023},
   journal                       = {Journal A},
}

@article{R2,
   colrev_origin                 = {import.bib/R2},
   colrev_status                 = {rev_prescreen_included},
   title                         = {Title R2},
   author                        = {Doe, Jane},
   year                          = {2023},
   journal                       = {Journal A},
}
"""

HISTORY_REL = "data/search/example_search_history.json"


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def project(tmp_path_factory, session_mocker) -> Generator[dict, None, None]:
    root = tmp_path_factory.mktemp("recovery_projects")
    session_mocker.patch(
        "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )
    session_mocker.patch.object(
        colrev.constants.Filepaths, "REGISTRY_FILE", root / "reg.json"
    )
    path = root / PROJECT_ID
    path.mkdir()
    original_cwd = os.getcwd()
    os.chdir(path)
    try:
        colrev.ops.init.Initializer(
            review_type="literature_review", target_path=path, light=True
        )
    finally:
        os.chdir(original_cwd)

    (path / "data").mkdir(exist_ok=True)
    (path / "data" / "records.bib").write_text(RECORDS_BIB, encoding="utf-8")
    repo = git.Repo(path)
    repo.git.add("-A")
    repo.git.commit("-m", "Seed records", "--no-verify")

    bare = root / "remote.git"
    git.Repo.init(bare, bare=True)
    repo.create_remote("origin", str(bare))
    branch = repo.active_branch.name
    repo.git.push("-u", "origin", branch)

    yield {
        "root": root,
        "path": path,
        "branch": branch,
        "seed": repo.head.commit.hexsha,
    }


@pytest.fixture(autouse=True)
def _clean_project(project):
    repo = git.Repo(project["path"])
    repo.git.reset("--hard", project["seed"])
    repo.git.clean("-fd")
    yield


@pytest.fixture
def params(project) -> dict:
    return {"project_id": PROJECT_ID, "base_path": str(project["root"])}


def call(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _break_settings(project: dict) -> None:
    settings = project["path"] / "settings.json"
    settings.write_text(
        "<<<<<<< HEAD\n{}\n=======\n{\"x\": 1}\n>>>>>>> origin/dev\n",
        encoding="utf-8",
    )


def _truncate_history(project: dict) -> None:
    history = project["path"] / HISTORY_REL
    history.parent.mkdir(parents=True, exist_ok=True)
    history.write_text('{"search_type": "DB", "endpoint": "colrev.pub', "utf-8")


# ---------------------------------------------------------------------------
# Item 1: recovery on a broken project
# ---------------------------------------------------------------------------


class TestRecoveryOnBrokenProject:
    @pytest.mark.parametrize("breaker", [_break_settings, _truncate_history])
    def test_get_git_status_works(self, handler, project, params, breaker):
        breaker(project)
        response = call(handler, "get_git_status", params)
        assert "error" not in response, response
        assert response["result"]["git"]["is_clean"] is False

    @pytest.mark.parametrize("breaker", [_break_settings, _truncate_history])
    def test_reset_to_remote_works(self, handler, project, params, breaker):
        # A local commit on top of the broken file, as after a bad merge.
        breaker(project)
        repo = git.Repo(project["path"])
        repo.git.add("-A")
        repo.git.execute(
            ["git", "-c", "core.hooksPath=/nonexistent", "commit", "-m", "Broken state"]
        )

        response = call(handler, "reset_to_remote", {**params, "confirm": True})
        assert "error" not in response, response
        assert response["result"]["reset"] is True
        # The project loads again.
        assert "error" not in call(handler, "get_records", params)

    @pytest.mark.parametrize("breaker", [_break_settings, _truncate_history])
    def test_discard_changes_works(self, handler, project, params, breaker):
        breaker(project)
        response = call(handler, "discard_changes", {**params, "confirm": True})
        assert "error" not in response, response
        assert "error" not in call(handler, "get_records", params)

    @pytest.mark.parametrize("breaker", [_break_settings, _truncate_history])
    def test_commit_changes_works(self, handler, project, params, breaker):
        breaker(project)
        response = call(
            handler, "commit_changes", {**params, "message": "Save broken state"}
        )
        assert "error" not in response, response
        assert response["result"]["committed"] is True
        assert git.Repo(project["path"]).head.commit.message.startswith(
            "Save broken state"
        )

    def test_other_methods_name_the_broken_settings_file(
        self, handler, project, params
    ):
        _break_settings(project)
        response = call(handler, "get_records", params)
        assert response["error"]["code"] == error_handler.COLREV_PROJECT_FILE_UNREADABLE
        assert "settings.json" in response["error"]["message"]

    def test_other_methods_name_the_truncated_history_file(
        self, handler, project, params
    ):
        _truncate_history(project)
        response = call(handler, "get_records", params)
        assert response["error"]["code"] == error_handler.COLREV_PROJECT_FILE_UNREADABLE
        assert "example_search_history.json" in response["error"]["message"]

    def test_git_only_methods_are_declared(self):
        for name in (
            "get_git_status",
            "commit_changes",
            "discard_changes",
            "reset_to_remote",
        ):
            assert registry.get(name).git_only is True
        assert registry.get("get_records").git_only is False


# ---------------------------------------------------------------------------
# Item 2: error codes
# ---------------------------------------------------------------------------


class TestErrorCodes:
    def test_state_conflict_has_its_own_code(self, handler, project, params):
        # R1 is md_processed: not ready for screening.
        response = call(
            handler,
            "screen_record",
            {**params, "record_id": "R1", "decision": "include"},
        )
        assert response["error"]["code"] == error_handler.COLREV_INVALID_STATE
        assert "not ready for screening" in response["error"]["message"]

    def test_bad_params_stay_invalid_params(self, handler, params):
        response = call(handler, "screen_record", {**params, "decision": "include"})
        assert response["error"]["code"] == error_handler.INVALID_PARAMS

    def test_exception_mapping(self):
        assert (
            error_handler.map_exception_to_error_code(InvalidStateError("x"))
            == -32009
        )
        assert (
            error_handler.map_exception_to_error_code(
                ProjectFileUnreadableError("settings.json", "bad")
            )
            == -32010
        )

    def test_git_merge_refusing_a_dirty_tree_is_a_precondition_failure(
        self, project
    ):
        repo = git.Repo(project["path"])
        repo.git.checkout("-b", "other")
        (project["path"] / "data" / "records.bib").write_text(
            RECORDS_BIB + "\n% other\n", encoding="utf-8"
        )
        repo.git.add("-A")
        repo.git.commit("-m", "other change", "--no-verify")
        repo.git.checkout(project["branch"])
        (project["path"] / "data" / "records.bib").write_text(
            RECORDS_BIB + "\n% mine\n", encoding="utf-8"
        )
        repo.git.add("-A")
        try:
            with pytest.raises(git.GitCommandError) as info:
                repo.git.merge("other")
        finally:
            repo.git.reset("--hard", project["seed"])
            repo.git.branch("-D", "other")
        assert (
            error_handler.map_exception_to_error_code(info.value)
            == error_handler.COLREV_PRECONDITION_FAILED
        )

    def test_other_git_failures_stay_internal(self):
        exc = git.GitCommandError(["git", "frobnicate"], 1, stderr="boom")
        assert (
            error_handler.map_exception_to_error_code(exc)
            == error_handler.INTERNAL_ERROR
        )

    def test_reset_without_upstream_is_a_state_conflict(
        self, handler, project, params
    ):
        repo = git.Repo(project["path"])
        repo.git.checkout("-b", "no-upstream")
        try:
            response = call(handler, "reset_to_remote", {**params, "confirm": True})
        finally:
            repo.git.checkout(project["branch"])
            repo.git.branch("-D", "no-upstream")
        assert response["error"]["code"] == error_handler.COLREV_INVALID_STATE


# ---------------------------------------------------------------------------
# Item 3: records cache after a failed partial save
# ---------------------------------------------------------------------------


class TestRecordsCacheAfterFailedSave:
    def test_get_record_shows_what_is_on_disk(
        self, handler, project, params, mocker
    ):
        before = call(handler, "get_record", {**params, "record_id": "R1"})
        assert "error" not in before, before
        title_before = before["result"]["record"]["title"]

        mocker.patch(
            "colrev.dataset.Dataset._save_record_list_by_id",
            side_effect=OSError("disk full"),
        )
        failed = call(
            handler,
            "update_record",
            {**params, "record_id": "R1", "fields": {"title": "Phantom title"}},
        )
        assert "error" in failed
        mocker.stopall()

        after = call(handler, "get_record", {**params, "record_id": "R1"})
        assert after["result"]["record"]["title"] == title_before
        on_disk = (project["path"] / "data" / "records.bib").read_text("utf-8")
        assert "Phantom title" not in on_disk
        assert git.Repo(project["path"]).is_dirty(untracked_files=True) is False


# ---------------------------------------------------------------------------
# Item 4: retry only when safe
# ---------------------------------------------------------------------------


class _CountRequest(ProjectScopedRequest):
    pass


class _CountResponse(ProjectResponse):
    pass


_CALLS = {"writer": 0, "reader": 0}


class _RetryTestHandler(BaseHandler):
    """Not registered globally (the writes audit lists every registered writer);
    the specs are patched into the registry per test."""

    def locked_writer(self, req: _CountRequest) -> _CountResponse:
        _CALLS["writer"] += 1
        raise OSError("Unable to create '/x/.git/index.lock': File exists.")

    def locked_reader(self, req: _CountRequest) -> _CountResponse:
        _CALLS["reader"] += 1
        raise OSError("Unable to create '/x/.git/index.lock': File exists.")


def _spec(name: str, fn, *, writes: bool) -> MethodSpec:
    return MethodSpec(
        name=name,
        request_model=_CountRequest,
        response_model=_CountResponse,
        handler=fn,
        handler_cls=_RetryTestHandler,
        writes=writes,
    )


class TestRetryOnLock:
    @pytest.fixture(autouse=True)
    def _fast_backoffs(self, mocker):
        mocker.patch(
            "colrev.ui_jsonrpc.framework.dispatcher._LOCK_RETRY_BACKOFFS_SEC",
            (0.0, 0.0, 0.0),
        )
        mocker.patch.dict(
            registry._methods,  # pylint: disable=protected-access
            {
                "__test_lock_writer": _spec(
                    "__test_lock_writer",
                    _RetryTestHandler.locked_writer,
                    writes=True,
                ),
                "__test_lock_reader": _spec(
                    "__test_lock_reader",
                    _RetryTestHandler.locked_reader,
                    writes=False,
                ),
            },
        )
        _CALLS.update(writer=0, reader=0)

    def test_write_handler_body_runs_once(self, project, params):
        with pytest.raises(Exception) as info:
            Dispatcher().dispatch("__test_lock_writer", params)
        assert _CALLS["writer"] == 1
        assert (
            error_handler.map_exception_to_error_code(info.value)
            == error_handler.COLREV_RESOURCE_LOCKED
        )

    def test_read_handler_is_retried(self, project, params):
        with pytest.raises(Exception) as info:
            Dispatcher().dispatch("__test_lock_reader", params)
        assert _CALLS["reader"] == 4  # first try plus three retries
        assert (
            error_handler.map_exception_to_error_code(info.value)
            == error_handler.COLREV_RESOURCE_LOCKED
        )


# ---------------------------------------------------------------------------
# Item 5: atomic history writes
# ---------------------------------------------------------------------------


class TestAtomicJsonWrite:
    def test_roundtrip(self, tmp_path):
        target = tmp_path / "h.json"
        write_json_atomic(target, {"a": 1}, indent=4)
        assert json.loads(target.read_text("utf-8")) == {"a": 1}
        assert [p.name for p in tmp_path.iterdir()] == ["h.json"]

    def test_failed_write_keeps_old_file_and_leaves_no_temp(self, tmp_path):
        target = tmp_path / "h.json"
        write_json_atomic(target, {"a": 1})
        with pytest.raises(TypeError):
            write_json_atomic(target, {"a": object()})
        assert json.loads(target.read_text("utf-8")) == {"a": 1}
        assert [p.name for p in tmp_path.iterdir()] == ["h.json"]


# ---------------------------------------------------------------------------
# Item 6: git handler
# ---------------------------------------------------------------------------


class TestGitHandler:
    def test_commit_changes_fails_when_add_fails(
        self, handler, project, params, mocker
    ):
        (project["path"] / "new.txt").write_text("x", encoding="utf-8")
        original = git.cmd.Git._call_process

        def failing(self, method, *args, **kwargs):
            if method == "add":
                raise git.GitCommandError(["git", "add"], 128, stderr="boom")
            return original(self, method, *args, **kwargs)

        mocker.patch.object(git.cmd.Git, "_call_process", failing)
        before = git.Repo(project["path"]).head.commit.hexsha
        response = call(handler, "commit_changes", {**params, "message": "Save"})
        mocker.stopall()
        assert "error" in response
        assert git.Repo(project["path"]).head.commit.hexsha == before

    def test_discard_all_removes_untracked_but_not_ignored(
        self, handler, project, params
    ):
        path = project["path"]
        (path / "stray.txt").write_text("x", encoding="utf-8")
        (path / "stray_dir").mkdir()
        (path / "stray_dir" / "a.txt").write_text("x", encoding="utf-8")
        (path / "data" / "records.bib").write_text("junk", encoding="utf-8")
        ignored = path / "ignored.log"
        (path / ".git" / "info" / "exclude").write_text("*.log\n", encoding="utf-8")
        ignored.write_text("keep", encoding="utf-8")

        response = call(handler, "discard_changes", {**params, "confirm": True})
        assert "error" not in response, response
        assert "stray.txt" in response["result"]["discarded_files"]
        assert not (path / "stray.txt").exists()
        assert not (path / "stray_dir").exists()
        assert ignored.exists()
        assert (path / "data" / "records.bib").read_text("utf-8") == RECORDS_BIB
        status = call(handler, "get_git_status", params)["result"]["git"]
        assert status["untracked_files"] == []

    @pytest.mark.parametrize("staged", [True, False])
    def test_discard_paths_handles_newly_added_files(
        self, handler, project, params, staged
    ):
        path = project["path"]
        (path / "data" / "records.bib").write_text("junk", encoding="utf-8")
        (path / "added.txt").write_text("x", encoding="utf-8")
        if staged:
            git.Repo(path).git.add("added.txt")

        response = call(
            handler,
            "discard_changes",
            {**params, "paths": ["added.txt", "data/records.bib"]},
        )
        assert "error" not in response, response
        assert not (path / "added.txt").exists()
        assert (path / "data" / "records.bib").read_text("utf-8") == RECORDS_BIB
        assert git.Repo(path).is_dirty(untracked_files=True) is False

    def test_staged_record_changes_report_added_as_added(
        self, handler, project, params
    ):
        path = project["path"]
        (path / "data" / "extra.csv").write_text("a,b\n", encoding="utf-8")
        (path / "data" / "records.bib").write_text(
            RECORDS_BIB + "\n% x\n", encoding="utf-8"
        )
        repo = git.Repo(path)
        repo.git.add("-A")
        repo.git.rm("-q", "--cached", "settings.json")  # staged deletion

        changes = {
            c["record_id"]: c["change_type"]
            for c in call(handler, "get_git_status", params)["result"]["git"][
                "staged_record_changes"
            ]
        }
        assert changes["data/extra.csv"] == "added"
        assert changes["data/records.bib"] == "modified"


# ---------------------------------------------------------------------------
# Item 7: get_branch_delta
# ---------------------------------------------------------------------------


class TestBranchDelta:
    def test_load_failure_is_returned_not_swallowed(
        self, handler, project, params, mocker
    ):
        mocker.patch(
            "colrev.dataset.Dataset.load_records_dict",
            side_effect=RuntimeError("cannot parse records.bib"),
        )
        response = call(
            handler,
            "get_branch_delta",
            {**params, "base_branch": project["branch"]},
        )
        mocker.stopall()
        assert "error" in response
        assert "cannot parse records.bib" in response["error"]["message"]
