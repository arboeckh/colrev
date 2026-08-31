#!/usr/bin/env python
"""Tests for the manual PDF-retrieval endpoints (WP-08 §3).

``pdf_get`` itself goes to the network and is covered by the Playwright
pipeline. The endpoints around it are local, are the ones a user hits most
(upload this PDF; I couldn't find this one; undo that), and each moves a
record between states — so getting one wrong silently strands records in the
wrong queue. None of them had a test.

Records are seeded straight into ``data/records.bib`` at
``pdf_needs_manual_retrieval``, which is where the pdf_get_man queue picks
them up.
"""
from __future__ import annotations

import base64
import os
from pathlib import Path

import git
import pytest

import colrev.constants
import colrev.ops.init
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "pdf_get_project"
MINIMAL_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def _records_bib(entries: list[dict]) -> str:
    blocks = []
    for entry in entries:
        blocks.append(
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
    return "\n\n".join(blocks) + "\n"


SEEDED_RECORDS = [
    {
        "ID": "R1",
        "origin": "import.bib/R1",
        "status": "pdf_needs_manual_retrieval",
        "title": "Machine learning in healthcare",
        "author": "Smith, John",
        "year": "2023",
        "journal": "Journal A",
    },
    {
        "ID": "R2",
        "origin": "import.bib/R2",
        "status": "pdf_needs_manual_retrieval",
        "title": "Deep learning for imaging",
        "author": "Brown, Alice",
        "year": "2023",
        "journal": "Journal B",
    },
]


def _request(handler: JSONRPCHandler, method: str, params: dict) -> dict:
    return handler.handle_request(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


class TestManualPDFRetrieval:
    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        self.base_path = tmp_path
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

        records_path = self.project_path / "data" / "records.bib"
        records_path.parent.mkdir(parents=True, exist_ok=True)
        records_path.write_text(_records_bib(SEEDED_RECORDS), encoding="utf-8")

        repo = git.Repo(self.project_path)
        repo.git.add("data/records.bib")
        repo.git.commit("-m", "Seed records awaiting PDFs")

    def _call(self, method: str, **kwargs) -> dict:
        return _request(self.handler, method, {**self.params, **kwargs})

    def _status_of(self, record_id: str) -> str:
        records = self._call("get_records")["result"]["records"]
        return next(r for r in records if r["ID"] == record_id)["colrev_status"]

    # -- upload_pdf ---------------------------------------------------------

    def test_upload_pdf_stores_the_file_and_advances_the_record(self) -> None:
        result = self._call(
            "upload_pdf",
            record_id="R1",
            filename="smith2023.pdf",
            content=base64.b64encode(MINIMAL_PDF).decode(),
        )["result"]

        assert result["record_id"] == "R1"
        assert Path(result["file_path"]).name.endswith(".pdf")
        assert (self.project_path / result["file_path"]).exists()
        # The record leaves the manual-retrieval queue on success.
        assert result["new_status"] != "pdf_needs_manual_retrieval"
        assert self._status_of("R1") != "pdf_needs_manual_retrieval"

    def test_upload_pdf_reports_an_unknown_record(self) -> None:
        response = self._call(
            "upload_pdf",
            record_id="NOPE",
            filename="x.pdf",
            content=base64.b64encode(MINIMAL_PDF).decode(),
        )
        assert "error" in response

    def test_upload_pdf_rejects_empty_content(self) -> None:
        assert "error" in self._call(
            "upload_pdf", record_id="R1", filename="x.pdf", content=""
        )

    # -- mark / undo not-available -----------------------------------------

    def test_mark_not_available_moves_only_that_record(self) -> None:
        result = self._call("mark_pdf_not_available", record_id="R1")["result"]

        assert result["new_status"] == "pdf_not_available"
        assert self._status_of("R1") == "pdf_not_available"
        # R2 is still waiting; a bulk transition here would empty the queue.
        assert self._status_of("R2") == "pdf_needs_manual_retrieval"

    def test_undo_puts_the_record_back_in_the_queue(self) -> None:
        self._call("mark_pdf_not_available", record_id="R1")

        result = self._call("undo_pdf_not_available", record_id="R1")["result"]

        assert result["new_status"] == "pdf_needs_manual_retrieval"
        assert self._status_of("R1") == "pdf_needs_manual_retrieval"

    def test_undo_refuses_a_record_that_is_not_marked_unavailable(self) -> None:
        response = self._call("undo_pdf_not_available", record_id="R2")
        assert "error" in response
        assert self._status_of("R2") == "pdf_needs_manual_retrieval"

    def test_mark_reports_an_unknown_record(self) -> None:
        assert "error" in self._call("mark_pdf_not_available", record_id="NOPE")

    # -- match_pdf_to_records ----------------------------------------------

    def test_match_falls_back_to_the_filename_when_the_pdf_has_no_metadata(self) -> None:
        # A stub PDF carries no extractable metadata, so the handler falls
        # back to the filename — here the record id itself, which is what the
        # upload dialog offers as the obvious candidate.
        result = self._call(
            "match_pdf_to_records",
            filename="R1.pdf",
            content=base64.b64encode(MINIMAL_PDF).decode(),
        )["result"]

        assert result["filename"] == "R1.pdf"
        assert result["extraction_method"] == "filename_only"
        assert result["best_match"] is not None
        assert result["best_match"]["record_id"] == "R1"

    def test_match_matches_on_author_and_year_in_the_filename(self) -> None:
        result = self._call(
            "match_pdf_to_records",
            filename="brown_2023_imaging.pdf",
            content=base64.b64encode(MINIMAL_PDF).decode(),
        )["result"]

        assert result["best_match"] is not None
        assert result["best_match"]["record_id"] == "R2"

    def test_match_returns_candidates_without_mutating_anything(self) -> None:
        before = self._status_of("R1")
        self._call(
            "match_pdf_to_records",
            filename="something-unrelated.pdf",
            content=base64.b64encode(MINIMAL_PDF).decode(),
        )
        # match is a read: it suggests, the user decides.
        assert self._status_of("R1") == before
