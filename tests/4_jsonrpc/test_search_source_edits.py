#!/usr/bin/env python
"""Editing, removing or re-uploading a search source must not lose data or
leave the repository in a state the next engine operation refuses (BOE-976)."""
from __future__ import annotations

import base64
import os
import subprocess
from pathlib import Path
from typing import Generator

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "source_edit_state_project"
BIB = """@article{S1,
  title = {Alpha study},
  author = {Doe, Jane},
  year = {2021},
  journal = {Journal A},
}
"""


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def root(tmp_path_factory, session_mocker) -> Generator[Path, None, None]:
    root = tmp_path_factory.mktemp("source_edit_state")
    session_mocker.patch(
        "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )
    session_mocker.patch.object(
        colrev.constants.Filepaths, "REGISTRY_FILE", root / "reg.json"
    )
    project = root / PROJECT_ID
    project.mkdir()
    cwd = os.getcwd()
    os.chdir(project)
    try:
        colrev.ops.init.Initializer(
            review_type="literature_review", target_path=project, light=True
        )
    finally:
        os.chdir(cwd)
    yield root


@pytest.fixture
def project(root: Path) -> Path:
    return root / PROJECT_ID


@pytest.fixture
def call(handler: JSONRPCHandler, root: Path):
    def _call(method: str, **params) -> dict:
        return handler.handle_request(
            {
                "jsonrpc": "2.0",
                "method": method,
                "params": {"project_id": PROJECT_ID, "base_path": str(root), **params},
                "id": 1,
            }
        )

    return _call


def _ok(response: dict) -> dict:
    assert "error" not in response, response.get("error")
    return response["result"]


def _git(project: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=project, capture_output=True, text=True, check=True
    ).stdout


def _commit_all(call, project: Path) -> None:
    """What the UI's Save button does between a write and the next operation."""
    _ok(call("commit_changes", message="save"))
    assert _git(project, "status", "--porcelain") == ""


def _unstaged(project: Path) -> list[str]:
    """Porcelain lines with a working-tree change (second column) or untracked."""
    return [
        line
        for line in _git(project, "status", "--porcelain").splitlines()
        if line[1] != " " or line.startswith("??")
    ]


def _add_db_source(call, project: Path, name: str, content: str = BIB) -> str:
    filename = f"data/search/{name}.bib"
    _ok(call("upload_search_file", filename=f"{name}.bib", content=content))
    _ok(
        call(
            "add_source",
            endpoint="colrev.unknown_source",
            search_type="DB",
            filename=filename,
            search_string="initial query",
        )
    )
    return filename


def _sources(call) -> dict:
    return {s["search_results_path"]: s for s in _ok(call("get_sources"))["sources"]}


class TestUpdateSourceState:
    def test_query_edit_keeps_the_uploaded_file_and_the_repo_runnable(
        self, call, project
    ) -> None:
        filename = _add_db_source(call, project, "edit_keeps")
        _commit_all(call, project)

        _ok(call("update_source", filename=filename, search_string="revised"))

        assert (project / filename).read_text(encoding="utf-8") == BIB
        assert _unstaged(project) == []
        source = _sources(call)[filename]
        assert source["record_count"] == 1
        assert source["search_string"] == "revised"
        # Nothing re-runs an uploaded file, so the label edit is not "stale".
        assert source["is_stale"] is False

        _commit_all(call, project)
        _ok(call("load"))

    def test_query_edit_of_an_api_source_still_clears_its_results(
        self, call, project, monkeypatch
    ) -> None:
        monkeypatch.setenv("OPENALEX_API_KEY", "test-key")
        filename = "data/search/oa_edit.bib"
        (project / filename).write_text(BIB, encoding="utf-8")
        _ok(
            call(
                "add_source",
                endpoint="colrev.open_alex",
                search_type="API",
                filename=filename,
                search_string="sotatercept",
                search_parameters={"query": {"search": "sotatercept"}},
            )
        )
        _commit_all(call, project)

        _ok(call("update_source", filename=filename, search_string="macitentan"))

        assert (project / filename).read_text(encoding="utf-8") == ""
        assert _unstaged(project) == []
        _commit_all(call, project)


class TestRemoveSourceState:
    def test_remove_leaves_nothing_unstaged(self, call, project) -> None:
        filename = _add_db_source(call, project, "to_remove")
        _commit_all(call, project)

        _ok(call("remove_source", filename=filename, delete_file=True))

        assert _unstaged(project) == []
        assert filename not in _sources(call)
        _commit_all(call, project)
        assert not (project / filename).exists()

    def test_remove_keeping_the_file_leaves_nothing_unstaged(
        self, call, project
    ) -> None:
        filename = _add_db_source(call, project, "to_remove_keep")
        _commit_all(call, project)

        _ok(call("remove_source", filename=filename))

        assert _unstaged(project) == []
        assert (project / filename).exists()
        _commit_all(call, project)


class TestUploadOverTrackedFile:
    def test_reupload_is_staged_and_load_runs(self, call, project) -> None:
        filename = _add_db_source(call, project, "reupload")
        _commit_all(call, project)

        newer = BIB.replace("Alpha", "Beta")
        response = _ok(
            call(
                "upload_search_file",
                filename="reupload.bib",
                content=base64.b64encode(newer.encode()).decode(),
                encoding="base64",
            )
        )
        assert response["path"] == filename

        assert (project / filename).read_text(encoding="utf-8") == newer
        assert _unstaged(project) == []
        _commit_all(call, project)
        _ok(call("load"))


class TestSearchMarksOnlyTheSelectedSource:
    def test_a_name_that_is_a_substring_of_another_is_not_marked(
        self, call, project, mocker
    ) -> None:
        short = _add_db_source(call, project, "a")
        long = _add_db_source(call, project, "bib_a")
        _commit_all(call, project)
        before = _sources(call)
        mocker.patch("colrev.ops.search.Search.main")

        # "a.bib" is a substring of "bib_a.bib".
        _ok(call("search", source=long))

        after = _sources(call)
        assert (
            after[long]["last_run_timestamp"] != before[long]["last_run_timestamp"]
        )
        assert (
            after[short]["last_run_timestamp"] == before[short]["last_run_timestamp"]
        )


class TestStaleness:
    def test_the_default_files_source_is_not_stale_in_the_list_or_the_status(
        self, call
    ) -> None:
        files = [
            s for s in _ok(call("get_sources"))["sources"] if s["search_type"] == "FILES"
        ]
        assert files, "a new project has a FILES source"
        assert all(s["is_stale"] is False for s in files)
        stale = _ok(call("get_status"))["status"].get("stale_sources", [])
        assert not [s for s in stale if s["platform"] == "colrev.files_dir"]


class TestUnreadableSearchFile:
    @pytest.fixture
    def broken(self, call, project) -> Generator[str, None, None]:
        filename = "data/search/broken.xlsx"
        (project / filename).write_bytes(b"this is not a workbook")
        _ok(
            call(
                "add_source",
                endpoint="colrev.unknown_source",
                search_type="DB",
                filename=filename,
            )
        )
        yield filename
        _ok(call("remove_source", filename=filename, delete_file=True))
        _commit_all(call, project)

    def test_status_and_summary_still_load_and_name_the_source(
        self, call, broken
    ) -> None:
        status = _ok(call("get_status"))["status"]
        assert [u["filename"] for u in status["unreadable_sources"]] == [broken]

        summary = _ok(call("get_preprocessing_summary"))
        by_file = {s["filename"]: s for s in summary["sources"]}
        assert "error" in by_file[broken]
        assert "error" not in by_file["data/search/files.bib"]

    def test_load_names_the_source(self, call, broken) -> None:
        response = call("load")
        assert "error" in response
        assert broken in response["error"]["message"]

    def test_the_source_can_be_listed_and_removed(self, call, broken) -> None:
        assert broken in _sources(call)
