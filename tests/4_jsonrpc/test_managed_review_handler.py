#!/usr/bin/env python
"""Tests for managed dual-review JSON-RPC endpoints."""
from __future__ import annotations

import os
import sys
import types
from pathlib import Path

import git
import pytest

docker_module = types.ModuleType("docker")
docker_errors_module = types.ModuleType("docker.errors")
docker_errors_module.DockerException = Exception
docker_module.errors = docker_errors_module
sys.modules.setdefault("docker", docker_module)
sys.modules.setdefault("docker.errors", docker_errors_module)

import colrev.constants
import colrev.ops.init
import colrev.review_manager
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
        lines = [
            f"@article{{{entry['ID']},",
            f"   colrev_origin                 = {{{entry['origin']}}},",
            f"   colrev_status                 = {{{entry['status']}}},",
            f"   title                         = {{{entry['title']}}},",
            f"   author                        = {{{entry['author']}}},",
            f"   year                          = {{{entry['year']}}},",
            f"   journal                       = {{{entry['journal']}}},",
        ]
        if "file" in entry:
            lines.append(f"   file                          = {{{entry['file']}}},")
        if "screening_criteria" in entry:
            lines.append(
                f"   screening_criteria            = {{{entry['screening_criteria']}}},"
            )
        lines.append("}")
        records.append("\n".join(lines))
    return "\n\n".join(records) + "\n"


def _write_records(repo_path: Path, entries: list[dict]) -> None:
    records_path = repo_path / "data" / "records.bib"
    records_path.parent.mkdir(parents=True, exist_ok=True)
    records_path.write_text(_records_bib(entries), encoding="utf-8")


class TestManagedReviewJSONRPC:
    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        self.base_path = tmp_path
        self.project_id = "managed_review_project"
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
        self.remote_dir = self.base_path / "remote.git"
        git.Repo.init(self.remote_dir, bare=True)
        self.repo.create_remote("origin", str(self.remote_dir))
        self.repo.git.checkout("-b", "dev")
        self.repo.git.push("--set-upstream", "origin", "dev")

    def _commit_records(self, entries: list[dict], message: str) -> None:
        _write_records(self.test_dir, entries)
        self.repo.git.add("data/records.bib")
        self.repo.git.commit("-m", message)
        if self.repo.active_branch.name == "dev":
            self.repo.git.push()

    def _create_local_review_branches(self, task: dict, launch_ref: str) -> None:
        for reviewer in task["reviewers"]:
            self.repo.git.branch(reviewer["branch_name"], launch_ref)

    def test_screen_launch_requires_pdf_prep_completion(self):
        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": "rev_prescreen_included",
                    "title": "Needs retrieval",
                    "author": "Doe, Jane",
                    "year": "2021",
                    "journal": "Journal A",
                },
                {
                    "ID": "R2",
                    "origin": "import.bib/R2",
                    "status": "pdf_prepared",
                    "title": "Ready",
                    "author": "Doe, John",
                    "year": "2022",
                    "journal": "Journal B",
                    "file": "data/pdfs/R2.pdf",
                },
            ],
            "Add screening records",
        )

        response = _request(
            "get_managed_review_task_readiness",
            self.project_id,
            self.base_path,
            kind="screen",
        )

        assert "error" not in response
        result = response["result"]
        assert result["ready"] is False
        assert any("Finish PDF retrieval and preparation" in issue for issue in result["issues"])

    def test_prescreen_task_reconciliation_and_export(self):
        self._commit_records(
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
            ],
            "Add prescreen records",
        )

        create_response = _request(
            "create_managed_review_task",
            self.project_id,
            self.base_path,
            kind="prescreen",
            reviewer_logins=["alice", "bob"],
            created_by="owner",
        )

        assert "error" not in create_response
        task = create_response["result"]["task"]
        launch_ref = create_response["result"]["launch_ref"]
        self._create_local_review_branches(task, launch_ref)

        self.repo.git.checkout(task["reviewers"][0]["branch_name"])
        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": "rev_prescreen_included",
                    "title": "Alpha",
                    "author": "Doe, Jane",
                    "year": "2021",
                    "journal": "Journal A",
                },
                {
                    "ID": "R2",
                    "origin": "import.bib/R2",
                    "status": "rev_prescreen_excluded",
                    "title": "Beta",
                    "author": "Doe, John",
                    "year": "2022",
                    "journal": "Journal B",
                },
            ],
            "Alice decisions",
        )

        current_task_response = _request(
            "get_current_managed_review_task",
            self.project_id,
            self.base_path,
            kind="prescreen",
        )
        assert current_task_response["result"]["task"]["id"] == task["id"]

        self.repo.git.checkout(task["reviewers"][1]["branch_name"])
        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": "rev_prescreen_included",
                    "title": "Alpha",
                    "author": "Doe, Jane",
                    "year": "2021",
                    "journal": "Journal A",
                },
                {
                    "ID": "R2",
                    "origin": "import.bib/R2",
                    "status": "rev_prescreen_included",
                    "title": "Beta",
                    "author": "Doe, John",
                    "year": "2022",
                    "journal": "Journal B",
                },
            ],
            "Bob decisions",
        )

        self.repo.git.checkout("dev")

        preview_response = _request(
            "get_reconciliation_preview",
            self.project_id,
            self.base_path,
            task_id=task["id"],
        )
        preview = preview_response["result"]
        assert preview["summary"]["auto_resolved_count"] == 1
        assert preview["summary"]["manual_conflict_count"] == 1

        apply_response = _request(
            "apply_reconciliation",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            resolved_by="owner",
            resolutions=[{"record_id": "R2", "selected_reviewer": "reviewer_b"}],
        )
        assert "error" not in apply_response

        review_manager = colrev.review_manager.ReviewManager(path_str=str(self.test_dir))
        review_manager.get_prescreen_operation(notify_state_transition_operation=False)
        records = review_manager.dataset.load_records_dict()
        assert records["R1"]["colrev_status"].name == "rev_prescreen_included"
        assert records["R2"]["colrev_status"].name == "rev_prescreen_included"

        csv_export = _request(
            "export_reconciliation_audit",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            format="csv",
        )
        json_export = _request(
            "export_reconciliation_audit",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            format="json",
        )
        assert "record_id" in csv_export["result"]["content"]
        assert '"task_id"' in json_export["result"]["content"]

    def test_screen_task_reconciliation_uses_criteria(self):
        criterion_response = _request(
            "add_screening_criterion",
            self.project_id,
            self.base_path,
            name="topic",
            explanation="Topic alignment",
            criterion_type="inclusion_criterion",
        )
        assert "error" not in criterion_response
        self.repo.git.push()

        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": "pdf_prepared",
                    "title": "Gamma",
                    "author": "Doe, Jane",
                    "year": "2023",
                    "journal": "Journal A",
                    "file": "data/pdfs/R1.pdf",
                },
            ],
            "Add screen-ready record",
        )

        create_response = _request(
            "create_managed_review_task",
            self.project_id,
            self.base_path,
            kind="screen",
            reviewer_logins=["alice", "bob"],
            created_by="owner",
        )
        task = create_response["result"]["task"]
        launch_ref = create_response["result"]["launch_ref"]
        self._create_local_review_branches(task, launch_ref)

        self.repo.git.checkout(task["reviewers"][0]["branch_name"])
        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": "rev_included",
                    "title": "Gamma",
                    "author": "Doe, Jane",
                    "year": "2023",
                    "journal": "Journal A",
                    "file": "data/pdfs/R1.pdf",
                    "screening_criteria": "topic=in",
                },
            ],
            "Alice screen decision",
        )

        self.repo.git.checkout(task["reviewers"][1]["branch_name"])
        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": "rev_excluded",
                    "title": "Gamma",
                    "author": "Doe, Jane",
                    "year": "2023",
                    "journal": "Journal A",
                    "file": "data/pdfs/R1.pdf",
                    "screening_criteria": "topic=out",
                },
            ],
            "Bob screen decision",
        )

        self.repo.git.checkout("dev")
        preview_response = _request(
            "get_reconciliation_preview",
            self.project_id,
            self.base_path,
            task_id=task["id"],
        )
        preview = preview_response["result"]
        assert preview["summary"]["manual_conflict_count"] == 1
        assert preview["items"][0]["reviewers"][0]["criteria_string"] == "topic=in"
        assert preview["items"][0]["reviewers"][1]["criteria_string"] == "topic=out"

        _request(
            "apply_reconciliation",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            resolved_by="owner",
            resolutions=[{"record_id": "R1", "selected_reviewer": "reviewer_b"}],
        )

        review_manager = colrev.review_manager.ReviewManager(path_str=str(self.test_dir))
        review_manager.get_screen_operation(notify_state_transition_operation=False)
        records = review_manager.dataset.load_records_dict()
        assert records["R1"]["colrev_status"].name == "rev_excluded"
        assert records["R1"]["screening_criteria"] == "topic=out"

    def _prepare_screen_conflict(
        self,
        *,
        reviewer_a_criteria: str,
        reviewer_a_status: str,
        reviewer_b_criteria: str,
        reviewer_b_status: str,
        extra_criteria: list[tuple[str, str, str]] = (),
    ) -> dict:
        for name, explanation, criterion_type in [
            ("topic", "Topic alignment", "inclusion_criterion"),
            ("method", "Method acceptable", "inclusion_criterion"),
            *extra_criteria,
        ]:
            resp = _request(
                "add_screening_criterion",
                self.project_id,
                self.base_path,
                name=name,
                explanation=explanation,
                criterion_type=criterion_type,
            )
            assert "error" not in resp
        self.repo.git.push()

        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": "pdf_prepared",
                    "title": "Gamma",
                    "author": "Doe, Jane",
                    "year": "2023",
                    "journal": "Journal A",
                    "file": "data/pdfs/R1.pdf",
                },
            ],
            "Add screen-ready record",
        )

        create_response = _request(
            "create_managed_review_task",
            self.project_id,
            self.base_path,
            kind="screen",
            reviewer_logins=["alice", "bob"],
            created_by="owner",
        )
        task = create_response["result"]["task"]
        launch_ref = create_response["result"]["launch_ref"]
        self._create_local_review_branches(task, launch_ref)

        self.repo.git.checkout(task["reviewers"][0]["branch_name"])
        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": reviewer_a_status,
                    "title": "Gamma",
                    "author": "Doe, Jane",
                    "year": "2023",
                    "journal": "Journal A",
                    "file": "data/pdfs/R1.pdf",
                    "screening_criteria": reviewer_a_criteria,
                },
            ],
            "Alice screen decision",
        )
        self.repo.git.checkout(task["reviewers"][1]["branch_name"])
        self._commit_records(
            [
                {
                    "ID": "R1",
                    "origin": "import.bib/R1",
                    "status": reviewer_b_status,
                    "title": "Gamma",
                    "author": "Doe, Jane",
                    "year": "2023",
                    "journal": "Journal A",
                    "file": "data/pdfs/R1.pdf",
                    "screening_criteria": reviewer_b_criteria,
                },
            ],
            "Bob screen decision",
        )
        self.repo.git.checkout("dev")
        return task

    def test_screen_reconciliation_accepts_custom_criteria_string(self):
        task = self._prepare_screen_conflict(
            reviewer_a_criteria="topic=in;method=in",
            reviewer_a_status="rev_included",
            reviewer_b_criteria="topic=out;method=in",
            reviewer_b_status="rev_excluded",
        )

        apply_response = _request(
            "apply_reconciliation",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            resolved_by="owner",
            resolutions=[
                {
                    "record_id": "R1",
                    "resolved_status": "rev_included",
                    "resolved_criteria_string": "method=in;topic=in",
                }
            ],
        )
        assert "error" not in apply_response

        review_manager = colrev.review_manager.ReviewManager(path_str=str(self.test_dir))
        review_manager.get_screen_operation(notify_state_transition_operation=False)
        records = review_manager.dataset.load_records_dict()
        assert records["R1"]["colrev_status"].name == "rev_included"
        assert records["R1"]["screening_criteria"] == "method=in;topic=in"

        audit_json = _request(
            "export_reconciliation_audit",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            format="json",
        )
        assert '"resolution_type": "manual_custom"' in audit_json["result"]["content"]

    def test_screen_reconciliation_rejects_invalid_resolved_status(self):
        task = self._prepare_screen_conflict(
            reviewer_a_criteria="topic=in;method=in",
            reviewer_a_status="rev_included",
            reviewer_b_criteria="topic=in;method=out",
            reviewer_b_status="rev_excluded",
        )

        apply_response = _request(
            "apply_reconciliation",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            resolved_by="owner",
            resolutions=[
                {
                    "record_id": "R1",
                    "resolved_status": "bogus_state",
                    "resolved_criteria_string": "topic=in;method=in",
                }
            ],
        )
        assert "error" in apply_response

    def test_screen_reconciliation_custom_override_flips_to_exclude(self):
        # Reviewer A included; reviewer B excluded via a different criterion.
        # Admin picks a third combination — excludes via offtopic — which
        # matches neither reviewer's submitted criteria string.
        task = self._prepare_screen_conflict(
            reviewer_a_criteria="topic=in;method=in;offtopic=in",
            reviewer_a_status="rev_included",
            reviewer_b_criteria="topic=in;method=out;offtopic=in",
            reviewer_b_status="rev_excluded",
            extra_criteria=[("offtopic", "Off-topic", "exclusion_criterion")],
        )

        apply_response = _request(
            "apply_reconciliation",
            self.project_id,
            self.base_path,
            task_id=task["id"],
            resolved_by="owner",
            resolutions=[
                {
                    "record_id": "R1",
                    "resolved_status": "rev_excluded",
                    "resolved_criteria_string": "topic=in;method=in;offtopic=out",
                }
            ],
        )
        assert "error" not in apply_response

        review_manager = colrev.review_manager.ReviewManager(path_str=str(self.test_dir))
        review_manager.get_screen_operation(notify_state_transition_operation=False)
        records = review_manager.dataset.load_records_dict()
        assert records["R1"]["colrev_status"].name == "rev_excluded"
        assert "offtopic=out" in records["R1"]["screening_criteria"]
