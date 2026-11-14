#!/usr/bin/env python
"""Tests for the data-extraction configuration endpoints (WP-08 §3).

The structured-data endpoint is what turns "included papers" into an
extraction table. Its configuration lives in ``settings.json`` and is written
through ``configure_structured_endpoint``; the data page then renders whatever
``get_data_extraction_queue`` reports. Neither had a test.

``save_data_extraction`` is covered at the bottom (records at ``rev_included``);
``export_data_csv`` / ``data`` are covered by the Playwright pipeline instead —
see ``HAPPY_PATH_GAPS`` in ``test_zz_method_coverage.py``.
"""
from __future__ import annotations

import csv
import json
import os
import subprocess
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


class _DataProject:
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


class TestStructuredDataConfiguration(_DataProject):

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


def _records_bib(ids: list[str]) -> str:
    return "\n\n".join(
        f"@article{{{rid},\n"
        f"   colrev_origin = {{import.bib/{rid}}},\n"
        f"   colrev_status = {{rev_included}},\n"
        f"   title = {{Title {rid}}},\n"
        f"   author = {{Doe, Jane}},\n"
        f"   year = {{2023}},\n"
        f"   journal = {{Journal A}},\n"
        "}"
        for rid in ids
    ) + "\n"


class TestExtractionDataIntegrity(_DataProject):
    """Reads must not write, and values the user typed must survive."""

    IDS = ["R1", "R2"]
    NA_FIELDS = [
        {"name": "sample_size", "explanation": "n"},
        {"name": "note", "explanation": "free text", "optional": True},
    ]

    def _git(self, *args: str) -> str:
        return subprocess.run(
            ["git", *args],
            cwd=self.project_path,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def _commit_all(self) -> None:
        self._git("add", "-A")
        self._git(
            "-c", "user.name=t", "-c", "user.email=t@example.com",
            "commit", "-q", "-m", "snapshot", "--allow-empty",
        )

    def _include_records(self) -> None:
        (self.project_path / "data").mkdir(exist_ok=True)
        (self.project_path / "data" / "records.bib").write_text(
            _records_bib(self.IDS)
        )
        self._commit_all()

    def _csv_rows(self) -> dict[str, dict[str, str]]:
        path = self.project_path / "data" / "data" / "data.csv"
        with path.open(newline="", encoding="utf-8") as fh:
            return {row["ID"]: row for row in csv.DictReader(fh)}

    def _queue_values(self) -> dict[str, dict[str, str]]:
        result = self._call("get_data_extraction_queue")["result"]
        return {r["id"]: r["extraction_values"] for r in result["records"]}

    def test_loading_the_queue_leaves_git_status_unchanged(self) -> None:
        self._include_records()
        assert "error" not in self._call(
            "configure_structured_endpoint", fields=self.NA_FIELDS
        )
        csv_path = self.project_path / "data" / "data" / "data.csv"
        csv_path.unlink()
        self._commit_all()
        before = self._git("status", "--porcelain")
        assert before == ""

        values = self._queue_values()

        # Rows for the included records are reported ...
        assert set(values) == set(self.IDS)
        assert values["R1"]["sample_size"] == "TODO"
        # ... without anything being written, staged or created.
        assert self._git("status", "--porcelain") == before
        assert not csv_path.exists()

    def test_the_queue_is_not_declared_a_writer(self) -> None:
        from colrev.ui_jsonrpc.framework import registry

        assert registry.get("get_data_extraction_queue").writes is False

    def test_configure_stages_the_csv_it_creates(self) -> None:
        self._include_records()
        self._call("configure_structured_endpoint", fields=self.NA_FIELDS)

        status = self._git("status", "--porcelain")
        assert "data/data/data.csv" in status
        # Staged, not left as an unstaged change to a tracked file.
        assert all(
            line[1] == " " for line in status.splitlines() if "data.csv" in line
        )

    def test_na_values_round_trip_and_survive_another_records_save(self) -> None:
        self._include_records()
        self._call("configure_structured_endpoint", fields=self.NA_FIELDS)

        for rid, value in (("R1", "NA"), ("R2", "N/A")):
            response = self._call(
                "save_data_extraction",
                record_id=rid,
                values={"sample_size": value, "note": ""},
            )
            assert "error" not in response, response

        values = self._queue_values()
        assert values["R1"] == {"sample_size": "NA", "note": ""}
        assert values["R2"] == {"sample_size": "N/A", "note": ""}

        # Saving R2 again must not erase R1's "NA" (nor turn blanks into nan).
        self._call(
            "save_data_extraction",
            record_id="R2",
            values={"sample_size": "None", "note": "null"},
        )
        rows = self._csv_rows()
        assert rows["R1"]["sample_size"] == "NA"
        assert rows["R1"]["note"] == ""
        assert rows["R2"] == {"ID": "R2", "sample_size": "None", "note": "null"}

    def test_renaming_a_field_keeps_its_values(self) -> None:
        self._include_records()
        self._call("configure_structured_endpoint", fields=self.NA_FIELDS)
        self._call(
            "save_data_extraction",
            record_id="R1",
            values={"sample_size": "120", "note": "x"},
        )

        self._call(
            "configure_structured_endpoint",
            fields=[
                {"name": "n_participants", "previous_name": "sample_size"},
                {"name": "note", "optional": True},
            ],
        )

        rows = self._csv_rows()
        assert rows["R1"]["n_participants"] == "120"
        assert rows["R1"]["note"] == "x"
        assert rows["R2"]["n_participants"] == "TODO"
        assert "sample_size" not in rows["R1"]

    def test_removing_a_field_keeps_its_values(self) -> None:
        self._include_records()
        self._call("configure_structured_endpoint", fields=self.NA_FIELDS)
        self._call(
            "save_data_extraction",
            record_id="R1",
            values={"sample_size": "120", "note": "keep me"},
        )

        self._call("configure_structured_endpoint", fields=[{"name": "sample_size"}])
        assert self._csv_rows()["R1"]["note"] == "keep me"
        # The removed field is not part of the extraction any more ...
        fields = self._call("get_data_extraction_queue")["result"]["fields"]
        assert [f["name"] for f in fields] == ["sample_size"]

        # ... and re-adding it brings the values back.
        self._call(
            "configure_structured_endpoint",
            fields=[{"name": "sample_size"}, {"name": "note", "optional": True}],
        )
        assert self._queue_values()["R1"]["note"] == "keep me"
