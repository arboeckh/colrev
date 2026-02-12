"""Handler for screening operations.

JSON-RPC Endpoints:
    - screen: Execute screening operation (batch mode)
    - get_screen_queue: Get records awaiting screening
    - screen_record: Submit screening decision for a single record

See docs/source/api/jsonrpc/screen.rst for full endpoint documentation.
"""

import logging
from typing import Any, Dict, List

import colrev.record.record
import colrev.review_manager
from colrev.constants import Fields, RecordState
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class ScreenHandler:
    """Handle screen-related JSON-RPC methods.

    This handler provides endpoints for full-text screening of records
    with criteria-based evaluation.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize screen handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def screen(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute screening operation (batch mode).

        Runs the screen operation using configured screen packages.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - split_str (str, optional): Split string for parallel screening (default: "NA")

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "screen"
                - project_id (str): Project identifier
                - details (dict): Operation results
        """
        project_id = params["project_id"]
        split_str = validation.get_optional_param(params, "split_str", "NA")

        logger.info(f"Running screen operation for project {project_id}")

        # Get screen operation
        screen_operation = self.review_manager.get_screen_operation(
            notify_state_transition_operation=True
        )

        # Execute screen
        screen_operation.main(split_str=split_str)

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="screen",
            project_id=project_id,
            details={"message": "Screening completed"},
        )

    def get_screen_queue(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get records awaiting screening.

        Returns records that are ready for full-text screening (status: pdf_prepared).

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - limit (int, optional): Max records to return (default: 50)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - total_count (int): Total records awaiting screen
                - criteria (list): Configured screening criteria
                - records (list): List of records with:
                    - id (str): Record ID
                    - title (str): Record title
                    - author (str): Authors
                    - year (str): Publication year
                    - abstract (str, optional): Abstract text
                    - pdf_path (str, optional): Path to PDF file
                    - current_criteria (dict, optional): Current criteria evaluations
        """
        project_id = params["project_id"]
        limit = validation.get_optional_param(params, "limit", 50)

        logger.info(f"Getting screen queue for project {project_id}")

        # Get screening criteria from settings
        screen_settings = self.review_manager.settings.screen
        criteria = {}
        if hasattr(screen_settings, 'criteria') and screen_settings.criteria:
            for criterion_name, criterion in screen_settings.criteria.items():
                criteria[criterion_name] = {
                    "explanation": getattr(criterion, 'explanation', ''),
                    "comment": getattr(criterion, 'comment', ''),
                    "criterion_type": getattr(criterion, 'criterion_type', '').value
                    if hasattr(getattr(criterion, 'criterion_type', ''), 'value')
                    else str(getattr(criterion, 'criterion_type', '')),
                }

        # Need to get an operation to enable record loading
        self.review_manager.get_screen_operation(notify_state_transition_operation=True)

        # Load all records (may return empty dict for new projects)
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        # Filter to records awaiting screen (pdf_prepared status)
        screen_records = [
            record for record in records_dict.values()
            if record.get(Fields.STATUS) == RecordState.pdf_prepared
        ]

        total_count = len(screen_records)

        # Apply limit
        limited_records = screen_records[:limit]

        # Format records for response
        formatted_records = []
        for record in limited_records:
            formatted = {
                "id": record.get(Fields.ID),
                "title": record.get(Fields.TITLE, ""),
                "author": record.get(Fields.AUTHOR, ""),
                "year": record.get(Fields.YEAR, ""),
            }

            # Include optional fields if present
            if Fields.ABSTRACT in record:
                formatted["abstract"] = record[Fields.ABSTRACT]
            if Fields.JOURNAL in record:
                formatted["journal"] = record[Fields.JOURNAL]
            if Fields.BOOKTITLE in record:
                formatted["booktitle"] = record[Fields.BOOKTITLE]
            if Fields.FILE in record:
                formatted["pdf_path"] = record[Fields.FILE]

            # Parse current screening criteria if present
            if Fields.SCREENING_CRITERIA in record:
                criteria_str = record[Fields.SCREENING_CRITERIA]
                formatted["current_criteria"] = self._parse_criteria_string(
                    criteria_str
                )

            formatted_records.append(formatted)

        return {
            "success": True,
            "total_count": total_count,
            "criteria": criteria,
            "records": formatted_records,
        }

    def screen_record(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Submit screening decision for a single record.

        Updates the record status based on the screening decision and
        records criteria evaluations.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID (required)
                - decision (str): Decision - "include" or "exclude" (required)
                - criteria_decisions (dict): Criteria evaluations (required if criteria configured)
                    Format: {"criterion_name": "in" | "out"}
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - record (dict): Updated record data
                - remaining_count (int): Records still awaiting screen
                - message (str): Success message

        Raises:
            ValueError: If record_id, decision, or criteria_decisions is missing/invalid
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        decision = params.get("decision")
        criteria_decisions = params.get("criteria_decisions", {})
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not record_id:
            raise ValueError("record_id parameter is required")

        if not decision:
            raise ValueError("decision parameter is required")

        if decision not in ("include", "exclude"):
            raise ValueError("decision must be 'include' or 'exclude'")

        logger.info(
            f"Screening record {record_id} as {decision} in project {project_id}"
        )

        # Get screen operation for proper status handling and enable record loading
        screen_operation = self.review_manager.get_screen_operation(
            notify_state_transition_operation=True
        )

        # Load records
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        if record_id not in records_dict:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records_dict[record_id]

        # Verify record is in correct state
        current_status = record_dict.get(Fields.STATUS)
        if current_status != RecordState.pdf_prepared:
            raise ValueError(
                f"Record '{record_id}' is not ready for screening "
                f"(current status: {current_status})"
            )

        # Build criteria string if criteria provided
        if criteria_decisions:
            criteria_parts = []
            for criterion_name, criterion_value in criteria_decisions.items():
                if criterion_value not in ("in", "out"):
                    raise ValueError(
                        f"Invalid criterion value for '{criterion_name}': "
                        f"must be 'in' or 'out'"
                    )
                criteria_parts.append(f"{criterion_name}={criterion_value}")
            record_dict[Fields.SCREENING_CRITERIA] = ";".join(criteria_parts)

        # Create Record object and update status
        record = colrev.record.record.Record(record_dict)

        if decision == "include":
            record.set_status(RecordState.rev_included)
        else:
            record.set_status(RecordState.rev_excluded)

        # Save the updated record
        self.review_manager.dataset.save_records_dict(
            {record_id: record.get_data()},
            partial=True,
        )

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Screen {decision}: {record_id}",
            )

        # Count remaining records
        remaining_count = sum(
            1 for r in records_dict.values()
            if r.get(Fields.STATUS) == RecordState.pdf_prepared
            and r.get(Fields.ID) != record_id
        )

        return response_formatter.format_operation_response(
            operation_name="screen_record",
            project_id=project_id,
            details={
                "record": {
                    "id": record_id,
                    "decision": decision,
                    "new_status": record.get_data().get(Fields.STATUS).name,
                    "criteria_decisions": criteria_decisions,
                },
                "remaining_count": remaining_count,
                "message": f"Record {record_id} screened as {decision}",
            },
        )

    def update_screen_decisions(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update screen decisions for records already in screen states.

        Allows flipping records between rev_included and rev_excluded
        after the initial screen is complete.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - changes (list): List of dicts with:
                    - record_id (str): Record ID
                    - decision (str): "include" or "exclude"

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - changes_count (int): Number of records actually updated
                - skipped (list): Records that were skipped with reasons
                - updated_records (list): IDs of records that were updated
                - message (str): Summary message

        Raises:
            ValueError: If changes is missing or empty
        """
        project_id = params["project_id"]
        changes = params.get("changes")

        if not changes or not isinstance(changes, list):
            raise ValueError(
                "changes parameter is required and must be a non-empty list"
            )

        for change in changes:
            if not isinstance(change, dict):
                raise ValueError(
                    "Each change must be a dict with record_id and decision"
                )
            if not change.get("record_id"):
                raise ValueError("Each change must have a record_id")
            if change.get("decision") not in ("include", "exclude"):
                raise ValueError(
                    "Each change decision must be 'include' or 'exclude'"
                )

        logger.info(
            f"Updating {len(changes)} screen decisions in project {project_id}"
        )

        self.review_manager.get_screen_operation(
            notify_state_transition_operation=True
        )

        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        valid_states = {RecordState.rev_included, RecordState.rev_excluded}
        records_to_save = {}
        skipped: List[Dict[str, str]] = []
        updated_ids: List[str] = []

        for change in changes:
            record_id = change["record_id"]
            decision = change["decision"]

            if record_id not in records_dict:
                skipped.append(
                    {"record_id": record_id, "reason": "Record not found"}
                )
                continue

            record_dict = records_dict[record_id]
            current_status = record_dict.get(Fields.STATUS)

            if current_status not in valid_states:
                skipped.append(
                    {
                        "record_id": record_id,
                        "reason": f"Invalid state: {current_status}",
                    }
                )
                continue

            target_state = (
                RecordState.rev_included
                if decision == "include"
                else RecordState.rev_excluded
            )

            if current_status == target_state:
                continue

            record = colrev.record.record.Record(record_dict)
            record.set_status(target_state)
            records_to_save[record_id] = record.get_data()
            updated_ids.append(record_id)

        if records_to_save:
            self.review_manager.dataset.save_records_dict(
                records_to_save,
                partial=True,
            )
            self.review_manager.create_commit(
                msg=f"Screen (edit): updated {len(records_to_save)} record(s)",
            )

        return {
            "success": True,
            "changes_count": len(updated_ids),
            "skipped": skipped,
            "updated_records": updated_ids,
            "message": f"Updated {len(updated_ids)} record(s)"
            + (f", skipped {len(skipped)}" if skipped else ""),
        }

    def include_all_screen(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Include all records in screen.

        Delegates to screen_operation.include_all_in_screen().

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - message (str): Success message
        """
        project_id = params["project_id"]

        logger.info(f"Including all records in screen for project {project_id}")

        screen_operation = self.review_manager.get_screen_operation(
            notify_state_transition_operation=True
        )

        screen_operation.include_all_in_screen(persist=False)

        self.review_manager.create_commit(
            msg="Screen: include all records",
        )

        return response_formatter.format_operation_response(
            operation_name="include_all_screen",
            project_id=project_id,
            details={"message": "All records included in screen"},
        )

    def _parse_criteria_string(self, criteria_str: str) -> Dict[str, str]:
        """Parse screening criteria string into dictionary.

        Format: "criterion1=in;criterion2=out;criterion3=TODO"
        """
        if not criteria_str:
            return {}

        result = {}
        for part in criteria_str.split(";"):
            if "=" in part:
                key, value = part.split("=", 1)
                result[key.strip()] = value.strip()

        return result
