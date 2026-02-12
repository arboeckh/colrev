"""Handler for data extraction and synthesis operations.

JSON-RPC Endpoints:
    - data: Execute data operation (batch mode)
    - get_data_extraction_queue: Get records with extraction status
    - save_data_extraction: Save extraction values for a record
    - configure_structured_endpoint: Add/update structured endpoint fields

See docs/source/api/jsonrpc/data.rst for full endpoint documentation.
"""

import csv
import logging
from pathlib import Path
from typing import Any, Dict

import pandas as pd

import colrev.review_manager
from colrev.constants import Fields, RecordState
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class DataHandler:
    """Handle data-related JSON-RPC methods."""

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """
        Initialize data handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def data(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute data extraction and synthesis operation.

        Expected params:
            project_id (str): Project identifier

        Args:
            params: Method parameters

        Returns:
            Data operation results
        """
        project_id = params["project_id"]

        logger.info(f"Running data operation for project {project_id}")

        # Get data operation
        data_operation = self.review_manager.get_data_operation(
            notify_state_transition_operation=True
        )

        # Execute data extraction/synthesis
        data_operation.main()

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="data",
            project_id=project_id,
            details={"message": "Data extraction and synthesis completed"},
        )

    def _find_structured_endpoint(self) -> Dict[str, Any] | None:
        """Find the colrev.structured endpoint in settings."""
        for ep in self.review_manager.settings.data.data_package_endpoints:
            ep_dict = ep if isinstance(ep, dict) else dict(ep)
            if ep_dict.get("endpoint") == "colrev.structured":
                return ep_dict
        return None

    def _get_structured_data_path(self, endpoint_settings: Dict[str, Any]) -> Path:
        """Get the absolute path to the structured data CSV file."""
        rel_path = endpoint_settings.get("data_path_relative", "data/data/data.csv")
        return self.review_manager.path / rel_path

    def get_data_extraction_queue(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get records with their extraction status and values.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - configured (bool): Whether colrev.structured is configured
                - fields (list): Field definitions
                - records (list): Records with extraction values
                - total_count (int): Total extraction records
                - completed_count (int): Records with all fields filled
        """
        project_id = params["project_id"]

        logger.info(f"Getting data extraction queue for project {project_id}")

        # Find colrev.structured endpoint
        ep_settings = self._find_structured_endpoint()
        if ep_settings is None:
            return {
                "success": True,
                "configured": False,
                "fields": [],
                "records": [],
                "total_count": 0,
                "completed_count": 0,
            }

        fields = ep_settings.get("fields", [])
        if not fields:
            return {
                "success": True,
                "configured": True,
                "fields": [],
                "records": [],
                "total_count": 0,
                "completed_count": 0,
            }

        # Normalize fields to dicts
        field_dicts = []
        for f in fields:
            if isinstance(f, dict):
                field_dicts.append(f)
            else:
                fd = {"name": f.name, "explanation": f.explanation, "data_type": f.data_type}
                if hasattr(f, "options") and f.options:
                    fd["options"] = f.options
                if hasattr(f, "optional") and f.optional:
                    fd["optional"] = True
                field_dicts.append(fd)

        field_names = [f["name"] for f in field_dicts]

        # Load records dict for metadata
        data_operation = self.review_manager.get_data_operation(
            notify_state_transition_operation=True
        )
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        # Get records eligible for data extraction (rev_included or rev_synthesized)
        eligible_records = {
            rid: r for rid, r in records_dict.items()
            if r.get(Fields.STATUS) in [RecordState.rev_included, RecordState.rev_synthesized]
        }

        data_path = self._get_structured_data_path(ep_settings)

        # Create CSV if it doesn't exist
        if not data_path.is_file():
            data_path.parent.mkdir(parents=True, exist_ok=True)
            data_df = pd.DataFrame(columns=[Fields.ID] + field_names)
            # Add rows for eligible records
            for rid in eligible_records:
                add_row = pd.DataFrame({Fields.ID: [rid]})
                add_row = add_row.reindex(columns=data_df.columns, fill_value="TODO")
                data_df = pd.concat([data_df, add_row], axis=0, ignore_index=True)
            data_df.sort_values(by=[Fields.ID], inplace=True)
            data_df.to_csv(data_path, index=False, quoting=csv.QUOTE_ALL)
        else:
            # Read existing CSV and add any missing records
            data_df = pd.read_csv(data_path, dtype=str)
            existing_ids = set(data_df[Fields.ID].tolist())
            added = False
            for rid in eligible_records:
                if rid not in existing_ids:
                    add_row = pd.DataFrame({Fields.ID: [rid]})
                    add_row = add_row.reindex(columns=data_df.columns, fill_value="TODO")
                    data_df = pd.concat([data_df, add_row], axis=0, ignore_index=True)
                    added = True
            if added:
                data_df.sort_values(by=[Fields.ID], inplace=True)
                data_df.to_csv(data_path, index=False, quoting=csv.QUOTE_ALL)

        # Build response records
        result_records = []
        completed_count = 0

        for _, row in data_df.iterrows():
            rid = row[Fields.ID]
            record_data = records_dict.get(rid, {})

            extraction_values = {}
            has_todo = False
            for fname in field_names:
                val = str(row.get(fname, "TODO"))
                extraction_values[fname] = val
                if val == "TODO":
                    has_todo = True

            if not has_todo:
                completed_count += 1

            result_records.append({
                "id": rid,
                "title": record_data.get(Fields.TITLE, ""),
                "author": record_data.get(Fields.AUTHOR, ""),
                "year": record_data.get(Fields.YEAR, ""),
                "journal": record_data.get(Fields.JOURNAL, ""),
                "booktitle": record_data.get(Fields.BOOKTITLE, ""),
                "pdf_path": record_data.get(Fields.FILE, ""),
                "extraction_values": extraction_values,
            })

        return {
            "success": True,
            "configured": True,
            "fields": field_dicts,
            "records": result_records,
            "total_count": len(result_records),
            "completed_count": completed_count,
        }

    def save_data_extraction(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Save extraction values for a single record.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID (required)
                - values (dict): Field name → value mapping (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - record_id (str): The record ID saved
                - remaining_count (int): Records still needing extraction
                - message (str): Success message
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        values = params.get("values")
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not record_id:
            raise ValueError("record_id parameter is required")
        if not values or not isinstance(values, dict):
            raise ValueError("values parameter is required and must be a dict")

        logger.info(f"Saving data extraction for {record_id} in project {project_id}")

        # Find structured endpoint
        ep_settings = self._find_structured_endpoint()
        if ep_settings is None:
            raise ValueError("colrev.structured endpoint is not configured")

        data_path = self._get_structured_data_path(ep_settings)
        if not data_path.is_file():
            raise ValueError(f"Data CSV not found at {data_path}")

        # Read CSV and update the row
        data_df = pd.read_csv(data_path, dtype=str)
        mask = data_df[Fields.ID] == record_id
        if mask.sum() == 0:
            raise ValueError(f"Record '{record_id}' not found in data CSV")

        for field_name, field_value in values.items():
            if field_name in data_df.columns:
                data_df.loc[mask, field_name] = str(field_value)

        # Write CSV back
        data_df.to_csv(data_path, index=False, quoting=csv.QUOTE_ALL)

        # Git-add the CSV
        rel_path = Path(ep_settings.get("data_path_relative", "data/data/data.csv"))
        self.review_manager.dataset.git_repo.add_changes(
            rel_path, ignore_missing=True
        )

        # Run data operation in silent mode to trigger status transitions
        data_operation = self.review_manager.get_data_operation(
            notify_state_transition_operation=True
        )
        data_operation.main(silent_mode=True)

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Data extraction: {record_id}",
            )

        # Count remaining (records with TODOs)
        data_df = pd.read_csv(data_path, dtype=str)
        field_names = [f["name"] if isinstance(f, dict) else f.name
                       for f in ep_settings.get("fields", [])]
        remaining_count = 0
        for _, row in data_df.iterrows():
            for fname in field_names:
                if str(row.get(fname, "TODO")) == "TODO":
                    remaining_count += 1
                    break

        return {
            "success": True,
            "record_id": record_id,
            "remaining_count": remaining_count,
            "message": f"Extraction saved for {record_id}",
        }

    def export_data_csv(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Return the contents of the structured data CSV file as a string.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - csv_content (str): The CSV file contents
                - filename (str): Suggested filename for download
        """
        project_id = params["project_id"]

        logger.info(f"Exporting data CSV for project {project_id}")

        ep_settings = self._find_structured_endpoint()
        if ep_settings is None:
            raise ValueError("colrev.structured endpoint is not configured")

        data_path = self._get_structured_data_path(ep_settings)
        if not data_path.is_file():
            raise ValueError("No data CSV file found")

        csv_content = data_path.read_text(encoding="utf-8")

        return {
            "success": True,
            "csv_content": csv_content,
            "filename": data_path.name,
        }

    def configure_structured_endpoint(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Add or update the colrev.structured endpoint with given fields.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - fields (list): List of field definitions, each with:
                    - name (str): Field name (required)
                    - explanation (str): Field explanation (required)
                    - data_type (str): Data type - str, int, or double (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - fields (list): Configured field definitions
                - message (str): Success message
        """
        project_id = params["project_id"]
        fields = params.get("fields")
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not fields or not isinstance(fields, list):
            raise ValueError("fields parameter is required and must be a non-empty list")

        # Validate fields
        valid_types = {"str", "int", "double", "select", "multi_select"}
        for i, field in enumerate(fields):
            if not isinstance(field, dict):
                raise ValueError(f"Field {i} must be a dict")
            if not field.get("name"):
                raise ValueError(f"Field {i} must have a non-empty name")
            if not field.get("explanation"):
                raise ValueError(f"Field {i} must have a non-empty explanation")
            dt = field.get("data_type", "str")
            if dt not in valid_types:
                raise ValueError(f"Field {i} data_type must be one of {valid_types}")

        logger.info(f"Configuring structured endpoint for project {project_id}")

        # Normalize fields
        normalized_fields = []
        for f in fields:
            nf = {"name": f["name"], "explanation": f["explanation"], "data_type": f.get("data_type", "str")}
            if f.get("options"):
                nf["options"] = f["options"]
            if f.get("optional"):
                nf["optional"] = True
            normalized_fields.append(nf)

        # Find or create the endpoint
        ep_settings = self._find_structured_endpoint()
        if ep_settings is not None:
            # Update existing endpoint
            old_field_names = [f["name"] if isinstance(f, dict) else f.name
                               for f in ep_settings.get("fields", [])]
            new_field_names = [f["name"] for f in normalized_fields]

            # Update in settings
            for i, ep in enumerate(self.review_manager.settings.data.data_package_endpoints):
                ep_dict = ep if isinstance(ep, dict) else dict(ep)
                if ep_dict.get("endpoint") == "colrev.structured":
                    if isinstance(ep, dict):
                        ep["fields"] = normalized_fields
                    else:
                        self.review_manager.settings.data.data_package_endpoints[i] = {
                            "endpoint": "colrev.structured",
                            "version": ep_dict.get("version", "0.1"),
                            "fields": normalized_fields,
                            "data_path_relative": str(ep_dict.get("data_path_relative", "data/data/data.csv")),
                        }
                    break

            # Update CSV columns if CSV exists
            data_path = self._get_structured_data_path(ep_dict)
            if data_path.is_file():
                data_df = pd.read_csv(data_path, dtype=str)
                # Add new columns
                for fname in new_field_names:
                    if fname not in data_df.columns:
                        data_df[fname] = "TODO"
                # Remove dropped columns (but keep ID)
                cols_to_keep = [Fields.ID] + new_field_names
                data_df = data_df[[c for c in cols_to_keep if c in data_df.columns]]
                # Add any missing new columns
                for fname in new_field_names:
                    if fname not in data_df.columns:
                        data_df[fname] = "TODO"
                # Reorder
                data_df = data_df[[Fields.ID] + new_field_names]
                data_df.to_csv(data_path, index=False, quoting=csv.QUOTE_ALL)
        else:
            # Add new endpoint
            new_ep = {
                "endpoint": "colrev.structured",
                "version": "0.1",
                "fields": normalized_fields,
                "data_path_relative": "data/data/data.csv",
            }
            self.review_manager.settings.data.data_package_endpoints.append(new_ep)

        # Save settings
        self.review_manager.save_settings()

        if not skip_commit:
            self.review_manager.create_commit(
                msg="Configure structured data extraction fields",
            )

        return {
            "success": True,
            "fields": normalized_fields,
            "message": f"Configured {len(normalized_fields)} extraction fields",
        }
