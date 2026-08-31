#!/usr/bin/env python
"""Tests for the PDF-sharing endpoints (WP-08 §3).

PDFs are deliberately kept out of git, so ``export_pdfs`` / ``import_pdfs``
are how a second reviewer gets the files a colleague retrieved. Both write
outside the repo and both take attacker-shaped input (a zip from another
machine), and neither had a test.

Two properties carry real risk and are pinned here: the zip-slip guard on
import (an entry named ``../../evil.pdf`` must not escape ``data/pdfs``), and
the conflict policy (``skip`` never silently replaces a local file).
"""
from __future__ import annotations

import base64
import os
import zipfile
from pathlib import Path
from typing import Generator

import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.framework_handlers import pdf_share_handler
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "pdf_share_project"
# Imported rather than duplicated: the archive's manifest name is part of the
# interchange format, and a rename must break here, not silently in the field.
MANIFEST_FILENAME = pdf_share_handler.MANIFEST_FILENAME
MINIMAL_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def _request(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


@pytest.fixture(scope="module")
def handler() -> JSONRPCHandler:
    return JSONRPCHandler()


@pytest.fixture(scope="module")
def base_path(tmp_path_factory, session_mocker) -> Generator[Path, None, None]:
    root = tmp_path_factory.mktemp("pdf_share_projects")
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


@pytest.fixture
def pdf_dir(base_path: Path) -> Path:
    directory = base_path / PROJECT_ID / "data" / "pdfs"
    directory.mkdir(parents=True, exist_ok=True)
    for existing in directory.rglob("*"):
        if existing.is_file():
            existing.unlink()
    return directory


class TestExportPDFs:
    def test_packs_every_pdf_plus_a_manifest(self, handler, params, pdf_dir, tmp_path) -> None:
        (pdf_dir / "smith2020.pdf").write_bytes(MINIMAL_PDF)
        (pdf_dir / "jones2021.pdf").write_bytes(MINIMAL_PDF)
        out = tmp_path / "pdfs.zip"

        result = _request(handler, "export_pdfs", {**params, "output_path": str(out)})["result"]

        assert result["file_count"] == 2
        assert result["total_bytes"] == 2 * len(MINIMAL_PDF)
        with zipfile.ZipFile(out) as zf:
            names = set(zf.namelist())
        assert {"smith2020.pdf", "jones2021.pdf", MANIFEST_FILENAME} == names

    def test_exports_an_empty_archive_when_there_are_no_pdfs(
        self, handler, params, pdf_dir, tmp_path
    ) -> None:
        out = tmp_path / "empty.zip"
        result = _request(handler, "export_pdfs", {**params, "output_path": str(out)})["result"]

        assert result["file_count"] == 0
        assert out.exists(), "the UI hands this path to a save dialog; it must exist"

    def test_rejects_an_empty_output_path(self, handler, params) -> None:
        assert "error" in _request(handler, "export_pdfs", {**params, "output_path": ""})


def _make_zip(path: Path, entries: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return path


class TestImportPDFs:
    def test_imports_the_archive_contents(self, handler, params, pdf_dir, tmp_path) -> None:
        archive = _make_zip(tmp_path / "in.zip", {"a.pdf": MINIMAL_PDF, "b.pdf": MINIMAL_PDF})

        result = _request(handler, "import_pdfs", {**params, "zip_path": str(archive)})["result"]

        assert result["imported_count"] == 2
        assert (pdf_dir / "a.pdf").read_bytes() == MINIMAL_PDF

    def test_skip_is_the_default_and_reports_the_conflict(
        self, handler, params, pdf_dir, tmp_path
    ) -> None:
        (pdf_dir / "a.pdf").write_bytes(b"local version")
        archive = _make_zip(tmp_path / "in.zip", {"a.pdf": MINIMAL_PDF})

        result = _request(handler, "import_pdfs", {**params, "zip_path": str(archive)})["result"]

        assert result["skipped_count"] == 1
        assert result["conflicts"] == ["a.pdf"]
        # The local file wins unless the user explicitly chose overwrite.
        assert (pdf_dir / "a.pdf").read_bytes() == b"local version"

    def test_overwrite_replaces_the_local_file(
        self, handler, params, pdf_dir, tmp_path
    ) -> None:
        (pdf_dir / "a.pdf").write_bytes(b"local version")
        archive = _make_zip(tmp_path / "in.zip", {"a.pdf": MINIMAL_PDF})

        result = _request(
            handler,
            "import_pdfs",
            {**params, "zip_path": str(archive), "on_conflict": "overwrite"},
        )["result"]

        assert result["overwritten_count"] == 1
        assert (pdf_dir / "a.pdf").read_bytes() == MINIMAL_PDF

    def test_refuses_entries_that_escape_the_pdf_directory(
        self, handler, params, pdf_dir, tmp_path
    ) -> None:
        archive = _make_zip(
            tmp_path / "evil.zip", {"../../../escaped.pdf": MINIMAL_PDF, "ok.pdf": MINIMAL_PDF}
        )

        result = _request(handler, "import_pdfs", {**params, "zip_path": str(archive)})["result"]

        assert result["imported_count"] == 1
        assert (pdf_dir / "ok.pdf").exists()
        assert not (pdf_dir.parent.parent.parent / "escaped.pdf").exists()

    def test_flags_a_manifest_from_a_different_project(
        self, handler, params, pdf_dir, tmp_path
    ) -> None:
        archive = _make_zip(
            tmp_path / "other.zip",
            {
                MANIFEST_FILENAME: b'{"project_id": "some_other_project"}',
                "a.pdf": MINIMAL_PDF,
            },
        )

        result = _request(handler, "import_pdfs", {**params, "zip_path": str(archive)})["result"]

        # Importing still proceeds, but the UI needs to be able to warn.
        assert result["manifest_mismatch"] is True
        assert result["manifest_project_id"] == "some_other_project"
        assert result["imported_count"] == 1

    def test_reports_a_missing_or_corrupt_archive(self, handler, params, tmp_path) -> None:
        assert "error" in _request(
            handler, "import_pdfs", {**params, "zip_path": str(tmp_path / "nope.zip")}
        )

        not_a_zip = tmp_path / "not.zip"
        not_a_zip.write_text("plain text")
        assert "error" in _request(handler, "import_pdfs", {**params, "zip_path": str(not_a_zip)})


class TestRestorePDFFile:
    def test_reports_an_unknown_record(self, handler, params) -> None:
        response = _request(
            handler,
            "restore_pdf_file",
            {
                **params,
                "record_id": "no_such_record",
                "content": base64.b64encode(MINIMAL_PDF).decode(),
            },
        )
        assert "error" in response
