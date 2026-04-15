"""Framework-native screen handler.

All full-text screening JSON-RPC methods. Writes stage changes only; commits
are driven explicitly via the ``commit_changes`` endpoint in ``git_handler``.
"""

from __future__ import annotations

import logging
from typing import Dict
from typing import List
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

import colrev.record.record
from colrev.constants import Fields
from colrev.constants import OperationsType
from colrev.constants import RecordState
from colrev.managed_review import ManagedReviewService
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)

Decision = Literal["include", "exclude"]
CriterionValue = Literal["in", "out", "TODO"]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ScreenBatchRequest(ProjectScopedRequest):
    split_str: str = "NA"


class ScreenBatchResponse(ProjectResponse):
    operation: str
    message: str


class GetScreenQueueRequest(ProjectScopedRequest):
    limit: int = 50
    task_id: Optional[str] = None


class ScreenCriterionInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    explanation: str = ""
    comment: str = ""
    criterion_type: str = ""


class ScreenQueueRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str = ""
    author: str = ""
    year: str = ""


class GetScreenQueueResponse(ProjectResponse):
    total_count: int
    criteria: Dict[str, ScreenCriterionInfo]
    records: List[ScreenQueueRecord]


class ScreenRecordRequest(ProjectScopedRequest):
    record_id: str
    decision: Decision
    criteria_decisions: Dict[str, CriterionValue] = {}
    task_id: Optional[str] = None


class ScreenedRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    decision: Decision
    new_status: str
    criteria_decisions: Dict[str, CriterionValue]


class ScreenRecordResponse(ProjectResponse):
    record: ScreenedRecord
    remaining_count: int
    already_decided: bool = False


class ScreenDecisionChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_id: str
    decision: Decision


class UpdateScreenDecisionsRequest(ProjectScopedRequest):
    changes: List[ScreenDecisionChange]


class SkippedChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_id: str
    reason: str


class UpdateScreenDecisionsResponse(ProjectResponse):
    changes_count: int
    skipped: List[SkippedChange]
    updated_records: List[str]
    message: str


class IncludeAllScreenRequest(ProjectScopedRequest):
    pass


class IncludeAllScreenResponse(ProjectResponse):
    operation: str
    message: str


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class ScreenHandler(BaseHandler):
    """All screen JSON-RPC methods."""

    # -- screen (batch) -----------------------------------------------------

    @rpc_method(
        name="screen",
        request=ScreenBatchRequest,
        response=ScreenBatchResponse,
        operation_type=OperationsType.screen,
        notify=True,
        writes=True,
    )
    def screen(self, req: ScreenBatchRequest) -> ScreenBatchResponse:
        assert self.review_manager is not None
        logger.info("Running screen operation for project %s", req.project_id)
        screen_operation = self.op(OperationsType.screen, notify=True)
        screen_operation.main(split_str=req.split_str)
        return ScreenBatchResponse(
            project_id=req.project_id,
            operation="screen",
            message="Screening completed",
        )

    # -- get_screen_queue ---------------------------------------------------

    @rpc_method(
        name="get_screen_queue",
        request=GetScreenQueueRequest,
        response=GetScreenQueueResponse,
        operation_type=OperationsType.screen,
        notify=False,
        writes=False,
    )
    def get_screen_queue(self, req: GetScreenQueueRequest) -> GetScreenQueueResponse:
        assert self.review_manager is not None
        task_record_ids = self._task_record_ids(req.task_id)

        screen_settings = self.review_manager.settings.screen
        criteria: Dict[str, ScreenCriterionInfo] = {}
        if hasattr(screen_settings, "criteria") and screen_settings.criteria:
            for name, c in screen_settings.criteria.items():
                ct = getattr(c, "criterion_type", "")
                criteria[name] = ScreenCriterionInfo(
                    explanation=getattr(c, "explanation", ""),
                    comment=getattr(c, "comment", "") or "",
                    criterion_type=ct.value if hasattr(ct, "value") else str(ct),
                )

        self.op(OperationsType.screen, notify=False)
        records_dict = self.review_manager.dataset.load_records_dict() or {}

        screen_records = [
            r
            for r in records_dict.values()
            if r.get(Fields.STATUS) == RecordState.pdf_prepared
            and (task_record_ids is None or r.get(Fields.ID) in task_record_ids)
        ]
        total_count = len(screen_records)

        formatted: List[ScreenQueueRecord] = []
        for r in screen_records[: req.limit]:
            payload: dict = {
                "id": r.get(Fields.ID),
                "title": r.get(Fields.TITLE, ""),
                "author": r.get(Fields.AUTHOR, ""),
                "year": r.get(Fields.YEAR, ""),
            }
            for fld in (Fields.ABSTRACT, Fields.JOURNAL, Fields.BOOKTITLE):
                if fld in r:
                    payload[fld] = r[fld]
            if Fields.FILE in r:
                payload["pdf_path"] = r[Fields.FILE]
            if Fields.SCREENING_CRITERIA in r:
                payload["current_criteria"] = _parse_criteria_string(
                    r[Fields.SCREENING_CRITERIA]
                )
            formatted.append(ScreenQueueRecord(**payload))

        return GetScreenQueueResponse(
            project_id=req.project_id,
            total_count=total_count,
            criteria=criteria,
            records=formatted,
        )

    # -- screen_record ------------------------------------------------------

    @rpc_method(
        name="screen_record",
        request=ScreenRecordRequest,
        response=ScreenRecordResponse,
        operation_type=OperationsType.screen,
        notify=True,
        writes=True,
    )
    def screen_record(self, req: ScreenRecordRequest) -> ScreenRecordResponse:
        assert self.review_manager is not None
        logger.info(
            "Screening record %s as %s in project %s",
            req.record_id, req.decision, req.project_id,
        )

        task_record_ids = self._task_record_ids(req.task_id)
        screen_op = self.op(OperationsType.screen, notify=True)

        records_dict = self.review_manager.dataset.load_records_dict() or {}
        if req.record_id not in records_dict:
            raise ValueError(f"Record '{req.record_id}' not found")
        if task_record_ids is not None and req.record_id not in task_record_ids:
            raise ValueError(
                f"Record '{req.record_id}' is not part of this managed review task"
            )

        record_dict = records_dict[req.record_id]
        current_status = record_dict.get(Fields.STATUS)
        target_status = (
            RecordState.rev_included
            if req.decision == "include"
            else RecordState.rev_excluded
        )
        already_decided = current_status == target_status

        valid_source_states = {
            RecordState.pdf_prepared,
            RecordState.rev_included,
            RecordState.rev_excluded,
        }
        if not already_decided and current_status not in valid_source_states:
            raise ValueError(
                f"Record '{req.record_id}' is not ready for screening "
                f"(current status: {current_status})"
            )

        # Build criteria string from decisions.
        if req.criteria_decisions:
            criteria_str = ";".join(
                f"{k}={v}" for k, v in req.criteria_decisions.items()
            )
        else:
            criteria_str = "NA"

        record = colrev.record.record.Record(record_dict)
        if not already_decided:
            screen_op.screen(
                record=record,
                screen_inclusion=(req.decision == "include"),
                screening_criteria=criteria_str,
            )

        remaining_count = sum(
            1
            for r in records_dict.values()
            if r.get(Fields.STATUS) == RecordState.pdf_prepared
            and r.get(Fields.ID) != req.record_id
            and (task_record_ids is None or r.get(Fields.ID) in task_record_ids)
        )

        new_status = record.get_data().get(Fields.STATUS)
        return ScreenRecordResponse(
            project_id=req.project_id,
            record=ScreenedRecord(
                id=req.record_id,
                decision=req.decision,
                new_status=new_status.name if new_status else target_status.name,
                criteria_decisions=req.criteria_decisions,
            ),
            remaining_count=remaining_count,
            already_decided=already_decided,
        )

    # -- update_screen_decisions --------------------------------------------

    @rpc_method(
        name="update_screen_decisions",
        request=UpdateScreenDecisionsRequest,
        response=UpdateScreenDecisionsResponse,
        operation_type=OperationsType.screen,
        notify=True,
        writes=True,
    )
    def update_screen_decisions(
        self, req: UpdateScreenDecisionsRequest
    ) -> UpdateScreenDecisionsResponse:
        assert self.review_manager is not None
        if not req.changes:
            raise ValueError("changes parameter is required and must be a non-empty list")

        screen_op = self.op(OperationsType.screen, notify=True)
        records_dict = self.review_manager.dataset.load_records_dict() or {}

        valid_states = {RecordState.rev_included, RecordState.rev_excluded}
        skipped: List[SkippedChange] = []
        updated_ids: List[str] = []

        for change in req.changes:
            if change.record_id not in records_dict:
                skipped.append(
                    SkippedChange(record_id=change.record_id, reason="Record not found")
                )
                continue
            record_dict = records_dict[change.record_id]
            current_status = record_dict.get(Fields.STATUS)
            if current_status not in valid_states:
                skipped.append(
                    SkippedChange(
                        record_id=change.record_id,
                        reason=f"Invalid state: {current_status}",
                    )
                )
                continue
            target = (
                RecordState.rev_included
                if change.decision == "include"
                else RecordState.rev_excluded
            )
            if current_status == target:
                continue

            # Preserve existing criteria when flipping to excluded; for flipping
            # to included, screen_op.screen builds a default ("all-in") set.
            existing_criteria = record_dict.get(Fields.SCREENING_CRITERIA, "NA")
            record = colrev.record.record.Record(record_dict)
            screen_op.screen(
                record=record,
                screen_inclusion=(change.decision == "include"),
                screening_criteria=(
                    existing_criteria if change.decision == "exclude" else "NA"
                ),
            )
            updated_ids.append(change.record_id)

        msg = f"Updated {len(updated_ids)} record(s)"
        if skipped:
            msg += f", skipped {len(skipped)}"

        return UpdateScreenDecisionsResponse(
            project_id=req.project_id,
            changes_count=len(updated_ids),
            skipped=skipped,
            updated_records=updated_ids,
            message=msg,
        )

    # -- include_all_screen -------------------------------------------------

    @rpc_method(
        name="include_all_screen",
        request=IncludeAllScreenRequest,
        response=IncludeAllScreenResponse,
        operation_type=OperationsType.screen,
        notify=False,  # legacy used False; operation.include_all_in_screen doesn't need model checks
        writes=True,
    )
    def include_all_screen(
        self, req: IncludeAllScreenRequest
    ) -> IncludeAllScreenResponse:
        assert self.review_manager is not None
        logger.info("Including all records in screen for project %s", req.project_id)
        screen_operation = self.op(OperationsType.screen, notify=False)
        screen_operation.include_all_in_screen(persist=False)
        return IncludeAllScreenResponse(
            project_id=req.project_id,
            operation="include_all_screen",
            message="All records included in screen",
        )

    # -- helpers -------------------------------------------------------------

    def _task_record_ids(self, task_id: Optional[str]):
        if not task_id:
            return None
        assert self.review_manager is not None
        service = ManagedReviewService(review_manager=self.review_manager)
        manifest = service.load_manifest()
        task = service._find_task(manifest=manifest, task_id=task_id)
        current_branch = service._get_current_branch()
        allowed_branches = {r["branch_name"] for r in task["reviewers"]}
        if current_branch not in allowed_branches:
            raise ValueError(
                "Managed screen tasks can only be reviewed from an assigned reviewer branch."
            )
        return set(task["record_ids"])


def _parse_criteria_string(criteria_str: str) -> Dict[str, str]:
    """Parse "criterion1=in;criterion2=out" into a dict."""
    if not criteria_str or criteria_str == "NA":
        return {}
    result: Dict[str, str] = {}
    for part in criteria_str.split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            result[key.strip()] = value.strip()
    return result
