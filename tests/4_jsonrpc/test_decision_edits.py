#!/usr/bin/env python
"""Decision-editing RPCs: update_prescreen_decisions, update_screen_decisions,
include_all_screen.

These are the endpoints behind "flip a decision I already made" in the
prescreen/screen review tables, plus the "include all" shortcut. They edit
``colrev_status`` in ``data/records.bib`` through the engine's prescreen/screen
operations, so every assertion here reads the dataset back from disk.

One project, seeded once for the module: ``colrev init`` dominates runtime,
and each record here belongs to exactly one test's scenario. Tests run in
definition order; ``include_all_screen`` runs last because it commits the
whole records file.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

import git
import pytest

import colrev.constants
import colrev.ops.init
import colrev.review_manager
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "decision_edits_project"

RECORDS = [
    # Prescreen-decision records (already decided; the tests flip them).
    {"ID": "P1", "status": "rev_prescreen_included"},
    {"ID": "P2", "status": "rev_prescreen_excluded"},
    # Screen-decision records (already decided; the tests flip them).
    {"ID": "S1", "status": "rev_included", "file": "data/pdfs/S1.pdf"},
    {"ID": "S2", "status": "rev_excluded", "file": "data/pdfs/S2.pdf"},
    # Screen-queue records for include_all_screen.
    {"ID": "A1", "status": "pdf_prepared", "file": "data/pdfs/A1.pdf"},
    {"ID": "A2", "status": "pdf_prepared", "file": "data/pdfs/A2.pdf"},
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
        ]
        if "file" in entry:
            lines.append(f"   file                          = {{{entry['file']}}},")
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
    root = tmp_path_factory.mktemp("decision_edit_projects")
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
    # --no-verify: the check hook runs data.main(), which would advance
    # rev_included records to rev_synthesized before the tests see them.
    repo.git.commit("-m", "Seed decided and screen-ready records", "--no-verify")

    yield root


@pytest.fixture
def params(project: Path) -> dict:
    return {"project_id": PROJECT_ID, "base_path": str(project)}


def _statuses_on_disk(project: Path) -> dict[str, str]:
    """Read colrev_status per record from data/records.bib via the engine."""
    review_manager = colrev.review_manager.ReviewManager(
        path_str=str(project / PROJECT_ID)
    )
    review_manager.get_prescreen_operation(notify_state_transition_operation=False)
    records = review_manager.dataset.load_records_dict()
    return {rid: rec["colrev_status"].name for rid, rec in records.items()}


class TestUpdatePrescreenDecisions:
    def test_flips_both_directions_and_persists_to_records_bib(
        self, handler, params, project
    ) -> None:
        response = _request(
            handler,
            "update_prescreen_decisions",
            {
                **params,
                "changes": [
                    {"record_id": "P1", "decision": "exclude"},
                    {"record_id": "P2", "decision": "include"},
                ],
            },
        )
        assert "error" not in response, response.get("error")
        result = response["result"]

        assert result["changes_count"] == 2
        assert set(result["updated_records"]) == {"P1", "P2"}
        assert result["skipped"] == []

        statuses = _statuses_on_disk(project)
        assert statuses["P1"] == "rev_prescreen_excluded"
        assert statuses["P2"] == "rev_prescreen_included"

    def test_reapplying_the_current_decision_is_a_no_op(
        self, handler, params, project
    ) -> None:
        response = _request(
            handler,
            "update_prescreen_decisions",
            {**params, "changes": [{"record_id": "P2", "decision": "include"}]},
        )
        assert "error" not in response, response.get("error")

        assert response["result"]["changes_count"] == 0
        assert response["result"]["skipped"] == []
        assert _statuses_on_disk(project)["P2"] == "rev_prescreen_included"

    def test_skips_unknown_records_and_records_in_the_wrong_state(
        self, handler, params, project
    ) -> None:
        response = _request(
            handler,
            "update_prescreen_decisions",
            {
                **params,
                "changes": [
                    {"record_id": "NOPE", "decision": "include"},
                    # A1 is pdf_prepared — past the prescreen, not editable here.
                    {"record_id": "A1", "decision": "include"},
                ],
            },
        )
        assert "error" not in response, response.get("error")
        result = response["result"]

        assert result["changes_count"] == 0
        reasons = {s["record_id"]: s["reason"] for s in result["skipped"]}
        assert reasons["NOPE"] == "Record not found"
        assert "Invalid state" in reasons["A1"]
        assert _statuses_on_disk(project)["A1"] == "pdf_prepared"

    def test_rejects_an_invalid_decision(self, handler, params) -> None:
        response = _request(
            handler,
            "update_prescreen_decisions",
            {**params, "changes": [{"record_id": "P1", "decision": "maybe"}]},
        )
        assert "error" in response

    def test_rejects_an_empty_change_list(self, handler, params) -> None:
        response = _request(
            handler, "update_prescreen_decisions", {**params, "changes": []}
        )
        assert "error" in response


class TestUpdateScreenDecisions:
    def test_flips_both_directions_and_persists_to_records_bib(
        self, handler, params, project
    ) -> None:
        response = _request(
            handler,
            "update_screen_decisions",
            {
                **params,
                "changes": [
                    {"record_id": "S1", "decision": "exclude"},
                    {"record_id": "S2", "decision": "include"},
                ],
            },
        )
        assert "error" not in response, response.get("error")
        result = response["result"]

        assert result["changes_count"] == 2
        assert set(result["updated_records"]) == {"S1", "S2"}
        assert result["skipped"] == []

        statuses = _statuses_on_disk(project)
        assert statuses["S1"] == "rev_excluded"
        assert statuses["S2"] == "rev_included"

    def test_skips_unknown_records_and_records_in_the_wrong_state(
        self, handler, params, project
    ) -> None:
        response = _request(
            handler,
            "update_screen_decisions",
            {
                **params,
                "changes": [
                    {"record_id": "NOPE", "decision": "exclude"},
                    # P1 holds a prescreen decision — not a screen decision.
                    {"record_id": "P1", "decision": "include"},
                ],
            },
        )
        assert "error" not in response, response.get("error")
        result = response["result"]

        assert result["changes_count"] == 0
        reasons = {s["record_id"]: s["reason"] for s in result["skipped"]}
        assert reasons["NOPE"] == "Record not found"
        assert "Invalid state" in reasons["P1"]
        assert _statuses_on_disk(project)["P1"] == "rev_prescreen_excluded"

    def test_rejects_an_invalid_decision(self, handler, params) -> None:
        response = _request(
            handler,
            "update_screen_decisions",
            {**params, "changes": [{"record_id": "S1", "decision": "maybe"}]},
        )
        assert "error" in response


class TestIncludeAllScreen:
    # Runs last: include_all_in_screen saves and commits the whole records
    # file, sweeping up the (intentionally uncommitted) decision edits above.
    def test_moves_every_pdf_prepared_record_to_rev_included(
        self, handler, params, project
    ) -> None:
        before = _statuses_on_disk(project)
        assert before["A1"] == "pdf_prepared"
        assert before["A2"] == "pdf_prepared"

        response = _request(handler, "include_all_screen", params)
        assert "error" not in response, response.get("error")
        assert response["result"]["operation"] == "include_all_screen"

        statuses = _statuses_on_disk(project)
        assert statuses["A1"] == "rev_included"
        assert statuses["A2"] == "rev_included"
        # Records not sitting at pdf_prepared are untouched.
        assert statuses["P1"] == "rev_prescreen_excluded"
        assert statuses["S1"] == "rev_excluded"

        # The operation commits its own result.
        repo = git.Repo(project / PROJECT_ID)
        assert "Screen: include all" in repo.head.commit.message
