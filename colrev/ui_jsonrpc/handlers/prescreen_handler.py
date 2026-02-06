"""Handler for prescreen operations.

JSON-RPC Endpoints:
    - prescreen: Execute prescreen operation (batch mode)
    - get_prescreen_queue: Get records awaiting prescreening
    - prescreen_record: Submit prescreening decision for a single record

See docs/source/api/jsonrpc/prescreen.rst for full endpoint documentation.
"""

import logging
from typing import Any, Dict, List

import colrev.record.record
import colrev.review_manager
from colrev.constants import Fields, RecordState
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class PrescreenHandler:
    """Handle prescreen-related JSON-RPC methods.

    This handler provides endpoints for prescreening records based on
    title and abstract review.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize prescreen handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def prescreen(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute prescreen operation (batch mode).

        Runs the prescreen operation using configured prescreen packages.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - split_str (str, optional): Split string for parallel prescreening (default: "NA")

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "prescreen"
                - project_id (str): Project identifier
                - details (dict): Operation results
        """
        project_id = params["project_id"]
        split_str = validation.get_optional_param(params, "split_str", "NA")

        logger.info(f"Running prescreen operation for project {project_id}")

        # Get prescreen operation
        prescreen_operation = self.review_manager.get_prescreen_operation(
            notify_state_transition_operation=True
        )

        # Execute prescreen
        prescreen_operation.main(split_str=split_str)

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="prescreen",
            project_id=project_id,
            details={"message": "Prescreen completed", "split_str": split_str},
        )

    def get_prescreen_queue(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get records awaiting prescreening.

        Returns records that are ready for prescreening (status: md_processed).

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - limit (int, optional): Max records to return (default: 50)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - total_count (int): Total records awaiting prescreen
                - records (list): List of records with:
                    - id (str): Record ID
                    - title (str): Record title
                    - author (str): Authors
                    - year (str): Publication year
                    - abstract (str, optional): Abstract text
                    - journal (str, optional): Journal name
                    - booktitle (str, optional): Conference/book title
        """
        project_id = params["project_id"]
        limit = validation.get_optional_param(params, "limit", 50)

        logger.info(f"Getting prescreen queue for project {project_id}")

        # Need to get an operation to enable record loading
        self.review_manager.get_prescreen_operation(notify_state_transition_operation=True)

        # Load all records (may return empty dict for new projects)
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        # Filter to records awaiting prescreen (md_processed status)
        prescreen_records = [
            record for record in records_dict.values()
            if record.get(Fields.STATUS) == RecordState.md_processed
        ]

        total_count = len(prescreen_records)

        # Apply limit
        limited_records = prescreen_records[:limit]

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

            formatted_records.append(formatted)

        return {
            "success": True,
            "total_count": total_count,
            "records": formatted_records,
        }

    def prescreen_record(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Submit prescreening decision for a single record.

        Updates the record status based on the prescreen decision.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID (required)
                - decision (str): Decision - "include" or "exclude" (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - record (dict): Updated record data
                - remaining_count (int): Records still awaiting prescreen
                - message (str): Success message

        Raises:
            ValueError: If record_id or decision is missing/invalid
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        decision = params.get("decision")
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not record_id:
            raise ValueError("record_id parameter is required")

        if not decision:
            raise ValueError("decision parameter is required")

        if decision not in ("include", "exclude"):
            raise ValueError("decision must be 'include' or 'exclude'")

        logger.info(
            f"Prescreening record {record_id} as {decision} in project {project_id}"
        )

        # Need to get an operation to enable record loading
        self.review_manager.get_prescreen_operation(notify_state_transition_operation=True)

        # Load records
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        if record_id not in records_dict:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records_dict[record_id]

        # Verify record is in correct state
        current_status = record_dict.get(Fields.STATUS)
        if current_status != RecordState.md_processed:
            raise ValueError(
                f"Record '{record_id}' is not ready for prescreen "
                f"(current status: {current_status})"
            )

        # Create Record object and update status
        record = colrev.record.record.Record(record_dict)

        if decision == "include":
            record.set_status(RecordState.rev_prescreen_included)
        else:
            record.set_status(RecordState.rev_prescreen_excluded)

        # Save the updated record
        self.review_manager.dataset.save_records_dict(
            {record_id: record.get_data()},
            partial=True,
        )

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.dataset.create_commit(
                msg=f"Prescreen {decision}: {record_id}",
            )

        # Count remaining records
        remaining_count = sum(
            1 for r in records_dict.values()
            if r.get(Fields.STATUS) == RecordState.md_processed
            and r.get(Fields.ID) != record_id
        )

        return response_formatter.format_operation_response(
            operation_name="prescreen_record",
            project_id=project_id,
            details={
                "record": {
                    "id": record_id,
                    "decision": decision,
                    "new_status": record.get_data().get(Fields.STATUS).name,
                },
                "remaining_count": remaining_count,
                "message": f"Record {record_id} prescreened as {decision}",
            },
        )
