#!/usr/bin/env python
"""Tests for the load endpoint (WP-08 §3).

``load`` is the first RPC that mutates ``data/records.bib``: it turns an
uploaded search file into records with CoLRev origins and states. Everything
downstream (prep, dedupe, prescreen) assumes it did that correctly, and it had
no handler test — the only coverage was the Playwright pipeline.

The fixtures here go through the RPC surface (``upload_search_file`` → into
``load``) rather than writing files directly, so the test exercises the same
path the UI does.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "load_project"

RIS_TWO_RECORDS = """TY  - JOUR
TI  - Machine learning applications in healthcare
AU  - Smith, John
PY  - 2023
JF  - Journal of Medical Informatics
DO  - 10.1234/jmi.2023.001
ER  -

TY  - JOUR
TI  - Deep learning for medical image analysis
AU  - Brown, Alice
PY  - 2023
JF  - Medical Imaging Research
DO  - 10.1234/mir.2023.002
ER  -
"""


def _request(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def base_path(tmp_path_factory, session_mocker) -> Generator[Path, None, None]:
    root = tmp_path_factory.mktemp("load_projects")
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


@pytest.fixture(scope="module")
def params(base_path: Path) -> dict:
    return {"project_id": PROJECT_ID, "base_path": str(base_path)}


@pytest.fixture(scope="module")
def loaded(handler, base_path, params) -> dict:
    """Upload a two-record search file, register it, and load it.

    Uploading alone is not enough: ``load`` only reads files that a search
    source points at, so the UI's flow is upload → add_source → load. Runs
    once for the module.
    """
    upload = _request(
        handler,
        "upload_search_file",
        {**params, "filename": "manual_search.ris", "content": RIS_TWO_RECORDS},
    )
    assert "error" not in upload, upload.get("error")

    added = _request(
        handler,
        "add_source",
        {
            **params,
            "endpoint": "colrev.unknown_source",
            "search_type": "DB",
            "filename": "data/search/manual_search.ris",
        },
    )
    assert "error" not in added, added.get("error")

    response = _request(handler, "load", params)
    assert "error" not in response, response.get("error")
    return response["result"]


class TestLoad:
    def test_reports_the_operation_it_ran(self, loaded) -> None:
        assert loaded["operation"] == "load"
        assert loaded["project_id"] == PROJECT_ID

    def test_writes_the_uploaded_records_into_the_dataset(
        self, loaded, base_path
    ) -> None:
        records_bib = base_path / PROJECT_ID / "data" / "records.bib"
        assert records_bib.exists(), "load produced no records.bib"

        content = records_bib.read_text()
        assert "Machine learning applications in healthcare" in content
        assert "Deep learning for medical image analysis" in content

    def test_records_carry_an_origin_and_a_state(self, loaded, base_path) -> None:
        content = (base_path / PROJECT_ID / "data" / "records.bib").read_text()
        # Origins are how every later operation traces a record back to its
        # search file; a record without one breaks dedupe and validation.
        assert "colrev_origin" in content
        assert "colrev_status" in content
        assert content.count("colrev_origin") == 2

    def test_the_records_are_visible_through_get_records(
        self, handler, loaded, params
    ) -> None:
        result = _request(handler, "get_records", params)["result"]
        titles = {r.get("title") for r in result["records"]}
        assert "Machine learning applications in healthcare" in titles

    def test_status_counts_the_loaded_records(self, handler, loaded, params) -> None:
        status = _request(handler, "get_status", params)["result"]["status"]
        assert status["total_records"] == 2

    def test_loading_again_with_nothing_new_is_not_an_error(
        self, handler, loaded, params
    ) -> None:
        # The UI's "Load" button stays clickable; a no-op re-run must not
        # look like a failure or duplicate the records.
        response = _request(handler, "load", params)
        assert "error" not in response, response.get("error")

        content = (Path(params["base_path"]) / PROJECT_ID / "data" / "records.bib").read_text()
        assert content.count("colrev_origin") == 2
