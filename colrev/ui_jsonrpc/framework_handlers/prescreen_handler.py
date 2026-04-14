"""Framework-native prescreen handler.

Implements all prescreen RPC methods atop the typed framework.

Commit behavior: writes stage changes via
``dataset.save_records_dict(partial=True)`` and never commit. Commits are
driven explicitly by the ``commit_changes`` endpoint in ``git_handler``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from typing import List
from typing import Literal
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

import colrev.record.record
import colrev.search_file
from colrev.constants import Fields
from colrev.constants import OperationsType
from colrev.constants import RecordState
from colrev.constants import SearchType
from colrev.managed_review import ManagedReviewService
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProgressEvent
from colrev.ui_jsonrpc.framework import ProgressEventKind
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import emit_progress
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)

Decision = Literal["include", "exclude"]


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class PrescreenBatchRequest(ProjectScopedRequest):
    split_str: str = "NA"


class PrescreenBatchResponse(ProjectResponse):
    operation: str
    message: str
    split_str: str


class GetPrescreenQueueRequest(ProjectScopedRequest):
    limit: int = 50
    task_id: Optional[str] = None


class QueueRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str = ""
    author: str = ""
    year: str = ""
    can_enrich: bool = False


class GetPrescreenQueueResponse(ProjectResponse):
    total_count: int
    records: List[QueueRecord]


class PrescreenRecordRequest(ProjectScopedRequest):
    record_id: str
    decision: Decision
    task_id: Optional[str] = None


class PrescreenedRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    decision: Decision
    new_status: str


class PrescreenRecordResponse(ProjectResponse):
    record: PrescreenedRecord
    remaining_count: int
    already_decided: bool = False


class PrescreenDecisionChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_id: str
    decision: Decision


class UpdatePrescreenDecisionsRequest(ProjectScopedRequest):
    changes: List[PrescreenDecisionChange]


class SkippedChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_id: str
    reason: str


class UpdatePrescreenDecisionsResponse(ProjectResponse):
    changes_count: int
    skipped: List[SkippedChange]
    updated_records: List[str]
    message: str


class EnrichRecordMetadataRequest(ProjectScopedRequest):
    record_id: str
    fields: Optional[List[str]] = None


class EnrichedRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str = ""
    author: str = ""
    year: str = ""
    can_enrich: bool = False


class EnrichRecordMetadataResponse(ProjectResponse):
    record: EnrichedRecord
    enriched_fields: List[str]
    source: Optional[str] = None
    message: Optional[str] = None


class BatchEnrichRecordsRequest(ProjectScopedRequest):
    record_ids: List[str]
    fields: Optional[List[str]] = None


class BatchEnrichItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    success: bool


class BatchEnrichRecordsResponse(ProjectResponse):
    enriched_count: int
    failed_count: int
    records: List[BatchEnrichItem]


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class PrescreenHandler(BaseHandler):
    """All prescreen JSON-RPC methods."""

    # -- prescreen_record ----------------------------------------------------

    @rpc_method(
        name="prescreen_record",
        request=PrescreenRecordRequest,
        response=PrescreenRecordResponse,
        operation_type=OperationsType.prescreen,
        notify=True,
        writes=True,
    )
    def prescreen_record(self, req: PrescreenRecordRequest) -> PrescreenRecordResponse:
        assert self.review_manager is not None
        logger.info(
            "Prescreening record %s as %s in project %s",
            req.record_id, req.decision, req.project_id,
        )

        task_record_ids = self._task_record_ids(req.task_id)
        prescreen_op = self.op(OperationsType.prescreen, notify=True)

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
            RecordState.rev_prescreen_included
            if req.decision == "include"
            else RecordState.rev_prescreen_excluded
        )
        already_decided = current_status == target_status

        valid_source_states = {
            RecordState.md_processed,
            RecordState.rev_prescreen_included,
            RecordState.rev_prescreen_excluded,
        }
        if not already_decided and current_status not in valid_source_states:
            raise ValueError(
                f"Record '{req.record_id}' is not ready for prescreen "
                f"(current status: {current_status})"
            )

        if not already_decided:
            record = colrev.record.record.Record(record_dict)
            prescreen_op.prescreen(
                record=record,
                prescreen_inclusion=(req.decision == "include"),
            )

        remaining_count = sum(
            1
            for r in records_dict.values()
            if r.get(Fields.STATUS) == RecordState.md_processed
            and r.get(Fields.ID) != req.record_id
            and (task_record_ids is None or r.get(Fields.ID) in task_record_ids)
        )

        return PrescreenRecordResponse(
            project_id=req.project_id,
            record=PrescreenedRecord(
                id=req.record_id,
                decision=req.decision,
                new_status=target_status.name,
            ),
            remaining_count=remaining_count,
            already_decided=already_decided,
        )

    # -- prescreen (batch) ---------------------------------------------------

    @rpc_method(
        name="prescreen",
        request=PrescreenBatchRequest,
        response=PrescreenBatchResponse,
        operation_type=OperationsType.prescreen,
        notify=True,
        writes=True,
    )
    def prescreen(self, req: PrescreenBatchRequest) -> PrescreenBatchResponse:
        assert self.review_manager is not None
        logger.info("Running prescreen operation for project %s", req.project_id)
        prescreen_operation = self.op(OperationsType.prescreen, notify=True)
        prescreen_operation.main(split_str=req.split_str)
        return PrescreenBatchResponse(
            project_id=req.project_id,
            operation="prescreen",
            message="Prescreen completed",
            split_str=req.split_str,
        )

    # -- get_prescreen_queue -------------------------------------------------

    @rpc_method(
        name="get_prescreen_queue",
        request=GetPrescreenQueueRequest,
        response=GetPrescreenQueueResponse,
        operation_type=OperationsType.prescreen,
        notify=False,
        writes=False,
    )
    def get_prescreen_queue(
        self, req: GetPrescreenQueueRequest
    ) -> GetPrescreenQueueResponse:
        assert self.review_manager is not None
        task_record_ids = self._task_record_ids(req.task_id)
        self.op(OperationsType.prescreen, notify=False)
        records_dict = self.review_manager.dataset.load_records_dict() or {}
        prescreen_records = [
            r
            for r in records_dict.values()
            if r.get(Fields.STATUS) == RecordState.md_processed
            and (task_record_ids is None or r.get(Fields.ID) in task_record_ids)
        ]
        total_count = len(prescreen_records)
        formatted = [
            QueueRecord(**_format_queue_record(r))
            for r in prescreen_records[: req.limit]
        ]
        return GetPrescreenQueueResponse(
            project_id=req.project_id,
            total_count=total_count,
            records=formatted,
        )

    # -- update_prescreen_decisions ------------------------------------------

    @rpc_method(
        name="update_prescreen_decisions",
        request=UpdatePrescreenDecisionsRequest,
        response=UpdatePrescreenDecisionsResponse,
        operation_type=OperationsType.prescreen,
        notify=True,
        writes=True,
    )
    def update_prescreen_decisions(
        self, req: UpdatePrescreenDecisionsRequest
    ) -> UpdatePrescreenDecisionsResponse:
        assert self.review_manager is not None
        if not req.changes:
            raise ValueError("changes parameter is required and must be a non-empty list")

        prescreen_op = self.op(OperationsType.prescreen, notify=True)
        records_dict = self.review_manager.dataset.load_records_dict() or {}

        valid_states = {
            RecordState.rev_prescreen_included,
            RecordState.rev_prescreen_excluded,
        }
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
                RecordState.rev_prescreen_included
                if change.decision == "include"
                else RecordState.rev_prescreen_excluded
            )
            if current_status == target:
                continue
            record = colrev.record.record.Record(record_dict)
            prescreen_op.prescreen(
                record=record, prescreen_inclusion=(change.decision == "include")
            )
            updated_ids.append(change.record_id)

        msg = f"Updated {len(updated_ids)} record(s)"
        if skipped:
            msg += f", skipped {len(skipped)}"

        return UpdatePrescreenDecisionsResponse(
            project_id=req.project_id,
            changes_count=len(updated_ids),
            skipped=skipped,
            updated_records=updated_ids,
            message=msg,
        )

    # -- enrich_record_metadata ---------------------------------------------

    @rpc_method(
        name="enrich_record_metadata",
        request=EnrichRecordMetadataRequest,
        response=EnrichRecordMetadataResponse,
        writes=True,
    )
    def enrich_record_metadata(
        self, req: EnrichRecordMetadataRequest
    ) -> EnrichRecordMetadataResponse:
        assert self.review_manager is not None
        logger.info("Enriching record %s in project %s", req.record_id, req.project_id)

        prep_operation = self.review_manager.get_prep_operation()
        records_dict = self.review_manager.dataset.load_records_dict() or {}
        if req.record_id not in records_dict:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records_dict[req.record_id]
        if Fields.ABSTRACT in record_dict and record_dict[Fields.ABSTRACT]:
            return EnrichRecordMetadataResponse(
                project_id=req.project_id,
                record=EnrichedRecord(
                    id=req.record_id,
                    title=record_dict.get(Fields.TITLE, ""),
                    author=record_dict.get(Fields.AUTHOR, ""),
                    year=record_dict.get(Fields.YEAR, ""),
                    abstract=record_dict[Fields.ABSTRACT],
                    can_enrich=False,
                ),
                enriched_fields=[],
                source=None,
                message="Abstract already present",
            )

        result = self._enrich_single_record(record_dict, prep_operation)
        if result["success"]:
            self.review_manager.dataset.save_records_dict(
                {req.record_id: result["record_data"]}, partial=True
            )

        return EnrichRecordMetadataResponse(
            project_id=req.project_id,
            record=EnrichedRecord(**result["record"]),
            enriched_fields=result["enriched_fields"],
            source=result["source"],
            message=None,
        )

    # -- batch_enrich_records -----------------------------------------------

    @rpc_method(
        name="batch_enrich_records",
        request=BatchEnrichRecordsRequest,
        response=BatchEnrichRecordsResponse,
        writes=True,
    )
    def batch_enrich_records(
        self, req: BatchEnrichRecordsRequest
    ) -> BatchEnrichRecordsResponse:
        assert self.review_manager is not None
        if not req.record_ids:
            raise ValueError("record_ids parameter is required and must not be empty")

        prep_operation = self.review_manager.get_prep_operation()
        records_dict = self.review_manager.dataset.load_records_dict() or {}

        enriched_count = 0
        failed_count = 0
        results: List[BatchEnrichItem] = []
        records_to_save: dict = {}

        total = len(req.record_ids)
        for idx, record_id in enumerate(req.record_ids, start=1):
            emit_progress(
                ProgressEvent(
                    kind=ProgressEventKind.prep_progress,
                    message=f"Enriching {record_id}",
                    current=idx,
                    total=total,
                    source="batch_enrich_records",
                )
            )
            if record_id not in records_dict:
                logger.warning("Record '%s' not found, skipping", record_id)
                failed_count += 1
                results.append(
                    BatchEnrichItem(id=record_id, success=False, error="Record not found")
                )
                continue

            record_dict = records_dict[record_id]
            if Fields.ABSTRACT in record_dict and record_dict[Fields.ABSTRACT]:
                results.append(
                    BatchEnrichItem(
                        id=record_id,
                        success=True,
                        enriched_fields=[],
                        message="Abstract already present",
                    )
                )
                continue

            try:
                result = self._enrich_single_record(record_dict, prep_operation)
                if result["success"]:
                    enriched_count += 1
                    records_to_save[record_id] = result["record_data"]
                results.append(
                    BatchEnrichItem(
                        id=record_id,
                        success=result["success"],
                        enriched_fields=result["enriched_fields"],
                        source=result["source"],
                        record=result["record"],
                    )
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("Failed to enrich record %s: %s", record_id, e)
                failed_count += 1
                results.append(BatchEnrichItem(id=record_id, success=False, error=str(e)))

        if records_to_save:
            self.review_manager.dataset.save_records_dict(records_to_save, partial=True)

        return BatchEnrichRecordsResponse(
            project_id=req.project_id,
            enriched_count=enriched_count,
            failed_count=failed_count,
            records=results,
        )

    # -- helpers --------------------------------------------------------------

    def _task_record_ids(self, task_id: Optional[str]):
        """Managed-review gate: if a task_id is given, constrain allowed records
        to that task's assigned set and require we're on a reviewer branch."""
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
                "Managed prescreen tasks can only be reviewed from an assigned "
                "reviewer branch."
            )
        return set(task["record_ids"])

    def _get_crossref_source(self):
        try:
            import colrev.packages.crossref.src.crossref_search_source as crossref_connector

            crossref_md_filename = Path("data/search/md_crossref.bib")
            existing = [
                s for s in self.review_manager.settings.sources
                if s.search_results_path == crossref_md_filename
            ]
            if existing:
                search_file = existing[0]
            else:
                search_file = colrev.search_file.ExtendedSearchFile(
                    platform="colrev.crossref",
                    search_results_path=crossref_md_filename,
                    search_type=SearchType.MD,
                    search_string="",
                    comment="",
                    version=crossref_connector.CrossrefSearchSource.CURRENT_SYNTAX_VERSION,
                )
            return crossref_connector.CrossrefSearchSource(search_file=search_file)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to initialize Crossref source: %s", e)
            return None

    def _get_pubmed_source(self):
        try:
            import colrev.packages.pubmed.src.pubmed as pubmed_connector

            pubmed_md_filename = Path("data/search/md_pubmed.bib")
            existing = [
                s for s in self.review_manager.settings.sources
                if s.search_results_path == pubmed_md_filename
            ]
            if existing:
                search_file = existing[0]
            else:
                search_file = colrev.search_file.ExtendedSearchFile(
                    platform="colrev.pubmed",
                    search_results_path=pubmed_md_filename,
                    search_type=SearchType.MD,
                    search_string="",
                    comment="",
                    version=pubmed_connector.PubMedSearchSource.CURRENT_SYNTAX_VERSION,
                )
            return pubmed_connector.PubMedSearchSource(search_file=search_file)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to initialize PubMed source: %s", e)
            return None

    def _enrich_single_record(self, record_dict: dict, prep_operation: Any) -> dict:
        record_id = record_dict.get(Fields.ID)
        original_abstract = record_dict.get(Fields.ABSTRACT, "")
        record = colrev.record.record.Record(record_dict.copy())

        enriched_fields: List[str] = []
        source_used: Optional[str] = None

        if Fields.DOI in record_dict and record_dict[Fields.DOI]:
            crossref_source = self._get_crossref_source()
            if crossref_source:
                try:
                    record = crossref_source.prep_link_md(
                        prep_operation=prep_operation,
                        record=record,
                        save_feed=False,
                        timeout=15,
                    )
                    source_used = "crossref"
                except Exception as e:  # noqa: BLE001
                    logger.warning("Crossref enrichment failed for %s: %s", record_id, e)

        new_abstract = record.data.get(Fields.ABSTRACT, "")
        if (
            not new_abstract
            and Fields.PUBMED_ID in record_dict
            and record_dict[Fields.PUBMED_ID]
        ):
            pubmed_source = self._get_pubmed_source()
            if pubmed_source:
                try:
                    record = pubmed_source.prep_link_md(
                        prep_operation=prep_operation,
                        record=record,
                        save_feed=False,
                        timeout=15,
                    )
                    source_used = "pubmed"
                except Exception as e:  # noqa: BLE001
                    logger.warning("PubMed enrichment failed for %s: %s", record_id, e)

        # prep_link_md resets status to md_prepared — restore original.
        record.data[Fields.STATUS] = record_dict.get(Fields.STATUS)

        new_abstract = record.data.get(Fields.ABSTRACT, "")
        if new_abstract and new_abstract != original_abstract:
            enriched_fields.append("abstract")

        enriched_record = {
            "id": record.data.get(Fields.ID),
            "title": record.data.get(Fields.TITLE, ""),
            "author": record.data.get(Fields.AUTHOR, ""),
            "year": record.data.get(Fields.YEAR, ""),
        }
        for field in (
            Fields.ABSTRACT,
            Fields.JOURNAL,
            Fields.BOOKTITLE,
            Fields.DOI,
            Fields.PUBMED_ID,
        ):
            if field in record.data:
                key = "pubmedid" if field == Fields.PUBMED_ID else field
                enriched_record[key] = record.data[field]
        enriched_record["can_enrich"] = False

        return {
            "success": len(enriched_fields) > 0,
            "enriched_fields": enriched_fields,
            "source": source_used,
            "record": enriched_record,
            "record_data": record.data,
        }


def _format_queue_record(record: dict) -> dict:
    formatted: dict = {
        "id": record.get(Fields.ID),
        "title": record.get(Fields.TITLE, ""),
        "author": record.get(Fields.AUTHOR, ""),
        "year": record.get(Fields.YEAR, ""),
    }
    if Fields.ABSTRACT in record:
        formatted["abstract"] = record[Fields.ABSTRACT]
    if Fields.JOURNAL in record:
        formatted["journal"] = record[Fields.JOURNAL]
    if Fields.BOOKTITLE in record:
        formatted["booktitle"] = record[Fields.BOOKTITLE]
    if Fields.DOI in record:
        formatted["doi"] = record[Fields.DOI]
    if Fields.PUBMED_ID in record:
        formatted["pubmedid"] = record[Fields.PUBMED_ID]
    has_abstract = Fields.ABSTRACT in record and record[Fields.ABSTRACT]
    has_enrichable_id = Fields.DOI in record or Fields.PUBMED_ID in record
    formatted["can_enrich"] = not has_abstract and has_enrichable_id
    return formatted
