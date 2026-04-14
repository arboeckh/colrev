"""Framework-native PDF prep handler."""

from __future__ import annotations

import logging

from colrev.constants import OperationsType
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


class PDFPrepHandler(BaseHandler):
    """PDF preparation operation."""

    @rpc_method(
        name="pdf_prep",
        request=PDFPrepRequest,
        response=PDFPrepResponse,
        operation_type=OperationsType.pdf_prep,
        notify=True,
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
