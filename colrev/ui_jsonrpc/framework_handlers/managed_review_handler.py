"""Framework-native managed-review handler.

Implements multi-user branching-workflow RPC methods atop the typed framework.
These endpoints are UI-native (``operation_type=None``) — they wrap
``ManagedReviewService`` rather than a CoLRev operation lifecycle.

The service returns dict payloads; each method validates its payload into a
typed response model so the exported schema (and the generated frontend
types) carry the real wire shape. The nested models mirror the dicts built
in ``colrev/ui_jsonrpc/managed_review.py`` — keep them in sync.
"""

from __future__ import annotations

import logging
from typing import Any
from typing import Dict
from typing import List
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

from colrev.ui_jsonrpc.managed_review import ManagedReviewService
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


ManagedReviewKind = Literal["prescreen", "screen"]
ReviewerRole = Literal["reviewer_a", "reviewer_b"]


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class _KindRequest(ProjectScopedRequest):
    kind: ManagedReviewKind


class GetManagedReviewTaskReadinessRequest(_KindRequest):
    pass


class ListManagedReviewTasksRequest(_KindRequest):
    pass


class GetCurrentManagedReviewTaskRequest(_KindRequest):
    pass


class CreateManagedReviewTaskRequest(ProjectScopedRequest):
    kind: ManagedReviewKind
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
    override_blocks: bool = False


class ExportReconciliationAuditRequest(ProjectScopedRequest):
    task_id: str
    format: str


# ---------------------------------------------------------------------------
# Response models — mirror the dict payloads built in colrev/ui_jsonrpc/managed_review.py
# ---------------------------------------------------------------------------


class _ServiceModel(BaseModel):
    """Nested payload models validate the service dicts; ``extra="allow"``
    lets service-added fields ride along instead of failing the call."""

    model_config = ConfigDict(extra="allow")


class ManagedReviewReviewer(_ServiceModel):
    role: ReviewerRole
    github_login: str
    branch_name: str
    last_seen_commit: Optional[str] = None


class ManagedReviewReviewerProgress(ManagedReviewReviewer):
    branch_ref: Optional[str] = None
    completed_count: int
    pending_count: int
    available: bool


class ManagedReviewReconciliationSummary(_ServiceModel):
    resolved_by: str
    resolved_at: str
    auto_resolved_count: int
    manual_conflict_count: int
    record_count: int


class ManagedReviewTask(_ServiceModel):
    id: str
    kind: ManagedReviewKind
    mode: str
    state: Literal["active", "reconciling", "completed", "aborted"]
    base_branch: str
    base_commit: str
    eligible_state: str
    record_ids: List[str]
    reviewers: List[ManagedReviewReviewer]
    reviewer_progress: List[ManagedReviewReviewerProgress]
    created_by: str
    created_at: str
    completed_at: Optional[str] = None
    canceled_at: Optional[str] = None
    canceled_by: Optional[str] = None
    reconciliation_summary: Optional[ManagedReviewReconciliationSummary] = None
    record_count: int


class ManagedReviewTracking(_ServiceModel):
    has_remote: bool
    tracking_branch: Optional[str] = None
    ahead: int
    behind: int


class ManagedReviewQueueRecord(_ServiceModel):
    id: str
    title: str
    author: str
    year: str
    status: str


class ReconciliationReviewerEntry(ManagedReviewReviewer):
    status: str
    criteria_string: str
    criteria: Dict[str, str]


class ReconciliationAutoResolution(_ServiceModel):
    selected_reviewer: ReviewerRole
    status: str
    criteria_string: str


class ReconciliationSummaryCounts(_ServiceModel):
    auto_resolved_count: int
    manual_conflict_count: int
    pending_count: int
    blocked_count: int
    total_count: int


class ReconciliationPreviewItem(_ServiceModel):
    id: str
    title: str
    author: str
    year: str
    status: Literal["auto", "conflict", "pending", "blocked"]
    blocked_reasons: List[str]
    reviewers: List[ReconciliationReviewerEntry]
    auto_resolution: Optional[ReconciliationAutoResolution] = None


class GetManagedReviewTaskReadinessResponse(ProjectResponse):
    kind: ManagedReviewKind
    current_branch: str
    eligible_state: str
    eligible_record_ids: List[str]
    eligible_count: int
    issues: List[str]
    ready: bool
    tracking: ManagedReviewTracking


class ListManagedReviewTasksResponse(ProjectResponse):
    kind: ManagedReviewKind
    tasks: List[ManagedReviewTask]


class GetCurrentManagedReviewTaskResponse(ProjectResponse):
    kind: ManagedReviewKind
    current_branch: str
    task: Optional[ManagedReviewTask] = None


class CreateManagedReviewTaskResponse(ProjectResponse):
    task: ManagedReviewTask
    launch_ref: str
    enriched_count: int
    enrichment_failed_count: int
    enrichment_skipped_count: int


class CancelManagedReviewTaskResponse(ProjectResponse):
    task: ManagedReviewTask


class GetManagedReviewTaskQueueResponse(ProjectResponse):
    task_id: str
    kind: ManagedReviewKind
    records: List[ManagedReviewQueueRecord]
    total_count: int


class GetReconciliationPreviewResponse(ProjectResponse):
    task: ManagedReviewTask
    summary: ReconciliationSummaryCounts
    items: List[ReconciliationPreviewItem]


class ApplyReconciliationResponse(ProjectResponse):
    task_id: str
    commit_sha: str
    resolved_count: int


class ExportReconciliationAuditResponse(ProjectResponse):
    filename: str
    content: str


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class ManagedReviewHandler(BaseHandler):
    """All managed-review JSON-RPC methods. UI-native (no OperationsType)."""

    def _service(self) -> ManagedReviewService:
        assert self.review_manager is not None
        return ManagedReviewService(review_manager=self.review_manager)

    def _wrap(self, req: ProjectScopedRequest, payload: Dict[str, Any]):
        # Validate the service's dict payload into this method's declared
        # response model (taken from the registry spec, so it can't drift from
        # the @rpc_method registration). The envelope's project_id wins over
        # anything in the payload; the service's ``success: True`` key matches
        # the envelope's ``Literal[True]`` (a falsy success would fail loudly).
        model = self._spec().response_model
        return model.model_validate({**payload, "project_id": req.project_id})

    # -- get_managed_review_task_readiness ----------------------------------

    @rpc_method(
        name="get_managed_review_task_readiness",
        request=GetManagedReviewTaskReadinessRequest,
        response=GetManagedReviewTaskReadinessResponse,
        timeout_class="fast",
    )
    def get_managed_review_task_readiness(
        self, req: GetManagedReviewTaskReadinessRequest
    ) -> GetManagedReviewTaskReadinessResponse:
        return self._wrap(req, self._service().get_task_readiness(kind=req.kind))

    # -- list_managed_review_tasks ------------------------------------------

    @rpc_method(
        name="list_managed_review_tasks",
        request=ListManagedReviewTasksRequest,
        response=ListManagedReviewTasksResponse,
        timeout_class="fast",
    )
    def list_managed_review_tasks(
        self, req: ListManagedReviewTasksRequest
    ) -> ListManagedReviewTasksResponse:
        return self._wrap(req, self._service().list_tasks(kind=req.kind))

    # -- get_current_managed_review_task ------------------------------------

    @rpc_method(
        name="get_current_managed_review_task",
        request=GetCurrentManagedReviewTaskRequest,
        response=GetCurrentManagedReviewTaskResponse,
        timeout_class="fast",
    )
    def get_current_managed_review_task(
        self, req: GetCurrentManagedReviewTaskRequest
    ) -> GetCurrentManagedReviewTaskResponse:
        return self._wrap(
            req, self._service().get_current_branch_task(kind=req.kind)
        )

    # -- create_managed_review_task -----------------------------------------

    @rpc_method(
        name="create_managed_review_task",
        request=CreateManagedReviewTaskRequest,
        response=CreateManagedReviewTaskResponse,
        writes=True,
    )
    def create_managed_review_task(
        self, req: CreateManagedReviewTaskRequest
    ) -> CreateManagedReviewTaskResponse:
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
        response=CancelManagedReviewTaskResponse,
        writes=True,
    )
    def cancel_managed_review_task(
        self, req: CancelManagedReviewTaskRequest
    ) -> CancelManagedReviewTaskResponse:
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
        response=GetManagedReviewTaskQueueResponse,
        timeout_class="fast",
    )
    def get_managed_review_task_queue(
        self, req: GetManagedReviewTaskQueueRequest
    ) -> GetManagedReviewTaskQueueResponse:
        return self._wrap(
            req, self._service().get_task_queue(task_id=req.task_id)
        )

    # -- get_reconciliation_preview -----------------------------------------

    @rpc_method(
        name="get_reconciliation_preview",
        request=GetReconciliationPreviewRequest,
        response=GetReconciliationPreviewResponse,
    )
    def get_reconciliation_preview(
        self, req: GetReconciliationPreviewRequest
    ) -> GetReconciliationPreviewResponse:
        return self._wrap(
            req,
            self._service().get_reconciliation_preview(task_id=req.task_id),
        )

    # -- apply_reconciliation -----------------------------------------------

    @rpc_method(
        name="apply_reconciliation",
        request=ApplyReconciliationRequest,
        response=ApplyReconciliationResponse,
        writes=True,
    )
    def apply_reconciliation(
        self, req: ApplyReconciliationRequest
    ) -> ApplyReconciliationResponse:
        return self._wrap(
            req,
            self._service().apply_reconciliation(
                task_id=req.task_id,
                resolutions=req.resolutions,
                resolved_by=req.resolved_by,
                override_blocks=req.override_blocks,
            ),
        )

    # -- export_reconciliation_audit ----------------------------------------

    @rpc_method(
        name="export_reconciliation_audit",
        request=ExportReconciliationAuditRequest,
        response=ExportReconciliationAuditResponse,
    )
    def export_reconciliation_audit(
        self, req: ExportReconciliationAuditRequest
    ) -> ExportReconciliationAuditResponse:
        return self._wrap(
            req,
            self._service().export_reconciliation_audit(
                task_id=req.task_id,
                export_format=req.format,
            ),
        )
