"""Framework-native PDF-get handler.

All pdf_get-related JSON-RPC methods. Writes stage changes only; commits
are driven explicitly via the ``commit_changes`` endpoint in ``git_handler``.
"""

from __future__ import annotations

import base64
import logging
import re
import tempfile
from pathlib import Path
from typing import Any
from typing import Dict
from typing import List
from typing import Literal
from typing import Optional

import pymupdf
from pydantic import BaseModel
from pydantic import ConfigDict

import colrev.ops.pdf_get_man
import colrev.ops.pdf_prep
import colrev.record.record
from colrev.constants import EndpointType
from colrev.constants import Fields
from colrev.constants import FieldsRegex
from colrev.constants import OperationsType
from colrev.constants import RecordState
from colrev.package_manager.package_manager import PackageManager
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProgressEventKind
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import make_progress_callback
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class PDFGetRequest(ProjectScopedRequest):
    pass


class PDFGetResponse(ProjectResponse):
    operation: str
    details: Dict[str, Any]


class UploadPDFRequest(ProjectScopedRequest):
    record_id: str
    filename: str
    content: str


class UploadPDFResponse(ProjectResponse):
    model_config = ConfigDict(extra="allow")

    record_id: str
    file_path: str
    new_status: str
    prep_status: str = "skipped"
    prep_message: Optional[str] = None


class MarkPDFNotAvailableRequest(ProjectScopedRequest):
    record_id: str


class MarkPDFNotAvailableResponse(ProjectResponse):
    record_id: str
    new_status: str


class UndoPDFNotAvailableRequest(ProjectScopedRequest):
    record_id: str


class UndoPDFNotAvailableResponse(ProjectResponse):
    record_id: str
    new_status: str


class MatchPDFToRecordsRequest(ProjectScopedRequest):
    filename: str
    content: str


class ExtractedMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str = ""
    author: str = ""
    year: str = ""
    doi: str = ""


class PDFMatchCandidate(BaseModel):
    model_config = ConfigDict(extra="allow")

    record_id: str
    similarity: float
    title: str = ""
    author: str = ""
    year: str = ""


class BestMatch(BaseModel):
    model_config = ConfigDict(extra="allow")

    record_id: str
    similarity: float


class MatchPDFToRecordsResponse(ProjectResponse):
    filename: str
    extraction_method: Literal["pdf_metadata", "filename_only", "none"]
    extracted_metadata: Optional[ExtractedMetadata] = None
    matches: List[PDFMatchCandidate]
    best_match: Optional[BestMatch] = None


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class PDFGetHandler(BaseHandler):
    """All pdf_get JSON-RPC methods."""

    # -- pdf_get ------------------------------------------------------------

    @rpc_method(
        name="pdf_get",
        request=PDFGetRequest,
        response=PDFGetResponse,
        operation_type=OperationsType.pdf_get,
        notify=True,
        writes=True,
    )
    def pdf_get(self, req: PDFGetRequest) -> PDFGetResponse:
        assert self.review_manager is not None
        logger.info("Running pdf-get operation for project %s", req.project_id)

        pdf_get_operation = self.op(OperationsType.pdf_get, notify=True)
        pdf_get_operation.main(
            progress_callback=make_progress_callback(
                ProgressEventKind.pdf_get_progress, source="pdf_get"
            ),
        )

        return PDFGetResponse(
            project_id=req.project_id,
            operation="pdf_get",
            details={"message": "PDF retrieval completed"},
        )

    # -- upload_pdf ---------------------------------------------------------

    @rpc_method(
        name="upload_pdf",
        request=UploadPDFRequest,
        response=UploadPDFResponse,
        writes=True,
    )
    def upload_pdf(self, req: UploadPDFRequest) -> UploadPDFResponse:
        assert self.review_manager is not None
        if not req.record_id:
            raise ValueError("record_id parameter is required")
        if not req.filename:
            raise ValueError("filename parameter is required")
        if not req.content:
            raise ValueError("content parameter is required")

        logger.info(
            "Uploading PDF for record %s in project %s",
            req.record_id, req.project_id,
        )

        # Instantiate PDFGetMan first to notify the review manager
        # (required before load_records_dict can be called)
        pdf_get_man = colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )

        # Load records and verify record exists
        records = self.review_manager.dataset.load_records_dict()
        if req.record_id not in records:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records[req.record_id]
        current_status = record_dict[Fields.STATUS]
        is_reupload = (
            current_status == RecordState.pdf_needs_manual_preparation
        )
        is_from_not_available = (
            current_status == RecordState.pdf_not_available
        )
        if current_status not in (
            RecordState.pdf_needs_manual_retrieval,
            RecordState.pdf_needs_manual_preparation,
            RecordState.pdf_not_available,
        ):
            raise ValueError(
                f"Record '{req.record_id}' is not in a state that accepts PDF upload "
                f"(current: {current_status})"
            )

        # Decode base64 content
        try:
            pdf_bytes = base64.b64decode(req.content)
        except Exception as e:
            raise ValueError(f"Invalid base64 content: {e}")

        # Write PDF to data/pdfs/{record_id}.pdf
        pdf_dir = self.review_manager.paths.pdf
        pdf_dir.mkdir(parents=True, exist_ok=True)
        target_path = pdf_dir / f"{req.record_id}.pdf"

        with open(target_path, "wb") as f:
            f.write(pdf_bytes)

        if is_reupload:
            # Re-upload: overwrite the PDF, clear file provenance defects,
            # and reset status to pdf_imported so auto-prep runs fresh
            record = colrev.record.record.Record(record_dict)
            record.data[Fields.D_PROV]["file"] = {
                "source": "manual-upload",
                "note": "",
            }
            record.set_status(target_state=RecordState.pdf_imported, force=True)
            self.review_manager.dataset.save_records_dict(
                {req.record_id: record.data}, partial=True
            )
        elif is_from_not_available:
            # Upload for a record previously marked as not available:
            # transition back to pdf_needs_manual_retrieval first, then link
            record = colrev.record.record.Record(record_dict)
            record.set_status(
                target_state=RecordState.pdf_needs_manual_retrieval, force=True
            )
            self.review_manager.dataset.save_records_dict(
                {req.record_id: record.data}, partial=True
            )
            # Re-load and link the PDF
            records = self.review_manager.dataset.load_records_dict()
            record = colrev.record.record.Record(records[req.record_id])
            pdf_get_man.pdf_get_man_record(record=record, filepath=target_path)
        else:
            # First upload: use PDFGetMan to link the PDF to the record
            record = colrev.record.record.Record(record_dict)
            pdf_get_man.pdf_get_man_record(record=record, filepath=target_path)

        # Auto-run PDF prep on the uploaded record
        prep_status = "skipped"
        prep_message: Optional[str] = None
        try:
            pdf_prep_operation = colrev.ops.pdf_prep.PDFPrep(
                review_manager=self.review_manager,
                notify_state_transition_operation=False,
            )

            # Set up package endpoints (same pattern as PDFPrep.main())
            package_manager = PackageManager()
            pdf_prep_operation.pdf_prep_package_endpoints = {}
            for pdf_prep_pe in (
                self.review_manager.settings.pdf_prep.pdf_prep_package_endpoints
            ):
                pdf_prep_class = package_manager.get_package_endpoint_class(
                    package_type=EndpointType.pdf_prep,
                    package_identifier=pdf_prep_pe["endpoint"],
                )
                pdf_prep_operation.pdf_prep_package_endpoints[
                    pdf_prep_pe["endpoint"]
                ] = pdf_prep_class(
                    pdf_prep_operation=pdf_prep_operation,
                    settings=pdf_prep_pe,
                )

            # Re-load the record after pdf_get_man saved it
            fresh_records = self.review_manager.dataset.load_records_dict()
            fresh_record_dict = fresh_records[req.record_id]

            # Run prep on this single record
            prepped_record_dict = pdf_prep_operation.prepare_pdf(
                {"record": fresh_record_dict}
            )

            # Save the prepped record
            self.review_manager.dataset.save_records_dict(
                {req.record_id: prepped_record_dict}, partial=True
            )

            prep_status = str(prepped_record_dict.get(Fields.STATUS, ""))

            # Extract defect notes if prep failed
            if prep_status == str(RecordState.pdf_needs_manual_preparation):
                provenance = prepped_record_dict.get(
                    Fields.D_PROV, {}
                )
                file_prov = provenance.get("file", {})
                note = file_prov.get("note", "") if isinstance(file_prov, dict) else ""
                if note:
                    prep_message = note
                else:
                    prep_message = "PDF needs manual preparation"

        except Exception as e:
            logger.warning("PDF prep failed for %s: %s", req.record_id, e)
            prep_status = "skipped"
            prep_message = str(e)

        # Determine final status
        final_records = self.review_manager.dataset.load_records_dict()
        final_status = str(
            final_records[req.record_id].get(Fields.STATUS, "pdf_imported")
        )

        return UploadPDFResponse(
            project_id=req.project_id,
            record_id=req.record_id,
            file_path=str(target_path.relative_to(self.review_manager.path)),
            new_status=final_status,
            prep_status=prep_status,
            prep_message=prep_message,
        )

    # -- mark_pdf_not_available --------------------------------------------

    @rpc_method(
        name="mark_pdf_not_available",
        request=MarkPDFNotAvailableRequest,
        response=MarkPDFNotAvailableResponse,
        writes=True,
    )
    def mark_pdf_not_available(
        self, req: MarkPDFNotAvailableRequest
    ) -> MarkPDFNotAvailableResponse:
        assert self.review_manager is not None
        if not req.record_id:
            raise ValueError("record_id parameter is required")

        logger.info(
            "Marking PDF not available for record %s in project %s",
            req.record_id, req.project_id,
        )

        # Instantiate PDFGetMan to notify the review manager (no state-transition check)
        colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )

        records = self.review_manager.dataset.load_records_dict()
        if req.record_id not in records:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records[req.record_id]
        current_status = record_dict[Fields.STATUS]
        if current_status not in (
            RecordState.pdf_needs_manual_retrieval,
            RecordState.pdf_needs_manual_preparation,
        ):
            raise ValueError(
                f"Record '{req.record_id}' is not in a state that can be marked "
                f"unavailable (current: {current_status})"
            )

        record = colrev.record.record.Record(record_dict)

        # In pdf_needs_manual_preparation the record has an unusable linked PDF;
        # drop it so the "not available" state is internally consistent.
        if current_status == RecordState.pdf_needs_manual_preparation:
            record.data.pop(Fields.FILE, None)

        pdf_required = (
            self.review_manager.settings.pdf_get.pdf_required_for_screen_and_synthesis
        )
        target = (
            RecordState.pdf_not_available if pdf_required else RecordState.pdf_prepared
        )
        record.set_status(target_state=target, force=True)
        if not pdf_required:
            record.add_field_provenance(
                key=Fields.FILE, source="pdf-get-man", note="not_available"
            )

        self.review_manager.dataset.save_records_dict(
            {req.record_id: record.data}, partial=True
        )

        new_status = str(record.data[Fields.STATUS])

        return MarkPDFNotAvailableResponse(
            project_id=req.project_id,
            record_id=req.record_id,
            new_status=new_status,
        )

    # -- undo_pdf_not_available --------------------------------------------

    @rpc_method(
        name="undo_pdf_not_available",
        request=UndoPDFNotAvailableRequest,
        response=UndoPDFNotAvailableResponse,
        writes=True,
    )
    def undo_pdf_not_available(
        self, req: UndoPDFNotAvailableRequest
    ) -> UndoPDFNotAvailableResponse:
        assert self.review_manager is not None
        if not req.record_id:
            raise ValueError("record_id parameter is required")

        logger.info(
            "Undoing pdf_not_available for record %s in project %s",
            req.record_id, req.project_id,
        )

        colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )

        records = self.review_manager.dataset.load_records_dict()
        if req.record_id not in records:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records[req.record_id]
        if record_dict[Fields.STATUS] != RecordState.pdf_not_available:
            raise ValueError(
                f"Record '{req.record_id}' is not in pdf_not_available state "
                f"(current: {record_dict[Fields.STATUS]})"
            )

        # Force-transition back to pdf_needs_manual_retrieval
        record = colrev.record.record.Record(record_dict)
        record.set_status(
            target_state=RecordState.pdf_needs_manual_retrieval, force=True
        )
        self.review_manager.dataset.save_records_dict(
            {req.record_id: record.data}, partial=True
        )

        new_status = str(record.data[Fields.STATUS])

        return UndoPDFNotAvailableResponse(
            project_id=req.project_id,
            record_id=req.record_id,
            new_status=new_status,
        )

    # -- match_pdf_to_records ----------------------------------------------

    @rpc_method(
        name="match_pdf_to_records",
        request=MatchPDFToRecordsRequest,
        response=MatchPDFToRecordsResponse,
        writes=False,
    )
    def match_pdf_to_records(
        self, req: MatchPDFToRecordsRequest
    ) -> MatchPDFToRecordsResponse:
        assert self.review_manager is not None
        if not req.filename:
            raise ValueError("filename parameter is required")
        if not req.content:
            raise ValueError("content parameter is required")

        logger.info("Matching PDF '%s' to records", req.filename)

        try:
            pdf_bytes = base64.b64decode(req.content)
        except Exception as e:
            raise ValueError(f"Invalid base64 content: {e}")

        # Load records that need PDFs
        colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )
        records = self.review_manager.dataset.load_records_dict()
        candidate_records = {
            rid: rec
            for rid, rec in records.items()
            if rec.get(Fields.STATUS)
            in (
                RecordState.pdf_needs_manual_retrieval,
                RecordState.pdf_needs_manual_preparation,
            )
        }

        extraction_method: Literal[
            "pdf_metadata", "filename_only", "none"
        ] = "none"
        extracted_metadata: Optional[Dict[str, str]] = None
        matches: List[Dict[str, Any]] = []

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = Path(tmp.name)

        try:
            pdf_record_dict = self._extract_pdf_metadata(tmp_path)

            if pdf_record_dict:
                extraction_method = "pdf_metadata"
                extracted_metadata = {
                    "title": pdf_record_dict.get(Fields.TITLE, ""),
                    "author": pdf_record_dict.get(Fields.AUTHOR, ""),
                    "year": pdf_record_dict.get(Fields.YEAR, ""),
                    "doi": pdf_record_dict.get(Fields.DOI, ""),
                }

                # Fast path: exact DOI match
                extracted_doi = pdf_record_dict.get(Fields.DOI, "").strip()
                if extracted_doi:
                    for rid, rec in candidate_records.items():
                        rec_doi = rec.get(Fields.DOI, "").strip()
                        if rec_doi and rec_doi.lower() == extracted_doi.lower():
                            matches.append(
                                {
                                    "record_id": rid,
                                    "similarity": 1.0,
                                    "title": rec.get(Fields.TITLE, ""),
                                    "author": rec.get(Fields.AUTHOR, ""),
                                    "year": rec.get(Fields.YEAR, ""),
                                }
                            )

                # Similarity-based matching
                if not matches and (
                    pdf_record_dict.get(Fields.TITLE)
                    or pdf_record_dict.get(Fields.AUTHOR)
                ):
                    pdf_record_dict.setdefault("ID", "pdf_extract")
                    pdf_record_dict.setdefault("ENTRYTYPE", "article")
                    pdf_record = colrev.record.record.Record(pdf_record_dict)

                    for rid, rec in candidate_records.items():
                        try:
                            candidate_record = colrev.record.record.Record(
                                rec.copy()
                            )
                            sim = colrev.record.record.Record.get_record_similarity(
                                pdf_record, candidate_record
                            )
                            if sim > 0.3:
                                matches.append(
                                    {
                                        "record_id": rid,
                                        "similarity": round(sim, 4),
                                        "title": rec.get(Fields.TITLE, ""),
                                        "author": rec.get(Fields.AUTHOR, ""),
                                        "year": rec.get(Fields.YEAR, ""),
                                    }
                                )
                        except Exception as e:
                            logger.debug(
                                "Similarity check failed for %s: %s", rid, e
                            )
                            continue

        except Exception as e:
            logger.info(
                "PDF metadata extraction failed for '%s': %s", req.filename, e
            )
            extraction_method = "filename_only"

        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

        # Fallback: filename-based matching
        if not matches:
            if extraction_method != "pdf_metadata":
                extraction_method = "filename_only"
            stem = Path(req.filename).stem.lower()

            # Exact match: filename stem === record ID
            for rid, rec in candidate_records.items():
                if rid.lower() == stem:
                    matches.append(
                        {
                            "record_id": rid,
                            "similarity": 0.9,
                            "title": rec.get(Fields.TITLE, ""),
                            "author": rec.get(Fields.AUTHOR, ""),
                            "year": rec.get(Fields.YEAR, ""),
                        }
                    )
                    break

            # Fuzzy match: filename contains author last name + year
            if not matches:
                for rid, rec in candidate_records.items():
                    author = rec.get(Fields.AUTHOR, "")
                    year = rec.get(Fields.YEAR, "")
                    if author and year:
                        author_last = author.split(",")[0].strip().lower()
                        if (
                            author_last
                            and author_last in stem
                            and year in stem
                        ):
                            matches.append(
                                {
                                    "record_id": rid,
                                    "similarity": 0.6,
                                    "title": rec.get(Fields.TITLE, ""),
                                    "author": rec.get(Fields.AUTHOR, ""),
                                    "year": rec.get(Fields.YEAR, ""),
                                }
                            )

        # Sort by similarity descending, take top 5
        matches.sort(key=lambda m: m["similarity"], reverse=True)
        matches = matches[:5]

        # Determine best match
        best_match: Optional[BestMatch] = None
        if matches and matches[0]["similarity"] > 0.5:
            best_match = BestMatch(
                record_id=matches[0]["record_id"],
                similarity=matches[0]["similarity"],
            )

        return MatchPDFToRecordsResponse(
            project_id=req.project_id,
            filename=req.filename,
            extraction_method=extraction_method,
            extracted_metadata=(
                ExtractedMetadata(**extracted_metadata)
                if extracted_metadata is not None
                else None
            ),
            matches=[PDFMatchCandidate(**m) for m in matches],
            best_match=best_match,
        )

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _extract_pdf_metadata(pdf_path: Path) -> Optional[Dict[str, str]]:
        """
        Extract metadata from a PDF using pymupdf.

        Reads document properties (title, author) and scans first-page text
        for a DOI. No external services required.
        """
        result: Dict[str, str] = {}

        try:
            with pymupdf.open(pdf_path) as doc:
                # 1. Document properties (embedded metadata)
                meta = doc.metadata or {}
                title = (meta.get("title") or "").strip()
                author = (meta.get("author") or "").strip()

                if title:
                    result[Fields.TITLE] = title
                if author:
                    result[Fields.AUTHOR] = author

                # 2. Extract first-page text for DOI regex
                first_page_text = ""
                for i, page in enumerate(doc):
                    if i > 1:
                        break
                    first_page_text += page.get_text()

                if first_page_text:
                    doi_matches = FieldsRegex.DOI.findall(first_page_text)
                    if doi_matches:
                        result[Fields.DOI] = doi_matches[0].upper()

                    # Try to extract year from text if not in metadata
                    if Fields.YEAR not in result:
                        year_matches = re.findall(
                            r"\b(19\d{2}|20[0-2]\d)\b", first_page_text[:2000]
                        )
                        if year_matches:
                            result[Fields.YEAR] = year_matches[0]

        except Exception as e:
            logger.debug("pymupdf extraction failed: %s", e)
            return None

        return result if result else None
