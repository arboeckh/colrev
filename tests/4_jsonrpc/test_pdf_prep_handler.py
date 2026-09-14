#!/usr/bin/env python
"""Tests for ``accept_pdf_as_is`` — the user's override of pdf-prep defects.

pdf-prep's checkers are heuristics: "author-not-in-pdf" fires on a correct
PDF whenever the author's name is typeset differently. After looking at the
PDF, the user can accept it. The override must move exactly that record to
``pdf_prepared`` and must not be undone by the next pdf-prep run.
"""
from __future__ import annotations

import os
from pathlib import Path

import git
import pymupdf
import pytest

import colrev.constants
import colrev.ops.init
import colrev.record.qm.quality_model
import colrev.record.record_pdf
from colrev.constants import Fields
from colrev.constants import RecordState
from colrev.ui_jsonrpc.handler import JSONRPCHandler

PROJECT_ID = "pdf_prep_project"


def _record_bib(*, record_id: str, status: str, note: str, file: str | None) -> str:
    lines = [
        f"@article{{{record_id},",
        f"   colrev_origin                 = {{import.bib/{record_id}}},",
        f"   colrev_status                 = {{{status}}},",
    ]
    if file is not None:
        lines.append(f"   colrev_data_provenance        = {{file:pdf-get;{note};}},")
        lines.append(f"   file                          = {{{file}}},")
    lines += [
        "   title                         = {Machine learning in healthcare},",
        "   author                        = {Smith, John},",
        "   year                          = {2023},",
        "   journal                       = {Journal A},",
        "}",
    ]
    return "\n".join(lines)


def _write_pdf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    doc.save(str(path))
    doc.close()


class TestAcceptPDFAsIs:
    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
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

        # A readable PDF that mentions neither the title nor the author — what
        # pdf-prep flags, and what a user may still know to be the right file.
        _write_pdf(self.project_path / "data/pdfs/R1.pdf", "Some unrelated text")
        _write_pdf(self.project_path / "data/pdfs/R2.pdf", "Some unrelated text")

        records_path = self.project_path / "data" / "records.bib"
        records_path.write_text(
            "\n\n".join(
                [
                    _record_bib(
                        record_id="R1",
                        status="pdf_needs_manual_preparation",
                        note="author-not-in-pdf,title-not-in-pdf",
                        file="data/pdfs/R1.pdf",
                    ),
                    _record_bib(
                        record_id="R2",
                        status="pdf_needs_manual_preparation",
                        note="author-not-in-pdf",
                        file="data/pdfs/R2.pdf",
                    ),
                    _record_bib(
                        record_id="R3",
                        status="pdf_needs_manual_preparation",
                        note="author-not-in-pdf",
                        file="data/pdfs/R3.pdf",  # never written to disk
                    ),
                    _record_bib(
                        record_id="R4",
                        status="pdf_needs_manual_retrieval",
                        note="",
                        file=None,
                    ),
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        repo = git.Repo(self.project_path)
        repo.git.add("data/records.bib")
        repo.git.commit("-m", "Seed records with PDF defects")

    def _call(self, method: str, **kwargs) -> dict:
        return self.handler.handle_request(
            {
                "jsonrpc": "2.0",
                "method": method,
                "params": {**self.params, **kwargs},
                "id": 1,
            }
        )

    def _record(self, record_id: str) -> dict:
        records = self._call("get_records")["result"]["records"]
        return next(r for r in records if r["ID"] == record_id)

    def _file_note(self, record_id: str) -> str:
        return self._record(record_id)["colrev_data_provenance"]["file"]["note"]

    def test_accept_moves_only_that_record_to_prepared(self) -> None:
        result = self._call("accept_pdf_as_is", record_id="R1")["result"]

        assert result["new_status"] == "pdf_prepared"
        assert sorted(result["ignored_defects"]) == [
            "author-not-in-pdf",
            "title-not-in-pdf",
        ]
        assert self._record("R1")["colrev_status"] == "pdf_prepared"
        assert self._record("R2")["colrev_status"] == "pdf_needs_manual_preparation"

    def test_accept_keeps_the_overridden_defects_as_ignored(self) -> None:
        self._call("accept_pdf_as_is", record_id="R1")

        notes = sorted(self._file_note("R1").split(","))
        assert notes == ["IGNORE:author-not-in-pdf", "IGNORE:title-not-in-pdf"]

    def _rerun_pdf_checkers(self, record_id: str) -> colrev.record.record_pdf.PDFRecord:
        record_dict = self._record(record_id)
        original_cwd = os.getcwd()
        os.chdir(self.project_path)
        try:
            record = colrev.record.record_pdf.PDFRecord(
                record_dict, path=self.project_path
            )
            record.set_text_from_pdf(first_pages=True)
            pdf_qm = colrev.record.qm.quality_model.QualityModel(
                defects_to_ignore=[], pdf_mode=True, path=self.project_path
            )
            record.run_pdf_quality_model(pdf_qm, set_prepared=True)
        finally:
            os.chdir(original_cwd)
        return record

    def test_pdf_checkers_do_not_reflag_an_accepted_pdf(self) -> None:
        self._call("accept_pdf_as_is", record_id="R1")

        accepted = self._rerun_pdf_checkers("R1")
        assert not accepted.has_pdf_defects()
        assert accepted.data[Fields.STATUS] == RecordState.pdf_prepared

        # Control: the same checkers on an untouched record do flag it, so the
        # assertion above isn't passing because the checkers never ran.
        untouched = self._rerun_pdf_checkers("R2")
        assert untouched.has_pdf_defects()
        assert untouched.data[Fields.STATUS] == RecordState.pdf_needs_manual_preparation

    def test_accept_refuses_a_record_whose_pdf_is_not_on_disk(self) -> None:
        assert "error" in self._call("accept_pdf_as_is", record_id="R3")
        assert self._record("R3")["colrev_status"] == "pdf_needs_manual_preparation"

    def test_accept_refuses_a_record_that_is_not_flagged(self) -> None:
        assert "error" in self._call("accept_pdf_as_is", record_id="R4")
        assert self._record("R4")["colrev_status"] == "pdf_needs_manual_retrieval"

    def test_accept_reports_an_unknown_record(self) -> None:
        assert "error" in self._call("accept_pdf_as_is", record_id="NOPE")
