#!/usr/bin/env python
"""Editing screening criteria mid-screen must neither block nor corrupt decisions.

The per-record decision RPCs run under a precondition that tolerates only
``data/records.bib`` being dirty. A criterion edit that left ``settings.json``
staged therefore made the next ``screen_record`` fail until the user pressed
Save. The review-definition writers now commit their own change.
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
import colrev.review_manager
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "criteria_while_screening_project"

RECORDS = [
    {"ID": "R1", "status": "pdf_prepared"},
    {"ID": "R2", "status": "pdf_prepared"},
    {"ID": "R3", "status": "pdf_prepared"},
    {"ID": "R4", "status": "pdf_prepared"},
    {"ID": "D1", "status": "rev_excluded", "screening_criteria": "focus=out;method=in"},
]


def _records_bib(entries: list[dict]) -> str:
    blocks = []
    for entry in entries:
        lines = [
            f"@article{{{entry['ID']},",
            f"   colrev_origin                 = {{import.bib/{entry['ID']}}},",
            f"   colrev_status                 = {{{entry['status']}}},",
            f"   title                         = {{Title {entry['ID']}}},",
            "   author                        = {Doe, Jane},",
            "   year                          = {2023},",
            "   journal                       = {Journal A},",
            f"   file                          = {{data/pdfs/{entry['ID']}.pdf}},",
        ]
        if "screening_criteria" in entry:
            lines.append(
                f"   screening_criteria            = {{{entry['screening_criteria']}}},"
            )
        lines.append("}")
        blocks.append("\n".join(lines))
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
    root = tmp_path_factory.mktemp("criteria_while_screening")
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

    settings_path = project_path / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    settings["screen"]["criteria"] = {
        name: {
            "explanation": name,
            "comment": "",
            "criterion_type": "inclusion_criterion",
        }
        for name in ("focus", "method")
    }
    settings_path.write_text(json.dumps(settings, indent=4), encoding="utf-8")

    records_path = project_path / "data" / "records.bib"
    records_path.parent.mkdir(parents=True, exist_ok=True)
    records_path.write_text(_records_bib(RECORDS), encoding="utf-8")
    repo = git.Repo(project_path)
    repo.git.add(["data/records.bib", "settings.json"])
    repo.git.commit("-m", "Seed screen-ready records", "--no-verify")

    yield root


@pytest.fixture
def params(project: Path) -> dict:
    return {"project_id": PROJECT_ID, "base_path": str(project)}


def _records_on_disk(project: Path) -> dict:
    review_manager = colrev.review_manager.ReviewManager(
        path_str=str(project / PROJECT_ID)
    )
    review_manager.get_prescreen_operation(notify_state_transition_operation=False)
    return review_manager.dataset.load_records_dict()


def _add_criterion(handler, params, name: str) -> dict:
    return _request(
        handler,
        "add_screening_criterion",
        {
            **params,
            "name": name,
            "explanation": name,
            "criterion_type": "inclusion_criterion",
        },
    )


class TestCriterionEditsDoNotBlockDecisions:
    def test_screen_record_succeeds_right_after_adding_a_criterion(
        self, handler, params, project
    ) -> None:
        added = _add_criterion(handler, params, "language")
        assert "error" not in added, added.get("error")

        # No Save in between: the writer committed its own change.
        repo = git.Repo(project / PROJECT_ID)
        assert not repo.git.status("--porcelain", "settings.json").strip()
        assert "language" in repo.head.commit.message

        response = _request(
            handler,
            "screen_record",
            {**params, "record_id": "R1", "decision": "exclude",
             "criteria_decisions": {"focus": "out"}},
        )
        assert "error" not in response, response.get("error")
        assert _records_on_disk(project)["R1"]["colrev_status"].name == "rev_excluded"

    def test_other_writers_leave_a_clean_settings_file_too(
        self, handler, params, project
    ) -> None:
        repo = git.Repo(project / PROJECT_ID)
        steps = [
            ("update_screening_criterion",
             {"criterion_name": "language", "explanation": "English"}),
            ("update_review_definition", {"objectives": "Find things"}),
            ("remove_screening_criterion", {"criterion_name": "language"}),
        ]
        for index, (method, extra) in enumerate(steps):
            response = _request(handler, method, {**params, **extra})
            assert "error" not in response, response.get("error")
            assert not repo.git.status("--porcelain", "settings.json").strip()
            decided = _request(
                handler,
                "screen_record",
                {**params, "record_id": f"R{index + 2}", "decision": "include"},
            )
            assert "error" not in decided, decided.get("error")

    def test_the_settings_commit_does_not_sweep_in_pending_decisions(
        self, handler, params, project
    ) -> None:
        repo = git.Repo(project / PROJECT_ID)
        pending = _records_on_disk(project)["R1"]["colrev_status"].name
        assert pending == "rev_excluded"
        _add_criterion(handler, params, "sweep_check")

        assert "data/records.bib" not in repo.head.commit.stats.files
        assert _records_on_disk(project)["R1"]["colrev_status"].name == "rev_excluded"


class TestCriterionNames:
    @pytest.mark.parametrize("name", ["age >= 18; adults", "a;b", "a=b", ";", "="])
    def test_rejects_names_that_break_the_criteria_string(
        self, handler, params, name
    ) -> None:
        response = _add_criterion(handler, params, name)
        assert "error" in response
        assert "must not contain" in json.dumps(response["error"])

        criteria = _request(handler, "get_screening_criteria", params)["result"][
            "criteria"
        ]
        assert name not in criteria

    def test_rejects_a_blank_name(self, handler, params) -> None:
        assert "error" in _add_criterion(handler, params, "   ")

    def test_accepts_an_ordinary_name_with_spaces_and_punctuation(
        self, handler, params
    ) -> None:
        response = _add_criterion(handler, params, "Adults (18+), humans only")
        assert "error" not in response, response.get("error")


class TestRedecidingWithChangedCriteria:
    def test_unchanged_exclusion_saves_the_new_ticks(
        self, handler, params, project
    ) -> None:
        response = _request(
            handler,
            "screen_record",
            {**params, "record_id": "D1", "decision": "exclude",
             "criteria_decisions": {"focus": "in", "method": "out"}},
        )
        assert "error" not in response, response.get("error")
        assert response["result"]["already_decided"] is True

        record = _records_on_disk(project)["D1"]
        assert record["colrev_status"].name == "rev_excluded"
        assert record["screening_criteria"] == "focus=in;method=out"

    def test_an_exclusion_without_ticks_keeps_the_stored_criteria(
        self, handler, params, project
    ) -> None:
        _request(
            handler,
            "screen_record",
            {**params, "record_id": "D1", "decision": "exclude"},
        )
        record = _records_on_disk(project)["D1"]
        assert record["screening_criteria"] == "focus=in;method=out"
