"""Framework-native dedupe handler."""

from __future__ import annotations

import logging

from colrev.constants import OperationsType
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


class DedupeRequest(ProjectScopedRequest):
    pass


class DedupeResponse(ProjectResponse):
    operation: str
    details: dict


class DedupeHandler(BaseHandler):
    """Deduplication operation."""

    @rpc_method(
        name="dedupe",
        request=DedupeRequest,
        response=DedupeResponse,
        operation_type=OperationsType.dedupe,
        notify=True,
        writes=True,
    )
    def dedupe(self, req: DedupeRequest) -> DedupeResponse:
        assert self.review_manager is not None
        logger.info("Running dedupe operation for project %s", req.project_id)

        dedupe_operation = self.op(OperationsType.dedupe, notify=True)
        dedupe_operation.main()

        return DedupeResponse(
            project_id=req.project_id,
            operation="dedupe",
            details={"message": "Deduplication completed"},
        )
