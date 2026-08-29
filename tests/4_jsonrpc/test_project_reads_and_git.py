#!/usr/bin/env python
"""Read endpoints and the git write pair, on a project with records
(WP-08 §3).

These are the RPCs the UI fires constantly — the record table, the record
detail pane, the preprocessing summary, the branch-delta banner, the
managed-review task list — plus the two that turn staged edits into a commit.
Each existed without a handler test; between them they are also the cheapest
way to give a large slice of the registry a real happy path.

One project, seeded once for the module: `colrev init` dominates the runtime
of this package, so tests that only read share a project.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

import git
import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "reads_project"

RECORDS = [
    {
        "ID": "R1",
        "origin": "import.bib/R1",
        "status": "md_processed",
        "title": "Alpha study",
        "author": "Doe, Jane",
        "year": "2021",
        "journal": "Journal A",
    },
    {
        "ID": "R2",
        "origin": "import.bib/R2",
        "status": "md_processed",
        "title": "Beta study",
        "author": "Doe, John",
        "year": "2022",
        "journal": "Journal B",
    },
]


def _records_bib(entries: list[dict]) -> str:
    blocks = []
    for entry in entries:
        blocks.append(
            "\n".join(
                [
                    f"@article{{{entry['ID']},",
                    f"   colrev_origin                 = {{{entry['origin']}}},",
                    f"   colrev_status                 = {{{entry['status']}}},",
                    f"   title                         = {{{entry['title']}}},",
                    f"   author                        = {{{entry['author']}}},",
                    f"   year                          = {{{entry['year']}}},",
                    f"   journal                       = {{{entry['journal']}}},",
                    "}",
                ]
            )
        )
    return "\n\n".join(blocks) + "\n"


def _request(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def project(tmp_path_factory, session_mocker) -> Generator[Path, None, None]:
    root = tmp_path_factory.mktemp("reads_projects")
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

    records_path = project_path / "data" / "records.bib"
    records_path.parent.mkdir(parents=True, exist_ok=True)
    records_path.write_text(_records_bib(RECORDS), encoding="utf-8")
    repo = git.Repo(project_path)
    repo.git.add("data/records.bib")
    repo.git.commit("-m", "Seed records")

    yield root


@pytest.fixture
def params(project: Path) -> dict:
    return {"project_id": PROJECT_ID, "base_path": str(project)}


class TestRecordReads:
    def test_get_record_returns_one_record_by_id(self, handler, params) -> None:
        result = _request(handler, "get_record", {**params, "record_id": "R1"})["result"]

        assert result["record"]["ID"] == "R1"
        assert result["record"]["title"] == "Alpha study"

    def test_get_record_reports_an_unknown_id(self, handler, params) -> None:
        assert "error" in _request(handler, "get_record", {**params, "record_id": "NOPE"})

    def test_update_record_edits_a_field_in_place(self, handler, params) -> None:
        _request(
            handler,
            "update_record",
            {**params, "record_id": "R2", "fields": {"title": "Beta study (revised)"}},
        )

        after = _request(handler, "get_record", {**params, "record_id": "R2"})["result"]
        assert after["record"]["title"] == "Beta study (revised)"
        # The edit must not disturb the other record.
        other = _request(handler, "get_record", {**params, "record_id": "R1"})["result"]
        assert other["record"]["title"] == "Alpha study"

    def test_update_record_reports_an_unknown_id(self, handler, params) -> None:
        assert "error" in _request(
            handler,
            "update_record",
            {**params, "record_id": "NOPE", "fields": {"title": "x"}},
        )


class TestProjectReads:
    def test_preprocessing_summary_describes_the_dataset(self, handler, params) -> None:
        result = _request(handler, "get_preprocessing_summary", params)["result"]
        assert result["project_id"] == PROJECT_ID

    def test_branch_delta_reports_the_current_branch(self, handler, params) -> None:
        result = _request(handler, "get_branch_delta", params)["result"]

        assert result["current_branch"]
        assert isinstance(result["changed_record_count"], int)

    def test_source_records_are_read_from_the_named_search_file(
        self, handler, params, project
    ) -> None:
        search_file = project / PROJECT_ID / "data" / "search" / "manual.bib"
        search_file.parent.mkdir(parents=True, exist_ok=True)
        search_file.write_text(
            "@article{S1,\n  title = {Alpha study},\n  author = {Doe, Jane},\n"
            "  year = {2021},\n  journal = {Journal A},\n}\n",
            encoding="utf-8",
        )

        # The file has to be a *registered* source: get_source_records reads
        # through the source list, not the directory.
        added = _request(
            handler,
            "add_source",
            {
                **params,
                "endpoint": "colrev.unknown_source",
                "search_type": "DB",
                "filename": "data/search/manual.bib",
            },
        )
        assert "error" not in added, added.get("error")

        result = _request(
            handler, "get_source_records", {**params, "filename": "data/search/manual.bib"}
        )["result"]

        assert isinstance(result["records"], list)
        assert any(r.get("title") == "Alpha study" for r in result["records"])

    def test_source_records_requires_a_filename(self, handler, params) -> None:
        assert "error" in _request(handler, "get_source_records", params)

    def test_managed_review_tasks_start_empty(self, handler, params) -> None:
        result = _request(
            handler, "list_managed_review_tasks", {**params, "kind": "prescreen"}
        )["result"]

        assert result["kind"] == "prescreen"
        assert result["tasks"] == []


class TestGitWrites:
    def test_commit_captures_a_staged_edit_and_then_has_nothing_left(
        self, handler, params, project
    ) -> None:
        _request(
            handler,
            "update_record",
            {**params, "record_id": "R1", "fields": {"year": "2020"}},
        )

        result = _request(
            handler, "commit_changes", {**params, "message": "Correct R1 year"}
        )["result"]

        assert result["committed"] is True
        assert result["commit_sha"]
        repo = git.Repo(project / PROJECT_ID)
        assert not repo.is_dirty(untracked_files=False)

        # Committing again is a no-op, not an error: the commit button stays
        # enabled and a double-click must not produce an empty commit.
        again = _request(handler, "commit_changes", {**params, "message": "no-op"})[
            "result"
        ]
        assert again["committed"] is False

    def test_discard_requires_explicit_confirmation(self, handler, params, project) -> None:
        _request(
            handler,
            "update_record",
            {**params, "record_id": "R2", "fields": {"year": "1999"}},
        )

        refused = _request(handler, "discard_changes", params)
        assert "error" in refused, "discard_changes threw away work without confirm"

        confirmed = _request(handler, "discard_changes", {**params, "confirm": True})[
            "result"
        ]
        assert confirmed["project_id"] == PROJECT_ID
        repo = git.Repo(project / PROJECT_ID)
        assert not repo.is_dirty(untracked_files=False)
