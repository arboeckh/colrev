"""Handler for PDF retrieval operations."""

import base64
import logging
from pathlib import Path
from typing import Any, Dict

import colrev.ops.pdf_get_man
import colrev.record.record
import colrev.review_manager
from colrev.constants import Fields, RecordState
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class PDFGetHandler:
    """Handle pdf-get-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize PDF get handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def pdf_get(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute PDF retrieval operation.

        Expected params:
            project_id (str): Project identifier

        Args:
            params: Method parameters

        Returns:
            PDF get operation results
        """
        project_id = params["project_id"]

        logger.info(f"Running pdf-get operation for project {project_id}")

        # Get pdf-get operation
        pdf_get_operation = self.review_manager.get_pdf_get_operation(
            notify_state_transition_operation=True
        )

        # Execute pdf-get
        pdf_get_operation.main()

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="pdf_get",
            project_id=project_id,
            details={"message": "PDF retrieval completed"},
        )

    def upload_pdf(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Upload a PDF file for a record that needs manual retrieval.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record to attach PDF to (required)
                - filename (str): Original filename (required)
                - content (str): Base64-encoded PDF content (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): True on success
                - record_id (str): Record ID
                - file_path (str): Relative path to saved PDF
                - new_status (str): New record status after upload
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        filename = params.get("filename")
        content = params.get("content")
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not record_id:
            raise ValueError("record_id parameter is required")
        if not filename:
            raise ValueError("filename parameter is required")
        if not content:
            raise ValueError("content parameter is required")

        logger.info(f"Uploading PDF for record {record_id} in project {project_id}")

        # Load records and verify record exists
        records = self.review_manager.dataset.load_records_dict()
        if record_id not in records:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records[record_id]
        if record_dict[Fields.STATUS] != RecordState.pdf_needs_manual_retrieval:
            raise ValueError(
                f"Record '{record_id}' is not in pdf_needs_manual_retrieval state "
                f"(current: {record_dict[Fields.STATUS]})"
            )

        # Decode base64 content
        try:
            pdf_bytes = base64.b64decode(content)
        except Exception as e:
            raise ValueError(f"Invalid base64 content: {e}")

        # Write PDF to data/pdfs/{record_id}.pdf
        pdf_dir = self.review_manager.paths.pdf
        pdf_dir.mkdir(parents=True, exist_ok=True)
        target_path = pdf_dir / f"{record_id}.pdf"

        with open(target_path, "wb") as f:
            f.write(pdf_bytes)

        # Use PDFGetMan to link the PDF to the record
        record = colrev.record.record.Record(record_dict)
        pdf_get_man = colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )
        pdf_get_man.pdf_get_man_record(record=record, filepath=target_path)

        # Commit if requested
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Upload PDF for {record_id}",
                manual_author=True,
            )

        return {
            "success": True,
            "record_id": record_id,
            "file_path": str(target_path.relative_to(self.review_manager.path)),
            "new_status": "pdf_imported",
        }

    def mark_pdf_not_available(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Mark a record's PDF as not available.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record to mark (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): True on success
                - record_id (str): Record ID
                - new_status (str): New record status
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not record_id:
            raise ValueError("record_id parameter is required")

        logger.info(
            f"Marking PDF not available for record {record_id} in project {project_id}"
        )

        # Load records and verify record exists
        records = self.review_manager.dataset.load_records_dict()
        if record_id not in records:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records[record_id]
        if record_dict[Fields.STATUS] != RecordState.pdf_needs_manual_retrieval:
            raise ValueError(
                f"Record '{record_id}' is not in pdf_needs_manual_retrieval state "
                f"(current: {record_dict[Fields.STATUS]})"
            )

        # Use PDFGetMan with filepath=None to mark as not available
        record = colrev.record.record.Record(record_dict)
        pdf_get_man = colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )
        pdf_get_man.pdf_get_man_record(record=record, filepath=None)

        # Determine the new status from the record
        new_status = str(record.data[Fields.STATUS])

        # Commit if requested
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Mark PDF not available for {record_id}",
                manual_author=True,
            )

        return {
            "success": True,
            "record_id": record_id,
            "new_status": new_status,
        }
