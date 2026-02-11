"""Handler for manual preparation operations.

JSON-RPC Endpoints:
    - prep_man_update_record: Update a record's fields and attempt to transition
      from md_needs_manual_preparation to md_prepared

See docs/source/api/jsonrpc/prep_man.rst for full endpoint documentation.
"""

import logging
from typing import Any, Dict, List, Optional

import colrev.record.record_prep
import colrev.review_manager
from colrev.constants import Fields, RecordState
from colrev.ui_jsonrpc import response_formatter, validation as param_validation

logger = logging.getLogger(__name__)


class PrepManHandler:
    """Handle manual preparation JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        self.review_manager = review_manager

    def prep_man_update_record(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update a record's fields and attempt status transition.

        Updates specified fields on a record in md_needs_manual_preparation
        status. If all fatal quality defects are resolved, transitions the
        record to md_prepared via the prep_man operation.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID (required)
                - fields (dict): Fields to update (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "prep_man_update_record"
                - project_id (str): Project identifier
                - details (dict): Contains record, new_status, remaining_defects, message

        Raises:
            ValueError: If parameters are invalid or record is not in correct state
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        fields_to_update = params.get("fields")
        skip_commit = param_validation.get_optional_param(
            params, "skip_commit", False
        )

        if not record_id:
            raise ValueError("record_id parameter is required")
        if not fields_to_update:
            raise ValueError("fields parameter is required")
        if not isinstance(fields_to_update, dict):
            raise ValueError("fields must be a dictionary")

        logger.info(
            f"Manual prep update for record {record_id} in project {project_id}"
        )

        # Prevent updating protected fields
        protected_fields = {Fields.ID, Fields.ORIGIN, Fields.MD_PROV, Fields.D_PROV}
        for field in protected_fields:
            if field in fields_to_update:
                raise ValueError(f"Cannot update protected field: {field}")

        # Load records
        self.review_manager.get_status_operation()
        records_dict = self.review_manager.dataset.load_records_dict()

        if record_id not in records_dict:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records_dict[record_id]

        # Verify record is in the correct state
        if record_dict.get(Fields.STATUS) != RecordState.md_needs_manual_preparation:
            raise ValueError(
                f"Record '{record_id}' is not in md_needs_manual_preparation state "
                f"(current: {record_dict.get(Fields.STATUS)})"
            )

        # Create PrepRecord and update fields with provenance tracking
        record = colrev.record.record_prep.PrepRecord(record_dict)
        for field, value in fields_to_update.items():
            if field == Fields.ENTRYTYPE:
                record.data[Fields.ENTRYTYPE] = value
            else:
                record.update_field(
                    key=field,
                    value=str(value),
                    source="prep_man|ui",
                    note="",
                )

        # Check if fatal defects are resolved
        if not record.has_fatal_quality_defects():
            # All defects resolved — use prep_man.set_data() for proper transition
            prep_man_op = self.review_manager.get_prep_man_operation(
                notify_state_transition_operation=False
            )
            prep_man_op.set_data(record_dict=record.get_data())

            # Reload the record after set_data to get the final state
            records_dict = self.review_manager.dataset.load_records_dict()
            updated_record = records_dict[record_id]

            if not skip_commit:
                self.review_manager.create_commit(
                    msg=f"Manual prep: {record_id} → md_prepared",
                )

            return response_formatter.format_operation_response(
                operation_name="prep_man_update_record",
                project_id=project_id,
                details={
                    "record": self._format_record(updated_record),
                    "new_status": "md_prepared",
                    "message": "Record updated and transitioned to md_prepared",
                },
            )
        else:
            # Still has defects — save partial edits without status change
            self.review_manager.dataset.save_records_dict(
                {record_id: record.get_data()}, partial=True
            )

            remaining_defects = self._extract_defects(record.get_data())

            if not skip_commit:
                self.review_manager.create_commit(
                    msg=f"Manual prep (partial): {record_id}",
                )

            return response_formatter.format_operation_response(
                operation_name="prep_man_update_record",
                project_id=project_id,
                details={
                    "record": self._format_record(record.get_data()),
                    "new_status": "md_needs_manual_preparation",
                    "remaining_defects": remaining_defects,
                    "message": "Record updated but still has quality defects",
                },
            )

    @staticmethod
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

    @staticmethod
    def _format_record(
        record: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Format a record for API response."""
        formatted = {}
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
