#!/usr/bin/env python
"""Tests for engine precondition enforcement at the JSON-RPC seam.

WP-01: the blanket ``interactive_mode`` bypass is gone. Batch operations run
with the engine's own preconditions ("enforce"); per-record manual decision
endpoints run with the narrow manual-decision relaxation (working tree clean
except ``data/records.bib``).
"""
from __future__ import annotations

import os
from pathlib import Path

import git
import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.error_handler import COLREV_PRECONDITION_FAILED
from colrev.ui_jsonrpc.handler import JSONRPCHandler


def _request(method: str, project_id: str, base_path: Path, **params):
    handler = JSONRPCHandler()
    request = {
        "jsonrpc": "2.0",
        "method": method,
        "params": {
            "project_id": project_id,
            "base_path": str(base_path),
            **params,
        },
        "id": 1,
    }
    return handler.handle_request(request)


def _records_bib(entries: list[dict]) -> str:
    records = []
    for entry in entries:
        records.append(
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
    return "\n\n".join(records) + "\n"


class TestPreconditions:
    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        self.base_path = tmp_path
        self.project_id = "precondition_project"
        self.test_dir = self.base_path / self.project_id
        self.test_dir.mkdir()

        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )
        mocker.patch.object(
            colrev.constants.Filepaths,
            "REGISTRY_FILE",
            self.test_dir / "reg.json",
        )

        original_cwd = os.getcwd()
        os.chdir(self.test_dir)
        try:
            colrev.ops.init.Initializer(
                review_type="literature_review",
                target_path=self.test_dir,
                light=True,
            )
        finally:
            os.chdir(original_cwd)

        self.repo = git.Repo(self.test_dir)

        records_path = self.test_dir / "data" / "records.bib"
        records_path.parent.mkdir(parents=True, exist_ok=True)
        records_path.write_text(
            _records_bib(
                [
                    {
                        "ID": "R1",
                        "origin": "import.bib/R1",
                        "status": "md_processed",
                        "title": "Alpha",
                        "author": "Doe, Jane",
                        "year": "2021",
                        "journal": "Journal A",
                    },
                    {
                        "ID": "R2",
                        "origin": "import.bib/R2",
                        "status": "md_processed",
                        "title": "Beta",
                        "author": "Doe, John",
                        "year": "2022",
                        "journal": "Journal B",
                    },
                ]
            ),
            encoding="utf-8",
        )
        self.repo.git.add("data/records.bib")
        self.repo.git.commit("-m", "Add records")

    def _prescreen_record(self, record_id: str, decision: str) -> dict:
        return _request(
            "prescreen_record",
            self.project_id,
            self.base_path,
            record_id=record_id,
            decision=decision,
        )

    def test_manual_decision_allows_dirty_records_bib(self):
        # First decision dirties data/records.bib (staged, uncommitted) —
        # exactly the state every subsequent mid-session decision runs in.
        first = self._prescreen_record("R1", "include")
        assert "error" not in first
        assert self.repo.is_dirty()

        second = self._prescreen_record("R2", "exclude")
        assert "error" not in second
        assert second["result"]["record"]["new_status"] == "rev_prescreen_excluded"

    def test_manual_decision_rejects_other_dirty_files(self):
        # A dirty non-records file is NOT covered by the relaxation.
        (self.test_dir / "settings.json").write_text(
            (self.test_dir / "settings.json").read_text(encoding="utf-8") + "\n",
            encoding="utf-8",
        )

        response = self._prescreen_record("R1", "include")
        assert "error" in response
        assert response["error"]["code"] == COLREV_PRECONDITION_FAILED
        assert response["error"]["data"] == "UnstagedGitChangesError"

    def test_enforce_blocks_batch_ops_on_dirty_tree(self):
        assert "error" not in self._prescreen_record("R1", "include")
        assert self.repo.is_dirty()

        for method in ("prep", "dedupe", "prescreen"):
            response = _request(method, self.project_id, self.base_path)
            assert "error" in response, method
            assert response["error"]["code"] == COLREV_PRECONDITION_FAILED, method
            assert response["error"]["data"] in (
                "CleanRepoRequiredError",
                "UnstagedGitChangesError",
            ), method

    def test_enforce_succeeds_on_clean_repo(self):
        # No records in md_prepared → dedupe is a quick no-op, but the
        # operation itself must construct and pass its precondition.
        response = _request("dedupe", self.project_id, self.base_path)
        assert "error" not in response
