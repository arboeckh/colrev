"""Framework-native PDF prep handler."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import colrev.exceptions as colrev_exceptions
import colrev.ops.pdf_prep_man
import colrev.record.record
from colrev.constants import Fields
from colrev.constants import OperationsType
from colrev.constants import RecordState
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


class PDFPrepRequest(ProjectScopedRequest):
    reprocess: bool = False
    batch_size: int = 0


class PDFPrepResponse(ProjectResponse):
    operation: str
    details: dict


class AcceptPDFAsIsRequest(ProjectScopedRequest):
    record_id: str


class AcceptPDFAsIsResponse(ProjectResponse):
    record_id: str
    new_status: str
    ignored_defects: List[str]


class PDFPrepHandler(BaseHandler):
    """PDF preparation operation."""

    @rpc_method(
        name="pdf_prep",
        request=PDFPrepRequest,
        response=PDFPrepResponse,
        operation_type=OperationsType.pdf_prep,
        writes=True,
    )
    def pdf_prep(self, req: PDFPrepRequest) -> PDFPrepResponse:
        assert self.review_manager is not None
        logger.info("Running pdf-prep operation for project %s", req.project_id)

        pdf_prep_operation = self.op(OperationsType.pdf_prep, notify=True)
        pdf_prep_operation.main(reprocess=req.reprocess, batch_size=req.batch_size)

        return PDFPrepResponse(
            project_id=req.project_id,
            operation="pdf_prep",
            details={
                "message": "PDF preparation completed",
                "reprocess": req.reprocess,
                "batch_size": req.batch_size,
            },
        )

    # -- accept_pdf_as_is ---------------------------------------------------

    @rpc_method(
        name="accept_pdf_as_is",
        request=AcceptPDFAsIsRequest,
        response=AcceptPDFAsIsResponse,
        writes=True,
    )
    def accept_pdf_as_is(self, req: AcceptPDFAsIsRequest) -> AcceptPDFAsIsResponse:
        """Override pdf-prep's defect flags after a human looked at the PDF.

        This is pdf-prep-man's "Prepared? → Yes", with one difference: instead
        of wiping the file's provenance notes (``reset_pdf_provenance_notes``),
        each flagged defect is kept as ``IGNORE:<code>`` via the core
        ``ignore_defect`` API. The PDF checkers skip ignored defects, so the
        override survives a pdf-prep re-run, and the record still shows what
        was overridden.
        """
        assert self.review_manager is not None
        if not req.record_id:
            raise ValueError("record_id parameter is required")

        logger.info(
            "Accepting PDF as-is for record %s in project %s",
            req.record_id, req.project_id,
        )

        # Notify the review manager (no state-transition precondition check).
        colrev.ops.pdf_prep_man.PDFPrepMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )

        records = self.review_manager.dataset.load_records_dict()
        if req.record_id not in records:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records[req.record_id]
        if record_dict[Fields.STATUS] != RecordState.pdf_needs_manual_preparation:
            raise ValueError(
                f"Record '{req.record_id}' is not in pdf_needs_manual_preparation "
                f"state (current: {record_dict[Fields.STATUS]})"
            )

        # Accepting a PDF nobody can see would be a blind override.
        file_value = record_dict.get(Fields.FILE)
        if not file_value:
            raise ValueError(f"Record '{req.record_id}' has no linked PDF")
        pdf_path = self.review_manager.path / Path(str(file_value))
        if not pdf_path.is_file():
            raise ValueError(
                f"The PDF for record '{req.record_id}' is not on this machine"
            )

        record = colrev.record.record.Record(record_dict)
        # Raw (unstripped) codes: ignore_defect matches the stored note exactly.
        raw_notes = (
            record.data.get(Fields.D_PROV, {}).get(Fields.FILE, {}).get("note", "")
        )
        defects = [
            n for n in raw_notes.split(",") if n and not n.startswith("IGNORE:")
        ]
        for defect in defects:
            record.ignore_defect(key=Fields.FILE, defect=defect)

        record.set_status(RecordState.pdf_prepared)

        if pdf_path.suffix == ".pdf":
            try:
                record.data[Fields.PDF_ID] = record.get_colrev_pdf_id(pdf_path)
            except (
                colrev_exceptions.ServiceNotAvailableException,
                colrev_exceptions.PDFHashError,
                colrev_exceptions.InvalidPDFException,
            ) as err:
                # Same tolerance as pdf-prep's own success path: a missing hash
                # doesn't make the PDF any less accepted.
                logger.warning(
                    "Could not compute colrev_pdf_id for %s: %s", req.record_id, err
                )

        self.review_manager.dataset.save_records_dict(
            {req.record_id: record.data}, partial=True
        )

        return AcceptPDFAsIsResponse(
            project_id=req.project_id,
            record_id=req.record_id,
            new_status=str(record.data[Fields.STATUS]),
            ignored_defects=[d.strip() for d in defects],
        )
