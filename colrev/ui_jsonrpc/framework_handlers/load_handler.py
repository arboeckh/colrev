"""Framework-native load handler."""

from __future__ import annotations

import logging

from colrev.constants import OperationsType
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProgressEventKind
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import make_progress_callback
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


class LoadRequest(ProjectScopedRequest):
    keep_ids: bool = False


class LoadResponse(ProjectResponse):
    operation: str
    details: dict


class LoadHandler(BaseHandler):
    """Load search results into the main dataset."""

    @rpc_method(
        name="load",
        request=LoadRequest,
        response=LoadResponse,
        operation_type=OperationsType.load,
        notify=False,
        writes=True,
    )
    def load(self, req: LoadRequest) -> LoadResponse:
        assert self.review_manager is not None
        logger.info("Running load operation for project %s", req.project_id)

        load_operation = self.review_manager.get_load_operation()
        load_operation.main(
            keep_ids=req.keep_ids,
            progress_callback=make_progress_callback(
                ProgressEventKind.load_progress, source="load"
            ),
        )

        return LoadResponse(
            project_id=req.project_id,
            operation="load",
            details={"message": "Load completed", "keep_ids": req.keep_ids},
        )
