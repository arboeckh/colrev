#!/usr/bin/env python
"""Tests for the data-extraction configuration endpoints (WP-08 §3).

The structured-data endpoint is what turns "included papers" into an
extraction table. Its configuration lives in ``settings.json`` and is written
through ``configure_structured_endpoint``; the data page then renders whatever
``get_data_extraction_queue`` reports. Neither had a test.

Running the extraction itself (``save_data_extraction`` / ``export_data_csv``
/ ``data``) needs records at ``rev_included`` plus the data operation's
package chain, and is covered by the Playwright pipeline instead — see
``HAPPY_PATH_GAPS`` in ``test_zz_method_coverage.py``.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Generator

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "data_project"

FIELDS = [
    {"name": "sample_size", "explanation": "Participants", "data_type": "int"},
    {
        "name": "study_design",
        "explanation": "Design",
        "data_type": "select",
        "options": ["rct", "cohort"],
    },
]


def _request(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


class TestStructuredDataConfiguration:
    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker) -> Generator[None, None, None]:
        self.project_path = tmp_path / PROJECT_ID
        self.project_path.mkdir()
        self.handler = JSONRPCHandler()
        self.params = {"project_id": PROJECT_ID, "base_path": str(tmp_path)}

        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )
        mocker.patch.object(
            colrev.constants.Filepaths, "REGISTRY_FILE", self.project_path / "reg.json"
        )

        original_cwd = os.getcwd()
        os.chdir(self.project_path)
        try:
            colrev.ops.init.Initializer(
                review_type="literature_review",
                target_path=self.project_path,
                light=True,
            )
        finally:
            os.chdir(original_cwd)

        yield

    def _call(self, method: str, **kwargs) -> dict:
        return _request(self.handler, method, {**self.params, **kwargs})

    def _settings(self) -> dict:
        return json.loads((self.project_path / "settings.json").read_text())

    def test_queue_reports_unconfigured_before_any_setup(self) -> None:
        result = self._call("get_data_extraction_queue")["result"]

        # The data page renders a setup prompt off this flag rather than an
        # empty table.
        assert result["configured"] is False
        assert result["fields"] == []
        assert result["total_count"] == 0

    def test_configure_writes_the_fields_into_settings(self) -> None:
        result = self._call("configure_structured_endpoint", fields=FIELDS)["result"]

        assert [f["name"] for f in result["fields"]] == ["sample_size", "study_design"]

        endpoints = self._settings()["data"]["data_package_endpoints"]
        structured = [e for e in endpoints if e.get("endpoint") == "colrev.structured"]
        assert structured, "no colrev.structured endpoint was registered"
        assert [f["name"] for f in structured[0]["fields"]] == [
            "sample_size",
            "study_design",
        ]

    def test_the_queue_reflects_the_configured_fields(self) -> None:
        self._call("configure_structured_endpoint", fields=FIELDS)

        result = self._call("get_data_extraction_queue")["result"]

        assert result["configured"] is True
        assert [f["name"] for f in result["fields"]] == ["sample_size", "study_design"]

    def test_select_options_survive_the_round_trip(self) -> None:
        self._call("configure_structured_endpoint", fields=FIELDS)

        fields = self._call("get_data_extraction_queue")["result"]["fields"]
        design = next(f for f in fields if f["name"] == "study_design")
        # Without the options the UI cannot render the select at all.
        assert design["options"] == ["rct", "cohort"]

    def test_reconfiguring_replaces_the_field_set(self) -> None:
        self._call("configure_structured_endpoint", fields=FIELDS)
        self._call(
            "configure_structured_endpoint",
            fields=[{"name": "outcome", "explanation": "Primary outcome"}],
        )

        fields = self._call("get_data_extraction_queue")["result"]["fields"]
        assert [f["name"] for f in fields] == ["outcome"]

    def test_rejects_an_unknown_data_type(self) -> None:
        response = self._call(
            "configure_structured_endpoint",
            fields=[{"name": "x", "data_type": "not_a_type"}],
        )
        assert "error" in response

        # A rejected configuration must not half-apply.
        assert self._call("get_data_extraction_queue")["result"]["configured"] is False

    def test_rejects_an_empty_field_list(self) -> None:
        assert "error" in self._call("configure_structured_endpoint", fields=[])

    def test_rejects_a_field_without_a_name(self) -> None:
        assert "error" in self._call(
            "configure_structured_endpoint", fields=[{"name": "", "explanation": "x"}]
        )

    def test_export_reports_a_missing_configuration(self) -> None:
        response = self._call("export_data_csv")
        assert "error" in response

    def test_save_reports_a_missing_configuration(self) -> None:
        response = self._call("save_data_extraction", record_id="R1", values={"a": "b"})
        assert "error" in response
