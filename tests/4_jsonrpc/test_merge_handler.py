#!/usr/bin/env python
"""Tests for the MergeHandler JSON-RPC endpoints (engine-owned merge).

Covers:
    - analyze_merge: status-only divergence (auto), included-vs-excluded
      conflicts (needs resolution), non-status drift (blocked), and
      settings.json field-level conflicts.
    - apply_merge: creates a real 2-parent merge commit, keeps status.yaml
      consistent with records.bib, reports inter-rater agreement, and rolls
      back cleanly on error.
    - merge_settings: pure 3-way field merge behavior.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import git
import pytest
import yaml

import colrev.constants
import colrev.loader.load_utils
import colrev.ops.init
from colrev.constants import Fields
from colrev.constants import RecordState
from colrev.ui_jsonrpc.framework_handlers.merge_handler import merge_settings
from colrev.ui_jsonrpc.handler import JSONRPCHandler
from colrev.writer.write_utils import to_string

NESTED_TITLE = "A {Nested} Title with an @ sign"


def _base_records() -> dict:
    return {
        "Smith2020": {
            Fields.ID: "Smith2020",
            Fields.ENTRYTYPE: "article",
            Fields.ORIGIN: ["manual_import.bib/Smith2020"],
            Fields.STATUS: RecordState.md_processed,
            Fields.AUTHOR: "Smith, John",
            Fields.TITLE: NESTED_TITLE,
            Fields.JOURNAL: "Journal of Testing",
            Fields.YEAR: "2020",
        },
        "Doe2021": {
            Fields.ID: "Doe2021",
            Fields.ENTRYTYPE: "article",
            Fields.ORIGIN: ["manual_import.bib/Doe2021"],
            Fields.STATUS: RecordState.md_processed,
            Fields.AUTHOR: "Doe, Jane",
            Fields.TITLE: "A plain title",
            Fields.JOURNAL: "Journal of Testing",
            Fields.YEAR: "2021",
        },
        "Lee2022": {
            Fields.ID: "Lee2022",
            Fields.ENTRYTYPE: "article",
            Fields.ORIGIN: ["manual_import.bib/Lee2022"],
            Fields.STATUS: RecordState.md_processed,
            Fields.AUTHOR: "Lee, Kim",
            Fields.TITLE: "Another plain title",
            Fields.JOURNAL: "Journal of Testing",
            Fields.YEAR: "2022",
        },
    }


class MergeProjectFixture:
    """A colrev project with a divergent ``other`` branch."""

    def __init__(self, base_path: Path, project_id: str):
        self.base_path = base_path
        self.project_id = project_id
        self.project_path = base_path / project_id
        self.repo = git.Repo(str(self.project_path))
        self.main_branch = self.repo.active_branch.name

    # -- plumbing ------------------------------------------------------

    def _run_git(self, *args: str) -> None:
        subprocess.run(
            ["git", *args], cwd=self.project_path, check=True, capture_output=True
        )

    def commit_all(self, message: str) -> None:
        self._run_git("add", "-A")
        self._run_git("commit", "--no-verify", "-m", message)

    def write_records(self, records: dict) -> None:
        bibtex_str = to_string(records_dict=records, implementation="bib")
        (self.project_path / "data" / "records.bib").write_text(
            bibtex_str + "\n", encoding="utf-8"
        )

    def load_records(self) -> dict:
        return colrev.loader.load_utils.load(
            filename=self.project_path / "data" / "records.bib",
            unique_id_field="ID",
        )

    def seed_records(self, records: dict) -> None:
        self.write_records(records)
        self.commit_all("Seed records")

    def diverge(self, ours_edit, theirs_edit) -> None:
        """Create branch ``other`` from HEAD; apply edits to each side."""
        self._run_git("branch", "other")
        ours_edit(self)
        self.commit_all("Ours changes")
        self._run_git("checkout", "other")
        theirs_edit(self)
        self.commit_all("Theirs changes")
        self._run_git("checkout", self.main_branch)

    def set_status(self, record_id: str, status: RecordState) -> None:
        records = self.load_records()
        records[record_id][Fields.STATUS] = status
        self.write_records(records)

    def set_field(self, record_id: str, field: str, value: str) -> None:
        records = self.load_records()
        records[record_id][field] = value
        self.write_records(records)

    def edit_settings(self, mutate) -> None:
        settings_path = self.project_path / "settings.json"
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        mutate(settings)
        settings_path.write_text(
            json.dumps(settings, indent=4) + "\n", encoding="utf-8"
        )

    # -- assertions ----------------------------------------------------

    def assert_no_merge_in_progress(self) -> None:
        result = subprocess.run(
            ["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"],
            cwd=self.project_path,
            capture_output=True,
        )
        assert result.returncode != 0, "merge unexpectedly still in progress"
        assert not self.repo.is_dirty(untracked_files=False)

    def assert_status_yaml_consistent(self) -> None:
        status = yaml.safe_load(
            (self.project_path / "status.yaml").read_text(encoding="utf-8")
        )
        records = self.load_records()
        for state in (
            RecordState.md_processed,
            RecordState.rev_prescreen_included,
            RecordState.rev_prescreen_excluded,
        ):
            expected = len(
                [r for r in records.values() if str(r[Fields.STATUS]) == str(state)]
            )
            assert (
                status["currently"][str(state)] == expected
            ), f"status.yaml inconsistent for {state}"

    def head_parents(self) -> int:
        return len(self.repo.head.commit.parents)


@pytest.fixture(name="merge_project")
def merge_project_fixture(tmp_path, mocker) -> MergeProjectFixture:
    """Initialize a colrev project ready for divergence tests."""
    project_id = "merge_test_project"
    project_dir = tmp_path / project_id
    project_dir.mkdir()

    mocker.patch(
        "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
        return_value=("Test User", "test@example.com"),
    )
    mocker.patch.object(
        colrev.constants.Filepaths,
        "REGISTRY_FILE",
        project_dir / "reg.json",
    )

    original_cwd = os.getcwd()
    os.chdir(project_dir)
    try:
        colrev.ops.init.Initializer(
            review_type="literature_review",
            target_path=project_dir,
            light=True,
        )
    finally:
        os.chdir(original_cwd)

    fixture = MergeProjectFixture(tmp_path, project_id)
    fixture._run_git("config", "user.name", "Test User")
    fixture._run_git("config", "user.email", "test@example.com")
    fixture.seed_records(_base_records())
    return fixture


def _call(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    response = handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )
    return response


def _params(fixture: MergeProjectFixture, **extra) -> dict:
    return {
        "project_id": fixture.project_id,
        "base_path": str(fixture.base_path),
        "theirs": "other",
        **extra,
    }


class TestAnalyzeMerge:
    def test_status_only_divergence_on_distinct_records_is_auto_mergeable(
        self, merge_project
    ):
        merge_project.diverge(
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_included),
            lambda p: p.set_status("Lee2022", RecordState.rev_prescreen_excluded),
        )
        handler = JSONRPCHandler()

        response = _call(handler, "analyze_merge", _params(merge_project))
        assert "error" not in response, response.get("error")
        result = response["result"]
        assert result["auto_mergeable"] is True
        assert result["status_conflicts"] == []
        assert result["blockers"] == []
        merge_project.assert_no_merge_in_progress()

    def test_included_vs_excluded_conflict_needs_resolution(self, merge_project):
        merge_project.diverge(
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_included),
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_excluded),
        )
        handler = JSONRPCHandler()

        response = _call(handler, "analyze_merge", _params(merge_project))
        assert "error" not in response, response.get("error")
        result = response["result"]
        assert result["auto_mergeable"] is False
        assert result["blockers"] == []
        assert len(result["status_conflicts"]) == 1
        conflict = result["status_conflicts"][0]
        assert conflict["id"] == "Smith2020"
        assert conflict["ours"] == "rev_prescreen_included"
        assert conflict["theirs"] == "rev_prescreen_excluded"
        assert conflict["author"] == "Smith, John"
        assert conflict["year"] == "2020"
        merge_project.assert_no_merge_in_progress()

    def test_non_status_drift_is_blocked(self, merge_project):
        merge_project.diverge(
            lambda p: p.set_field("Smith2020", Fields.TITLE, "Ours title"),
            lambda p: p.set_field("Smith2020", Fields.TITLE, "Theirs title"),
        )
        handler = JSONRPCHandler()

        response = _call(handler, "analyze_merge", _params(merge_project))
        assert "error" not in response, response.get("error")
        result = response["result"]
        assert result["auto_mergeable"] is False
        assert len(result["blockers"]) >= 1
        assert any("Smith2020" in b["reason"] for b in result["blockers"])
        merge_project.assert_no_merge_in_progress()

    def test_wrong_ours_branch_is_rejected(self, merge_project):
        merge_project.diverge(
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_included),
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_excluded),
        )
        handler = JSONRPCHandler()

        response = _call(
            handler, "analyze_merge", _params(merge_project, ours="not-a-branch")
        )
        assert "error" in response
        merge_project.assert_no_merge_in_progress()

    def test_settings_conflict_reported_field_level(self, merge_project):
        merge_project.diverge(
            lambda p: p.edit_settings(
                lambda s: s["project"].update({"title": "Ours Title"})
            ),
            lambda p: p.edit_settings(
                lambda s: s["project"].update({"title": "Theirs Title"})
            ),
        )
        handler = JSONRPCHandler()

        response = _call(handler, "analyze_merge", _params(merge_project))
        assert "error" not in response, response.get("error")
        result = response["result"]
        assert result["auto_mergeable"] is False
        assert result["settings_conflict"] is True
        assert result["settings_conflicts"] == [
            {"path": "project.title", "ours": "Ours Title", "theirs": "Theirs Title"}
        ]
        merge_project.assert_no_merge_in_progress()


class TestApplyMerge:
    def test_auto_merge_creates_two_parent_commit(self, merge_project):
        merge_project.diverge(
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_included),
            lambda p: p.set_status("Lee2022", RecordState.rev_prescreen_excluded),
        )
        handler = JSONRPCHandler()

        response = _call(handler, "apply_merge", _params(merge_project))
        assert "error" not in response, response.get("error")
        result = response["result"]
        assert result["merged"] is True
        assert merge_project.head_parents() == 2
        merge_project.assert_no_merge_in_progress()

        records = merge_project.load_records()
        assert str(records["Smith2020"][Fields.STATUS]) == "rev_prescreen_included"
        assert str(records["Lee2022"][Fields.STATUS]) == "rev_prescreen_excluded"
        merge_project.assert_status_yaml_consistent()

    def test_resolution_applied_and_agreement_reported(self, merge_project):
        def ours_edit(p):
            p.set_status("Smith2020", RecordState.rev_prescreen_included)
            p.set_status("Doe2021", RecordState.rev_prescreen_included)

        def theirs_edit(p):
            p.set_status("Smith2020", RecordState.rev_prescreen_excluded)
            p.set_status("Doe2021", RecordState.rev_prescreen_excluded)

        merge_project.diverge(ours_edit, theirs_edit)
        handler = JSONRPCHandler()

        response = _call(
            handler,
            "apply_merge",
            _params(
                merge_project,
                resolutions={"Smith2020": "theirs", "Doe2021": "ours"},
            ),
        )
        assert "error" not in response, response.get("error")
        result = response["result"]
        assert result["merged"] is True
        assert merge_project.head_parents() == 2
        assert 0 <= result["statistics"]["percentage_agreement"] < 1

        records = merge_project.load_records()
        assert str(records["Smith2020"][Fields.STATUS]) == "rev_prescreen_excluded"
        assert str(records["Doe2021"][Fields.STATUS]) == "rev_prescreen_included"
        merge_project.assert_status_yaml_consistent()
        merge_project.assert_no_merge_in_progress()

        # `colrev validate --merge` reports agreement stats on the commit
        review_manager = colrev.review_manager.ReviewManager(
            path_str=str(merge_project.project_path), force_mode=True
        )
        validate_operation = review_manager.get_validate_operation()
        merge_validation = validate_operation._validate_merge_changes()["merge"]
        validated_shas = [entry["commit_sha"] for entry in merge_validation]
        assert result["commit_sha"] in validated_shas
        entry = merge_validation[validated_shas.index(result["commit_sha"])]
        assert 0 <= entry["statistics"]["percentage_agreement"] < 1

    def test_nested_brace_title_survives_byte_identically(self, merge_project):
        records_file = merge_project.project_path / "data" / "records.bib"
        title_lines_before = [
            line
            for line in records_file.read_text(encoding="utf-8").splitlines()
            if NESTED_TITLE.split(" ")[1] in line
        ]
        assert title_lines_before, "fixture must contain the nested-brace title"

        merge_project.diverge(
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_included),
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_excluded),
        )
        handler = JSONRPCHandler()

        response = _call(
            handler,
            "apply_merge",
            _params(merge_project, resolutions={"Smith2020": "ours"}),
        )
        assert "error" not in response, response.get("error")

        content_after = records_file.read_text(encoding="utf-8")
        title_lines_after = [
            line
            for line in content_after.splitlines()
            if NESTED_TITLE.split(" ")[1] in line
        ]
        assert title_lines_after == title_lines_before
        records = merge_project.load_records()
        assert records["Smith2020"][Fields.TITLE] == NESTED_TITLE

    def test_missing_resolution_rolls_back(self, merge_project):
        merge_project.diverge(
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_included),
            lambda p: p.set_status("Smith2020", RecordState.rev_prescreen_excluded),
        )
        handler = JSONRPCHandler()
        head_before = merge_project.repo.head.commit.hexsha

        response = _call(handler, "apply_merge", _params(merge_project))
        assert "error" in response
        assert "Smith2020" in response["error"]["message"]
        assert merge_project.repo.head.commit.hexsha == head_before
        merge_project.assert_no_merge_in_progress()

    def test_blocked_merge_rolls_back(self, merge_project):
        merge_project.diverge(
            lambda p: p.set_field("Smith2020", Fields.TITLE, "Ours title"),
            lambda p: p.set_field("Smith2020", Fields.TITLE, "Theirs title"),
        )
        handler = JSONRPCHandler()
        head_before = merge_project.repo.head.commit.hexsha

        response = _call(handler, "apply_merge", _params(merge_project))
        assert "error" in response
        assert merge_project.repo.head.commit.hexsha == head_before
        merge_project.assert_no_merge_in_progress()

    def test_settings_resolution_applied(self, merge_project):
        merge_project.diverge(
            lambda p: p.edit_settings(
                lambda s: s["project"].update({"title": "Ours Title"})
            ),
            lambda p: p.edit_settings(
                lambda s: (
                    s["project"].update({"title": "Theirs Title"}),
                    s["prescreen"].update({"explanation": "Theirs explanation"}),
                )
            ),
        )
        handler = JSONRPCHandler()

        response = _call(
            handler,
            "apply_merge",
            _params(
                merge_project,
                settings_resolutions={"project.title": "theirs"},
            ),
        )
        assert "error" not in response, response.get("error")
        assert merge_project.head_parents() == 2

        settings = json.loads(
            (merge_project.project_path / "settings.json").read_text(encoding="utf-8")
        )
        assert settings["project"]["title"] == "Theirs Title"
        # theirs-only change auto-merged
        assert settings["prescreen"]["explanation"] == "Theirs explanation"
        merge_project.assert_no_merge_in_progress()


class TestMergeSettings:
    def test_theirs_only_change_auto_applies(self):
        base = {"a": 1, "b": {"c": 2}}
        ours = {"a": 1, "b": {"c": 2}}
        theirs = {"a": 1, "b": {"c": 3}}
        merged, conflicts = merge_settings(base, ours, theirs)
        assert merged == {"a": 1, "b": {"c": 3}}
        assert conflicts == []

    def test_ours_only_change_is_kept(self):
        base = {"a": 1}
        ours = {"a": 2}
        theirs = {"a": 1}
        merged, conflicts = merge_settings(base, ours, theirs)
        assert merged == {"a": 2}
        assert conflicts == []

    def test_both_changed_differently_is_conflict(self):
        base = {"a": 1}
        ours = {"a": 2}
        theirs = {"a": 3}
        merged, conflicts = merge_settings(base, ours, theirs)
        assert merged == {"a": 2}
        assert conflicts == [{"path": "a", "ours": 2, "theirs": 3}]

    def test_decision_resolves_conflict(self):
        base = {"a": 1}
        ours = {"a": 2}
        theirs = {"a": 3}
        merged, conflicts = merge_settings(
            base, ours, theirs, decisions={"a": "theirs"}
        )
        assert merged == {"a": 3}
        assert conflicts == []

    def test_lists_are_atomic(self):
        base = {"sources": [{"filename": "x"}]}
        ours = {"sources": [{"filename": "x"}, {"filename": "y"}]}
        theirs = {"sources": [{"filename": "x"}, {"filename": "z"}]}
        _, conflicts = merge_settings(base, ours, theirs)
        assert [c["path"] for c in conflicts] == ["sources"]

    def test_theirs_deletion_auto_applies(self):
        base = {"a": 1, "b": 2}
        ours = {"a": 1, "b": 2}
        theirs = {"a": 1}
        merged, conflicts = merge_settings(base, ours, theirs)
        assert merged == {"a": 1}
        assert conflicts == []

    def test_both_added_same_value_no_conflict(self):
        base = {}
        ours = {"a": 1}
        theirs = {"a": 1}
        merged, conflicts = merge_settings(base, ours, theirs)
        assert merged == {"a": 1}
        assert conflicts == []
