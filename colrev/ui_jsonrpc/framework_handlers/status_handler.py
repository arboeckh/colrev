"""Framework-native status handler.

All read-only status / validation / info JSON-RPC methods. Mirrors the
legacy ``handlers/status_handler.py`` logic verbatim; only the surface
plumbing (request/response models + @rpc_method registration) changed.

Status payload has many deeply-nested fields — the top-level response keys
are typed; nested values stay as ``dict`` via ``ConfigDict(extra='allow')``
to avoid over-typing stable but verbose CoLRev internals.
"""

from __future__ import annotations

import io
import json
import logging
from pathlib import Path
from typing import Any
from typing import Dict
from typing import Optional
from typing import Tuple

from pydantic import ConfigDict

from colrev.constants import Fields
from colrev.constants import RecordState
from colrev.ui_jsonrpc import response_formatter
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Operation metadata (moved verbatim from legacy handler)
# ---------------------------------------------------------------------------

OPERATION_DESCRIPTIONS = {
    "search": "Search configured sources for records",
    "load": "Import search results into main records file",
    "prep": "Prepare and clean metadata for imported records",
    "dedupe": "Identify and merge duplicate records",
    "prescreen_launch": "Verify readiness and launch paired prescreen reviewer branches",
    "prescreen": "Screen records based on titles and abstracts",
    "prescreen_reconcile": "Reconcile paired prescreen decisions on dev",
    "pdf_get": "Retrieve PDF documents for included records",
    "pdf_prep": "Prepare and validate retrieved PDFs",
    "screen_launch": "Verify readiness and launch paired screen reviewer branches",
    "screen": "Full-text screening of records",
    "screen_reconcile": "Reconcile paired full-text screening decisions on dev",
    "data": "Data extraction and synthesis",
}

OPERATION_ALIASES = {
    "prescreen_launch": "prescreen",
    "prescreen_reconcile": "prescreen",
    "screen_launch": "screen",
    "screen_reconcile": "screen",
}

OPERATION_INPUT_STATES = {
    "search": None,
    "load": RecordState.md_retrieved,
    "prep": RecordState.md_imported,
    "dedupe": RecordState.md_prepared,
    "prescreen": RecordState.md_processed,
    "pdf_get": RecordState.rev_prescreen_included,
    "pdf_prep": RecordState.pdf_imported,
    "screen": RecordState.pdf_prepared,
    "data": RecordState.rev_included,
}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class GetStatusRequest(ProjectScopedRequest):
    pass


class GetStatusResponse(ProjectResponse):
    """Nested ``status`` payload is deliberately an untyped dict."""

    model_config = ConfigDict(extra="allow")

    path: str
    status: Dict[str, Any]


class ValidateRequest(ProjectScopedRequest):
    scope: str = "HEAD"
    filter_setting: str = "general"


class ValidateResponse(ProjectResponse):
    model_config = ConfigDict(extra="allow")

    operation: str
    message: str
    details: Dict[str, Any]


class GetOperationInfoRequest(ProjectScopedRequest):
    operation: str


class GetOperationInfoResponse(ProjectResponse):
    model_config = ConfigDict(extra="allow")

    operation: str
    can_run: bool
    reason: Optional[str] = None
    needs_rerun: bool
    needs_rerun_reason: Optional[str] = None
    affected_records: int
    description: str


class GetPreprocessingSummaryRequest(ProjectScopedRequest):
    pass


class GetPreprocessingSummaryResponse(ProjectResponse):
    model_config = ConfigDict(extra="allow")

    sources: list
    pipeline_counts: Dict[str, int]
    duplicates_removed: int
    stage_status: Dict[str, bool]


class GetBranchDeltaRequest(ProjectScopedRequest):
    base_branch: str = "main"
    source_branch: Optional[str] = None


class GetBranchDeltaResponse(ProjectResponse):
    model_config = ConfigDict(extra="allow")

    base_branch: str
    current_branch: str
    source_branch: str
    new_record_count: int
    removed_record_count: int
    changed_record_count: int
    delta_by_state: Dict[str, int]
    source_branch_counts: Dict[str, int]


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class StatusHandler(BaseHandler):
    """All read-only status / validation / info methods."""

    # -- get_status ----------------------------------------------------------

    @rpc_method(
        name="get_status",
        request=GetStatusRequest,
        response=GetStatusResponse,
    )
    def get_status(self, req: GetStatusRequest) -> GetStatusResponse:
        assert self.review_manager is not None
        logger.info("Getting status for project %s", req.project_id)

        status_stats = self.review_manager.get_status_stats()
        has_changes = self.review_manager.dataset.git_repo.has_changes(Path("."))
        next_operation = self._determine_next_operation(status_stats)

        payload = response_formatter.format_comprehensive_status_response(
            project_id=req.project_id,
            project_path=self.review_manager.path,
            status_stats=status_stats,
            next_operation=next_operation,
            has_changes=has_changes,
        )
        # format_comprehensive_status_response already returns the full dict
        # shape. Feed it through the response model so extras ride along.
        return GetStatusResponse(
            project_id=req.project_id,
            path=payload["path"],
            status=payload["status"],
        )

    # -- status (alias for get_status) --------------------------------------

    @rpc_method(
        name="status",
        request=GetStatusRequest,
        response=GetStatusResponse,
    )
    def status(self, req: GetStatusRequest) -> GetStatusResponse:
        return self.get_status(req)

    # -- validate ------------------------------------------------------------

    @rpc_method(
        name="validate",
        request=ValidateRequest,
        response=ValidateResponse,
    )
    def validate(self, req: ValidateRequest) -> ValidateResponse:
        assert self.review_manager is not None
        logger.info("Validating project %s", req.project_id)

        validate_operation = self.review_manager.get_validate_operation()
        result = validate_operation.main(
            scope=req.scope, filter_setting=req.filter_setting
        )

        return ValidateResponse(
            project_id=req.project_id,
            operation="validate",
            message=f"Validate operation completed successfully",
            details={"message": "Validation completed", "result": result},
        )

    # -- get_operation_info -------------------------------------------------

    @rpc_method(
        name="get_operation_info",
        request=GetOperationInfoRequest,
        response=GetOperationInfoResponse,
    )
    def get_operation_info(
        self, req: GetOperationInfoRequest
    ) -> Dict[str, Any]:
        """Returns a plain dict so nullable ``reason`` / ``needs_rerun_reason``
        survive dispatcher serialization (which strips None from Pydantic
        models)."""
        assert self.review_manager is not None

        if req.operation not in OPERATION_DESCRIPTIONS:
            valid_ops = ", ".join(OPERATION_DESCRIPTIONS.keys())
            raise ValueError(
                f"Invalid operation '{req.operation}'. Valid operations: {valid_ops}"
            )

        canonical_operation = OPERATION_ALIASES.get(req.operation, req.operation)
        logger.info(
            "Getting operation info for %s in project %s",
            req.operation, req.project_id,
        )

        status_stats = self.review_manager.get_status_stats()
        can_run, reason, affected_records = self._check_operation_runnable(
            canonical_operation, status_stats
        )
        needs_rerun, needs_rerun_reason = self._check_needs_rerun(
            canonical_operation, status_stats
        )

        return {
            "success": True,
            "project_id": req.project_id,
            "operation": req.operation,
            "can_run": can_run,
            "reason": reason,
            "needs_rerun": needs_rerun,
            "needs_rerun_reason": needs_rerun_reason,
            "affected_records": affected_records,
            "description": OPERATION_DESCRIPTIONS[req.operation],
        }

    # -- get_preprocessing_summary ------------------------------------------

    @rpc_method(
        name="get_preprocessing_summary",
        request=GetPreprocessingSummaryRequest,
        response=GetPreprocessingSummaryResponse,
    )
    def get_preprocessing_summary(
        self, req: GetPreprocessingSummaryRequest
    ) -> GetPreprocessingSummaryResponse:
        assert self.review_manager is not None
        from colrev.loader import load_utils

        logger.info(
            "Getting preprocessing summary for project %s", req.project_id
        )

        status_stats = self.review_manager.get_status_stats()
        currently = status_stats.currently

        sources_list = []
        for source in self.review_manager.settings.sources:
            results_path = (
                self.review_manager.path / source.search_results_path
            )
            search_record_count = 0
            if results_path.exists():
                try:
                    search_record_count = load_utils.get_nr_records(results_path)
                except Exception:  # noqa: BLE001
                    pass

            loaded_record_count = 0
            try:
                records_dict = self.review_manager.dataset.load_records_dict()
                if records_dict:
                    origin_prefix = Path(source.search_results_path).name
                    for record in records_dict.values():
                        origins = record.get(Fields.ORIGIN, [])
                        for origin in origins:
                            if origin.startswith(origin_prefix):
                                loaded_record_count += 1
                                break
            except Exception:  # noqa: BLE001
                pass

            sources_list.append(
                {
                    "platform": source.platform,
                    "filename": str(source.search_results_path),
                    "search_record_count": search_record_count,
                    "loaded_record_count": loaded_record_count,
                }
            )

        pipeline_counts = {
            "md_retrieved": currently.md_retrieved,
            "md_imported": currently.md_imported
            + currently.md_needs_manual_preparation,
            "md_prepared": currently.md_prepared,
            "md_processed": currently.md_processed,
        }

        stage_status = {
            "load_completed": currently.md_retrieved == 0,
            "prep_completed": (
                currently.md_imported == 0
                and currently.md_needs_manual_preparation == 0
            ),
            "dedupe_completed": currently.md_prepared == 0,
        }

        return GetPreprocessingSummaryResponse(
            project_id=req.project_id,
            sources=sources_list,
            pipeline_counts=pipeline_counts,
            duplicates_removed=status_stats.md_duplicates_removed,
            stage_status=stage_status,
        )

    # -- get_branch_delta ---------------------------------------------------

    @rpc_method(
        name="get_branch_delta",
        request=GetBranchDeltaRequest,
        response=GetBranchDeltaResponse,
    )
    def get_branch_delta(
        self, req: GetBranchDeltaRequest
    ) -> GetBranchDeltaResponse:
        assert self.review_manager is not None
        logger.info("Getting branch delta for project %s", req.project_id)

        git_repo = self.review_manager.dataset.git_repo.repo

        try:
            current_branch = git_repo.active_branch.name
        except TypeError:
            current_branch = str(git_repo.head.commit)[:8]

        source_branch = req.source_branch or current_branch

        if source_branch == current_branch:
            try:
                self.review_manager.get_status_operation()
                source_records = self.review_manager.dataset.load_records_dict()
            except Exception:  # noqa: BLE001
                source_records = {}
        else:
            source_records = self._load_records_from_branch(
                git_repo, source_branch
            )

        base_records = self._load_records_from_branch(git_repo, req.base_branch)

        source_ids = set(source_records.keys())
        base_ids = set(base_records.keys())

        new_ids = source_ids - base_ids
        removed_ids = base_ids - source_ids
        common_ids = source_ids & base_ids

        changed_count = 0
        for rid in common_ids:
            cur_status = str(source_records[rid].get(Fields.STATUS, ""))
            base_status = str(base_records[rid].get(Fields.STATUS, ""))
            if cur_status != base_status:
                changed_count += 1

        delta_by_state: Dict[str, int] = {}
        for rid in new_ids:
            status = str(
                source_records[rid].get(Fields.STATUS, "unknown")
            )
            if hasattr(status, "name"):
                status = status.name  # type: ignore[attr-defined]
            delta_by_state[status] = delta_by_state.get(status, 0) + 1

        source_branch_counts: Dict[str, int] = {}
        for record in source_records.values():
            status = str(record.get(Fields.STATUS, "unknown"))
            if hasattr(status, "name"):
                status = status.name  # type: ignore[attr-defined]
            source_branch_counts[status] = (
                source_branch_counts.get(status, 0) + 1
            )

        return GetBranchDeltaResponse(
            project_id=req.project_id,
            base_branch=req.base_branch,
            current_branch=current_branch,
            source_branch=source_branch,
            new_record_count=len(new_ids),
            removed_record_count=len(removed_ids),
            changed_record_count=changed_count,
            delta_by_state=delta_by_state,
            source_branch_counts=source_branch_counts,
        )

    # -- helpers -------------------------------------------------------------

    def _determine_next_operation(self, status_stats) -> Optional[str]:
        currently = status_stats.currently

        if currently.md_retrieved > 0:
            return "load"
        if currently.md_imported > 0 or currently.md_needs_manual_preparation > 0:
            return "prep"
        if currently.md_prepared > 0:
            return "dedupe"
        if currently.md_processed > 0:
            return "prescreen"
        if (
            currently.rev_prescreen_included > 0
            or currently.pdf_needs_manual_retrieval > 0
        ):
            return "pdf_get"
        if currently.pdf_imported > 0 or currently.pdf_needs_manual_preparation > 0:
            return "pdf_prep"
        if currently.pdf_prepared > 0:
            return "screen"
        if currently.rev_included > 0:
            return "data"
        return None

    def _check_operation_runnable(
        self, operation: str, status_stats
    ) -> Tuple[bool, Optional[str], int]:
        currently = status_stats.currently
        affected_records = 0
        reason: Optional[str] = None

        if operation == "search":
            sources = self.review_manager.settings.sources
            if not sources:
                return False, "No search sources configured", 0
            return True, None, len(sources)

        elif operation == "load":
            affected_records = currently.md_retrieved
            if affected_records == 0:
                return False, "No records to load (run search first)", 0

        elif operation == "prep":
            affected_records = (
                currently.md_imported + currently.md_needs_manual_preparation
            )
            if affected_records == 0:
                return False, "No records to prepare (run load first)", 0

        elif operation == "dedupe":
            affected_records = currently.md_prepared
            if affected_records == 0:
                return False, "No records to deduplicate (run prep first)", 0

        elif operation == "prescreen":
            affected_records = currently.md_processed
            if affected_records == 0:
                return False, "No records to prescreen (run dedupe first)", 0

        elif operation == "pdf_get":
            affected_records = (
                currently.rev_prescreen_included
                + currently.pdf_needs_manual_retrieval
            )
            if affected_records == 0:
                return False, "No records need PDF retrieval (run prescreen first)", 0

        elif operation == "pdf_prep":
            affected_records = (
                currently.pdf_imported + currently.pdf_needs_manual_preparation
            )
            if affected_records == 0:
                return False, "No PDFs to prepare (run pdf_get first)", 0

        elif operation == "screen":
            affected_records = currently.pdf_prepared
            if affected_records == 0:
                return False, "No records to screen (run pdf_prep first)", 0

        elif operation == "data":
            affected_records = currently.rev_included
            if affected_records == 0:
                return False, "No records for data extraction (run screen first)", 0

        return True, reason, affected_records

    def _check_needs_rerun(
        self, operation: str, status_stats
    ) -> Tuple[bool, Optional[str]]:
        if operation == "search":
            return self._check_search_needs_rerun()

        currently = status_stats.currently
        input_state = OPERATION_INPUT_STATES.get(operation)
        if input_state is None:
            return False, None

        state_counts = {
            RecordState.md_retrieved: currently.md_retrieved,
            RecordState.md_imported: (
                currently.md_imported + currently.md_needs_manual_preparation
            ),
            RecordState.md_prepared: currently.md_prepared,
            RecordState.md_processed: currently.md_processed,
            RecordState.rev_prescreen_included: (
                currently.rev_prescreen_included
                + currently.pdf_needs_manual_retrieval
            ),
            RecordState.pdf_imported: (
                currently.pdf_imported + currently.pdf_needs_manual_preparation
            ),
            RecordState.pdf_prepared: currently.pdf_prepared,
            RecordState.rev_included: currently.rev_included,
        }

        count = state_counts.get(input_state, 0)
        if count > 0:
            return True, f"{count} record(s) pending for {operation}"
        return False, None

    def _check_search_needs_rerun(self) -> Tuple[bool, Optional[str]]:
        assert self.review_manager is not None
        sources = self.review_manager.settings.sources
        if not sources:
            return False, None

        modified_sources = []
        for source in sources:
            history_path = (
                self.review_manager.path / source.get_search_history_path()
            )
            if not history_path.is_file():
                modified_sources.append(source.platform)
                continue
            try:
                with open(history_path, "r", encoding="utf-8") as f:
                    history = json.load(f)
                if self._source_settings_changed(source, history):
                    modified_sources.append(source.platform)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(
                    "Error reading search history %s: %s", history_path, e
                )
                modified_sources.append(source.platform)

        if modified_sources:
            if len(modified_sources) == 1:
                return True, f"{modified_sources[0]} settings modified since last run"
            return True, f"{len(modified_sources)} sources modified since last run"
        return False, None

    def _source_settings_changed(self, source, history: dict) -> bool:
        current_query = getattr(source, "search_string", "") or ""
        history_query = history.get("search_string", "") or ""
        if current_query != history_query:
            return True
        current_params = getattr(source, "search_parameters", {}) or {}
        history_params = history.get("search_parameters", {}) or {}
        if current_params != history_params:
            return True
        return False

    def _load_records_from_branch(
        self, git_repo, branch_name: str
    ) -> Dict[str, Dict[str, Any]]:
        from colrev.loader.bib import process_lines

        try:
            commit = git_repo.commit(branch_name)
            blob = commit.tree / "data" / "records.bib"
            content = blob.data_stream.read().decode("utf-8")
            text_io = io.StringIO(content)
            records_list = process_lines(text_io, header_only=True)
            return {r[Fields.ID]: r for r in records_list}
        except Exception as e:  # noqa: BLE001
            logger.debug(
                "Could not load records from branch %s: %s", branch_name, e
            )
            return {}
