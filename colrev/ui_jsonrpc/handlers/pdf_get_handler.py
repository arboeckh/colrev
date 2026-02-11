"""Handler for PDF retrieval operations."""

import base64
import logging
from pathlib import Path
from typing import Any, Dict

import colrev.ops.pdf_get_man
import colrev.ops.pdf_prep
import colrev.record.record
import colrev.review_manager
from colrev.constants import EndpointType, Fields, RecordState
from colrev.package_manager.package_manager import PackageManager
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

        # Instantiate PDFGetMan first to notify the review manager
        # (required before load_records_dict can be called)
        pdf_get_man = colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
        )

        # Load records and verify record exists
        records = self.review_manager.dataset.load_records_dict()
        if record_id not in records:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records[record_id]
        is_reupload = (
            record_dict[Fields.STATUS] == RecordState.pdf_needs_manual_preparation
        )
        if record_dict[Fields.STATUS] not in (
            RecordState.pdf_needs_manual_retrieval,
            RecordState.pdf_needs_manual_preparation,
        ):
            raise ValueError(
                f"Record '{record_id}' is not in pdf_needs_manual_retrieval or "
                f"pdf_needs_manual_preparation state "
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

        if is_reupload:
            # Re-upload: overwrite the PDF, clear file provenance defects,
            # and reset status to pdf_imported so auto-prep runs fresh
            record = colrev.record.record.Record(record_dict)
            record.data[Fields.D_PROV]["file"] = {
                "source": "manual-upload",
                "note": "",
            }
            record.set_status(target_state=RecordState.pdf_imported, force=True)
            self.review_manager.dataset.save_records_dict(
                {record_id: record.data}, partial=True
            )
        else:
            # First upload: use PDFGetMan to link the PDF to the record
            record = colrev.record.record.Record(record_dict)
            pdf_get_man.pdf_get_man_record(record=record, filepath=target_path)

        # Auto-run PDF prep on the uploaded record
        prep_status = "skipped"
        prep_message = None
        try:
            pdf_prep_operation = colrev.ops.pdf_prep.PDFPrep(
                review_manager=self.review_manager,
                notify_state_transition_operation=False,
            )

            # Set up package endpoints (same pattern as PDFPrep.main())
            package_manager = PackageManager()
            pdf_prep_operation.pdf_prep_package_endpoints = {}
            for pdf_prep_pe in (
                self.review_manager.settings.pdf_prep.pdf_prep_package_endpoints
            ):
                pdf_prep_class = package_manager.get_package_endpoint_class(
                    package_type=EndpointType.pdf_prep,
                    package_identifier=pdf_prep_pe["endpoint"],
                )
                pdf_prep_operation.pdf_prep_package_endpoints[
                    pdf_prep_pe["endpoint"]
                ] = pdf_prep_class(
                    pdf_prep_operation=pdf_prep_operation,
                    settings=pdf_prep_pe,
                )

            # Re-load the record after pdf_get_man saved it
            fresh_records = self.review_manager.dataset.load_records_dict()
            fresh_record_dict = fresh_records[record_id]

            # Run prep on this single record
            prepped_record_dict = pdf_prep_operation.prepare_pdf(
                {"record": fresh_record_dict}
            )

            # Save the prepped record
            self.review_manager.dataset.save_records_dict(
                {record_id: prepped_record_dict}, partial=True
            )

            prep_status = str(prepped_record_dict.get(Fields.STATUS, ""))

            # Extract defect notes if prep failed
            if prep_status == str(RecordState.pdf_needs_manual_preparation):
                provenance = prepped_record_dict.get(
                    Fields.D_PROV, {}
                )
                file_prov = provenance.get("file", {})
                note = file_prov.get("note", "") if isinstance(file_prov, dict) else ""
                if note:
                    prep_message = note
                else:
                    prep_message = "PDF needs manual preparation"

        except Exception as e:
            logger.warning(f"PDF prep failed for {record_id}: {e}")
            prep_status = "skipped"
            prep_message = str(e)

        # Determine final status
        final_records = self.review_manager.dataset.load_records_dict()
        final_status = str(final_records[record_id].get(Fields.STATUS, "pdf_imported"))

        # Commit if requested
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Upload and prepare PDF for {record_id}",
                manual_author=True,
            )

        return {
            "success": True,
            "record_id": record_id,
            "file_path": str(target_path.relative_to(self.review_manager.path)),
            "new_status": final_status,
            "prep_status": prep_status,
            "prep_message": prep_message,
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

        # Instantiate PDFGetMan first to notify the review manager
        # (required before load_records_dict can be called)
        pdf_get_man = colrev.ops.pdf_get_man.PDFGetMan(
            review_manager=self.review_manager,
            notify_state_transition_operation=False,
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
