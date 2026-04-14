"""Framework-native manual prep handler."""

from __future__ import annotations

import logging
from typing import Any
from typing import Dict
from typing import List

import colrev.record.record_prep
from colrev.constants import Fields
from colrev.constants import OperationsType
from colrev.constants import RecordState
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


class PrepManUpdateRecordRequest(ProjectScopedRequest):
    record_id: str
    fields: Dict[str, Any]


class PrepManUpdateRecordResponse(ProjectResponse):
    operation: str
    details: dict


class PrepManHandler(BaseHandler):
    """Manual preparation JSON-RPC methods."""

    @rpc_method(
        name="prep_man_update_record",
        request=PrepManUpdateRecordRequest,
        response=PrepManUpdateRecordResponse,
        operation_type=OperationsType.prep_man,
        notify=False,
        writes=True,
    )
    def prep_man_update_record(
        self, req: PrepManUpdateRecordRequest
    ) -> PrepManUpdateRecordResponse:
        assert self.review_manager is not None

        if not req.record_id:
            raise ValueError("record_id parameter is required")
        if not req.fields:
            raise ValueError("fields parameter is required")

        logger.info(
            "Manual prep update for record %s in project %s",
            req.record_id, req.project_id,
        )

        protected_fields = {
            Fields.ID,
            Fields.ORIGIN,
            Fields.MD_PROV,
            Fields.D_PROV,
        }
        for field in protected_fields:
            if field in req.fields:
                raise ValueError(f"Cannot update protected field: {field}")

        self.review_manager.get_status_operation()
        records_dict = self.review_manager.dataset.load_records_dict()

        if req.record_id not in records_dict:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records_dict[req.record_id]
        if (
            record_dict.get(Fields.STATUS)
            != RecordState.md_needs_manual_preparation
        ):
            raise ValueError(
                f"Record '{req.record_id}' is not in md_needs_manual_preparation state "
                f"(current: {record_dict.get(Fields.STATUS)})"
            )

        record = colrev.record.record_prep.PrepRecord(record_dict)
        for field, value in req.fields.items():
            if field == Fields.ENTRYTYPE:
                record.data[Fields.ENTRYTYPE] = value
            else:
                record.update_field(
                    key=field,
                    value=str(value),
                    source="prep_man|ui",
                    note="",
                )

        if not record.has_fatal_quality_defects():
            prep_man_op = self.review_manager.get_prep_man_operation(
                notify_state_transition_operation=False
            )
            prep_man_op.set_data(record_dict=record.get_data())

            records_dict = self.review_manager.dataset.load_records_dict()
            updated_record = records_dict[req.record_id]

            return PrepManUpdateRecordResponse(
                project_id=req.project_id,
                operation="prep_man_update_record",
                details={
                    "record": _format_record(updated_record),
                    "new_status": "md_prepared",
                    "message": "Record updated and transitioned to md_prepared",
                },
            )

        # Still has defects — save partial edits without status change.
        self.review_manager.dataset.save_records_dict(
            {req.record_id: record.get_data()}, partial=True
        )

        remaining_defects = _extract_defects(record.get_data())

        return PrepManUpdateRecordResponse(
            project_id=req.project_id,
            operation="prep_man_update_record",
            details={
                "record": _format_record(record.get_data()),
                "new_status": "md_needs_manual_preparation",
                "remaining_defects": remaining_defects,
                "message": "Record updated but still has quality defects",
            },
        )


def _extract_defects(record_dict: Dict[str, Any]) -> Dict[str, List[str]]:
    """Extract per-field defect codes from masterdata provenance."""
    defects: Dict[str, List[str]] = {}
    md_prov = record_dict.get(Fields.MD_PROV, {})
    for field, prov in md_prov.items():
        if isinstance(prov, dict):
            note = prov.get("note", "")
            if note:
                codes = [
                    c.strip()
                    for c in note.split(",")
                    if c.strip() and not c.strip().startswith("IGNORE:")
                ]
                if codes:
                    defects[field] = codes
    return defects


def _format_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Format a record for API response."""
    formatted: Dict[str, Any] = {}
    for key, value in record.items():
        if key == Fields.STATUS and hasattr(value, "name"):
            formatted[key] = value.name
        elif key == Fields.ORIGIN and isinstance(value, list):
            formatted[key] = value
        elif key in (Fields.MD_PROV, Fields.D_PROV) and isinstance(value, dict):
            formatted[key] = {
                k: (
                    {"source": v.get("source", ""), "note": v.get("note", "")}
                    if isinstance(v, dict)
                    else str(v)
                )
                for k, v in value.items()
            }
        else:
            formatted[key] = value
    return formatted
