"""Framework-native managed-review handler.

Implements multi-user branching-workflow RPC methods atop the typed framework.
These endpoints are UI-native (``operation_type=None``) — they wrap
``ManagedReviewService`` rather than a CoLRev operation lifecycle.

The service returns arbitrary dict payloads that vary by method; the response
models use ``ConfigDict(extra="allow")`` and spread the service result so
existing clients continue to see their expected fields alongside the standard
``success`` / ``project_id`` envelope.
"""

from __future__ import annotations

import logging
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

from pydantic import ConfigDict

from colrev.managed_review import ManagedReviewService
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class _KindRequest(ProjectScopedRequest):
    kind: str


class GetManagedReviewTaskReadinessRequest(_KindRequest):
    pass


class ListManagedReviewTasksRequest(_KindRequest):
    pass


class GetCurrentManagedReviewTaskRequest(_KindRequest):
    pass


class CreateManagedReviewTaskRequest(ProjectScopedRequest):
    kind: str
    reviewer_logins: List[str]
    created_by: str = "unknown"


class CancelManagedReviewTaskRequest(ProjectScopedRequest):
    task_id: str
    canceled_by: str = "unknown"


class GetManagedReviewTaskQueueRequest(ProjectScopedRequest):
    task_id: str


class GetReconciliationPreviewRequest(ProjectScopedRequest):
    task_id: str


class ApplyReconciliationRequest(ProjectScopedRequest):
    task_id: str
    resolutions: List[Any] = []
    resolved_by: str = "unknown"


class ExportReconciliationAuditRequest(ProjectScopedRequest):
    task_id: str
    format: str


# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------


class ManagedReviewResponse(ProjectResponse):
    """All managed-review responses share the same envelope: success +
    project_id plus an open dict of service-specific fields."""

    model_config = ConfigDict(extra="allow")


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class ManagedReviewHandler(BaseHandler):
    """All managed-review JSON-RPC methods. UI-native (no OperationsType)."""

    def _service(self) -> ManagedReviewService:
        assert self.review_manager is not None
        return ManagedReviewService(review_manager=self.review_manager)

    def _wrap(
        self, req: ProjectScopedRequest, payload: Dict[str, Any]
    ) -> ManagedReviewResponse:
        # Spread the service's dict payload into the response envelope. Use
        # model_construct to bypass extra='forbid' inherited from the base
        # _FrameworkModel so arbitrary service fields pass through verbatim.
        # Service payloads may already carry a ``success`` key — let the
        # envelope defaults win and only merge fields the payload doesn't set.
        merged: Dict[str, Any] = {
            "success": True,
            "project_id": req.project_id,
        }
        merged.update(payload)
        return ManagedReviewResponse.model_construct(**merged)

    # -- get_managed_review_task_readiness ----------------------------------

    @rpc_method(
        name="get_managed_review_task_readiness",
        request=GetManagedReviewTaskReadinessRequest,
        response=ManagedReviewResponse,
        writes=False,
    )
    def get_managed_review_task_readiness(
        self, req: GetManagedReviewTaskReadinessRequest
    ) -> ManagedReviewResponse:
        return self._wrap(req, self._service().get_task_readiness(kind=req.kind))

    # -- list_managed_review_tasks ------------------------------------------

    @rpc_method(
        name="list_managed_review_tasks",
        request=ListManagedReviewTasksRequest,
        response=ManagedReviewResponse,
        writes=False,
    )
    def list_managed_review_tasks(
        self, req: ListManagedReviewTasksRequest
    ) -> ManagedReviewResponse:
        return self._wrap(req, self._service().list_tasks(kind=req.kind))

    # -- get_current_managed_review_task ------------------------------------

    @rpc_method(
        name="get_current_managed_review_task",
        request=GetCurrentManagedReviewTaskRequest,
        response=ManagedReviewResponse,
        writes=False,
    )
    def get_current_managed_review_task(
        self, req: GetCurrentManagedReviewTaskRequest
    ) -> ManagedReviewResponse:
        return self._wrap(
            req, self._service().get_current_branch_task(kind=req.kind)
        )

    # -- create_managed_review_task -----------------------------------------

    @rpc_method(
        name="create_managed_review_task",
        request=CreateManagedReviewTaskRequest,
        response=ManagedReviewResponse,
        writes=True,
    )
    def create_managed_review_task(
        self, req: CreateManagedReviewTaskRequest
    ) -> ManagedReviewResponse:
        return self._wrap(
            req,
            self._service().create_task(
                kind=req.kind,
                reviewer_logins=req.reviewer_logins,
                created_by=req.created_by,
            ),
        )

    # -- cancel_managed_review_task -----------------------------------------

    @rpc_method(
        name="cancel_managed_review_task",
        request=CancelManagedReviewTaskRequest,
        response=ManagedReviewResponse,
        writes=True,
    )
    def cancel_managed_review_task(
        self, req: CancelManagedReviewTaskRequest
    ) -> ManagedReviewResponse:
        return self._wrap(
            req,
            self._service().cancel_task(
                task_id=req.task_id,
                canceled_by=req.canceled_by,
            ),
        )

    # -- get_managed_review_task_queue --------------------------------------

    @rpc_method(
        name="get_managed_review_task_queue",
        request=GetManagedReviewTaskQueueRequest,
        response=ManagedReviewResponse,
        writes=False,
    )
    def get_managed_review_task_queue(
        self, req: GetManagedReviewTaskQueueRequest
    ) -> ManagedReviewResponse:
        return self._wrap(
            req, self._service().get_task_queue(task_id=req.task_id)
        )

    # -- get_reconciliation_preview -----------------------------------------

    @rpc_method(
        name="get_reconciliation_preview",
        request=GetReconciliationPreviewRequest,
        response=ManagedReviewResponse,
        writes=False,
    )
    def get_reconciliation_preview(
        self, req: GetReconciliationPreviewRequest
    ) -> ManagedReviewResponse:
        return self._wrap(
            req,
            self._service().get_reconciliation_preview(task_id=req.task_id),
        )

    # -- apply_reconciliation -----------------------------------------------

    @rpc_method(
        name="apply_reconciliation",
        request=ApplyReconciliationRequest,
        response=ManagedReviewResponse,
        writes=True,
    )
    def apply_reconciliation(
        self, req: ApplyReconciliationRequest
    ) -> ManagedReviewResponse:
        return self._wrap(
            req,
            self._service().apply_reconciliation(
                task_id=req.task_id,
                resolutions=req.resolutions,
                resolved_by=req.resolved_by,
            ),
        )

    # -- export_reconciliation_audit ----------------------------------------

    @rpc_method(
        name="export_reconciliation_audit",
        request=ExportReconciliationAuditRequest,
        response=ManagedReviewResponse,
        writes=False,
    )
    def export_reconciliation_audit(
        self, req: ExportReconciliationAuditRequest
    ) -> ManagedReviewResponse:
        return self._wrap(
            req,
            self._service().export_reconciliation_audit(
                task_id=req.task_id,
                export_format=req.format,
            ),
        )
