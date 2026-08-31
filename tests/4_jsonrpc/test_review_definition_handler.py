#!/usr/bin/env python
"""Tests for the review-definition endpoints (WP-08 §3).

The review definition is the project's protocol: keywords, objectives and the
screening criteria every screen decision is recorded against. It is edited
through five RPCs that all write ``settings.json``, and it had no handler
tests. The properties that matter are round-tripping (what you write is what
the next read returns) and that criterion edits are addressed by name, so a
rename or a bad type can't silently drop a criterion that decisions already
reference.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "definition_project"


def _request(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def base_path(tmp_path_factory, session_mocker) -> Generator[Path, None, None]:
    """One initialized project for the module — `colrev init` is not cheap."""
    root = tmp_path_factory.mktemp("definition_projects")
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

    yield root


@pytest.fixture
def params(base_path: Path) -> dict:
    return {"project_id": PROJECT_ID, "base_path": str(base_path)}


class TestReviewDefinition:
    def test_reports_the_projects_definition(self, handler, params) -> None:
        result = _request(handler, "get_review_definition", params)["result"]

        assert result["project_id"] == PROJECT_ID
        assert result["review_type"]
        assert isinstance(result["keywords"], list)
        assert isinstance(result["criteria"], dict)

    def test_round_trips_protocol_keywords_and_objectives(self, handler, params) -> None:
        update = _request(
            handler,
            "update_review_definition",
            {
                **params,
                "protocol_url": "https://osf.io/abc",
                "keywords": ["sotatercept", "pah"],
                "objectives": "Assess efficacy.",
            },
        )["result"]
        assert sorted(update["details"]["updated_fields"]) == [
            "keywords",
            "objectives",
            "protocol_url",
        ]

        after = _request(handler, "get_review_definition", params)["result"]
        assert after["protocol_url"] == "https://osf.io/abc"
        assert after["keywords"] == ["sotatercept", "pah"]
        assert after["objectives"] == "Assess efficacy."

    def test_omitted_fields_are_left_alone(self, handler, params) -> None:
        _request(
            handler,
            "update_review_definition",
            {**params, "keywords": ["only-this"], "objectives": "keep me"},
        )
        _request(handler, "update_review_definition", {**params, "keywords": ["changed"]})

        after = _request(handler, "get_review_definition", params)["result"]
        assert after["keywords"] == ["changed"]
        # A partial update must not blank the fields it didn't mention.
        assert after["objectives"] == "keep me"


class TestScreeningCriteria:
    def test_add_then_read_back_a_criterion(self, handler, params) -> None:
        _request(
            handler,
            "add_screening_criterion",
            {
                **params,
                "name": "adult_population",
                "explanation": "Adults only",
                "criterion_type": "inclusion_criterion",
            },
        )

        criteria = _request(handler, "get_screening_criteria", params)["result"]["criteria"]
        assert "adult_population" in criteria
        assert criteria["adult_population"]["explanation"] == "Adults only"

    def test_the_definition_and_the_criteria_endpoints_agree(self, handler, params) -> None:
        _request(
            handler,
            "add_screening_criterion",
            {
                **params,
                "name": "english_only",
                "explanation": "English language",
                "criterion_type": "exclusion_criterion",
            },
        )

        from_criteria = _request(handler, "get_screening_criteria", params)["result"][
            "criteria"
        ]
        from_definition = _request(handler, "get_review_definition", params)["result"][
            "criteria"
        ]
        # Two endpoints, one source of truth — the screen page reads one and
        # the definition page the other.
        assert from_criteria == from_definition

    def test_update_edits_in_place(self, handler, params) -> None:
        _request(
            handler,
            "add_screening_criterion",
            {
                **params,
                "name": "sample_size",
                "explanation": "n > 10",
                "criterion_type": "inclusion_criterion",
            },
        )
        _request(
            handler,
            "update_screening_criterion",
            {**params, "criterion_name": "sample_size", "explanation": "n > 100"},
        )

        criteria = _request(handler, "get_screening_criteria", params)["result"]["criteria"]
        assert criteria["sample_size"]["explanation"] == "n > 100"

    def test_remove_deletes_only_the_named_criterion(self, handler, params) -> None:
        for name in ("doomed", "survivor"):
            _request(
                handler,
                "add_screening_criterion",
                {
                    **params,
                    "name": name,
                    "explanation": name,
                    "criterion_type": "inclusion_criterion",
                },
            )

        _request(
            handler, "remove_screening_criterion", {**params, "criterion_name": "doomed"}
        )

        criteria = _request(handler, "get_screening_criteria", params)["result"]["criteria"]
        assert "doomed" not in criteria
        assert "survivor" in criteria

    def test_rejects_an_unknown_criterion_type(self, handler, params) -> None:
        response = _request(
            handler,
            "add_screening_criterion",
            {
                **params,
                "name": "bad_type",
                "explanation": "x",
                "criterion_type": "not_a_type",
            },
        )
        assert "error" in response

        criteria = _request(handler, "get_screening_criteria", params)["result"]["criteria"]
        assert "bad_type" not in criteria

    def test_reports_an_unknown_criterion_on_update_and_remove(self, handler, params) -> None:
        assert "error" in _request(
            handler,
            "update_screening_criterion",
            {**params, "criterion_name": "never_added", "explanation": "x"},
        )
        assert "error" in _request(
            handler, "remove_screening_criterion", {**params, "criterion_name": "never_added"}
        )
