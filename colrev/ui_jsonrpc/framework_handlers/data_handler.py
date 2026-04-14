"""Framework-native data handler.

All data extraction / synthesis JSON-RPC methods. Writes stage changes only;
commits are driven explicitly via the ``commit_changes`` endpoint in
``git_handler``.
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

import pandas as pd
from pydantic import BaseModel
from pydantic import ConfigDict

from colrev.constants import Fields
from colrev.constants import OperationsType
from colrev.constants import RecordState
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class DataRequest(ProjectScopedRequest):
    pass


class DataResponse(ProjectResponse):
    operation: str
    details: Dict[str, Any]


class GetDataExtractionQueueRequest(ProjectScopedRequest):
    pass


class FieldDefinition(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    explanation: str = ""
    data_type: str = "str"


class ExtractionRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str = ""
    author: str = ""
    year: str = ""
    journal: str = ""
    booktitle: str = ""
    pdf_path: str = ""
    extraction_values: Dict[str, str] = {}


class GetDataExtractionQueueResponse(ProjectResponse):
    configured: bool
    fields: List[FieldDefinition]
    records: List[ExtractionRecord]
    total_count: int
    completed_count: int


class SaveDataExtractionRequest(ProjectScopedRequest):
    record_id: str
    values: Dict[str, Any]


class SaveDataExtractionResponse(ProjectResponse):
    record_id: str
    remaining_count: int
    message: str


class StructuredFieldSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    explanation: str
    data_type: str = "str"
    options: Optional[List[Any]] = None
    optional: Optional[bool] = None


class ConfigureStructuredEndpointRequest(ProjectScopedRequest):
    fields: List[StructuredFieldSpec]


class ConfigureStructuredEndpointResponse(ProjectResponse):
    fields: List[Dict[str, Any]]
    message: str


class ExportDataCsvRequest(ProjectScopedRequest):
    pass


class ExportDataCsvResponse(ProjectResponse):
    csv_content: str
    filename: str


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class DataHandler(BaseHandler):
    """All data extraction / synthesis JSON-RPC methods."""

    # -- data ----------------------------------------------------------------

    @rpc_method(
        name="data",
        request=DataRequest,
        response=DataResponse,
        operation_type=OperationsType.data,
        notify=True,
        writes=True,
    )
    def data(self, req: DataRequest) -> DataResponse:
        assert self.review_manager is not None
        logger.info("Running data operation for project %s", req.project_id)
        data_operation = self.op(OperationsType.data, notify=True)
        data_operation.main()
        return DataResponse(
            project_id=req.project_id,
            operation="data",
            details={"message": "Data extraction and synthesis completed"},
        )

    # -- get_data_extraction_queue ------------------------------------------

    @rpc_method(
        name="get_data_extraction_queue",
        request=GetDataExtractionQueueRequest,
        response=GetDataExtractionQueueResponse,
        operation_type=OperationsType.data,
        notify=True,
        writes=False,
    )
    def get_data_extraction_queue(
        self, req: GetDataExtractionQueueRequest
    ) -> GetDataExtractionQueueResponse:
        assert self.review_manager is not None
        logger.info("Getting data extraction queue for project %s", req.project_id)

        ep_settings = self._find_structured_endpoint()
        if ep_settings is None:
            return GetDataExtractionQueueResponse(
                project_id=req.project_id,
                configured=False,
                fields=[],
                records=[],
                total_count=0,
                completed_count=0,
            )

        fields = ep_settings.get("fields", [])
        if not fields:
            return GetDataExtractionQueueResponse(
                project_id=req.project_id,
                configured=True,
                fields=[],
                records=[],
                total_count=0,
                completed_count=0,
            )

        # Normalize fields to dicts
        field_dicts: List[Dict[str, Any]] = []
        for f in fields:
            if isinstance(f, dict):
                field_dicts.append(f)
            else:
                fd: Dict[str, Any] = {
                    "name": f.name,
                    "explanation": f.explanation,
                    "data_type": f.data_type,
                }
                if hasattr(f, "options") and f.options:
                    fd["options"] = f.options
                if hasattr(f, "optional") and f.optional:
                    fd["optional"] = True
                field_dicts.append(fd)

        field_names = [f["name"] for f in field_dicts]

        # Run operation to prime state notifications & load records
        self.op(OperationsType.data, notify=True)
        records_dict = self.review_manager.dataset.load_records_dict() or {}

        eligible_records = {
            rid: r
            for rid, r in records_dict.items()
            if r.get(Fields.STATUS)
            in [RecordState.rev_included, RecordState.rev_synthesized]
        }

        data_path = self._get_structured_data_path(ep_settings)

        if not data_path.is_file():
            data_path.parent.mkdir(parents=True, exist_ok=True)
            data_df = pd.DataFrame(columns=[Fields.ID] + field_names)
            for rid in eligible_records:
                add_row = pd.DataFrame({Fields.ID: [rid]})
                add_row = add_row.reindex(columns=data_df.columns, fill_value="TODO")
                data_df = pd.concat([data_df, add_row], axis=0, ignore_index=True)
            data_df.sort_values(by=[Fields.ID], inplace=True)
            data_df.to_csv(data_path, index=False, quoting=csv.QUOTE_ALL)
        else:
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

        result_records: List[ExtractionRecord] = []
        completed_count = 0

        for _, row in data_df.iterrows():
            rid = row[Fields.ID]
            record_data = records_dict.get(rid, {})

            extraction_values: Dict[str, str] = {}
            has_todo = False
            for fname in field_names:
                val = str(row.get(fname, "TODO"))
                extraction_values[fname] = val
                if val == "TODO":
                    has_todo = True

            if not has_todo:
                completed_count += 1

            result_records.append(
                ExtractionRecord(
                    id=rid,
                    title=record_data.get(Fields.TITLE, ""),
                    author=record_data.get(Fields.AUTHOR, ""),
                    year=record_data.get(Fields.YEAR, ""),
                    journal=record_data.get(Fields.JOURNAL, ""),
                    booktitle=record_data.get(Fields.BOOKTITLE, ""),
                    pdf_path=record_data.get(Fields.FILE, ""),
                    extraction_values=extraction_values,
                )
            )

        return GetDataExtractionQueueResponse(
            project_id=req.project_id,
            configured=True,
            fields=[FieldDefinition(**fd) for fd in field_dicts],
            records=result_records,
            total_count=len(result_records),
            completed_count=completed_count,
        )

    # -- save_data_extraction -----------------------------------------------

    @rpc_method(
        name="save_data_extraction",
        request=SaveDataExtractionRequest,
        response=SaveDataExtractionResponse,
        operation_type=OperationsType.data,
        notify=True,
        writes=True,
    )
    def save_data_extraction(
        self, req: SaveDataExtractionRequest
    ) -> SaveDataExtractionResponse:
        assert self.review_manager is not None
        if not req.record_id:
            raise ValueError("record_id parameter is required")
        if not req.values or not isinstance(req.values, dict):
            raise ValueError("values parameter is required and must be a dict")

        logger.info(
            "Saving data extraction for %s in project %s",
            req.record_id, req.project_id,
        )

        ep_settings = self._find_structured_endpoint()
        if ep_settings is None:
            raise ValueError("colrev.structured endpoint is not configured")

        data_path = self._get_structured_data_path(ep_settings)
        if not data_path.is_file():
            raise ValueError(f"Data CSV not found at {data_path}")

        data_df = pd.read_csv(data_path, dtype=str)
        mask = data_df[Fields.ID] == req.record_id
        if mask.sum() == 0:
            raise ValueError(f"Record '{req.record_id}' not found in data CSV")

        for field_name, field_value in req.values.items():
            if field_name in data_df.columns:
                data_df.loc[mask, field_name] = str(field_value)

        data_df.to_csv(data_path, index=False, quoting=csv.QUOTE_ALL)

        rel_path = Path(
            ep_settings.get("data_path_relative", "data/data/data.csv")
        )
        self.review_manager.dataset.git_repo.add_changes(
            rel_path, ignore_missing=True
        )

        data_operation = self.op(OperationsType.data, notify=True)
        data_operation.main(silent_mode=True)

        data_df = pd.read_csv(data_path, dtype=str)
        field_names = [
            f["name"] if isinstance(f, dict) else f.name
            for f in ep_settings.get("fields", [])
        ]
        remaining_count = 0
        for _, row in data_df.iterrows():
            for fname in field_names:
                if str(row.get(fname, "TODO")) == "TODO":
                    remaining_count += 1
                    break

        return SaveDataExtractionResponse(
            project_id=req.project_id,
            record_id=req.record_id,
            remaining_count=remaining_count,
            message=f"Extraction saved for {req.record_id}",
        )

    # -- export_data_csv ----------------------------------------------------

    @rpc_method(
        name="export_data_csv",
        request=ExportDataCsvRequest,
        response=ExportDataCsvResponse,
        writes=False,
    )
    def export_data_csv(self, req: ExportDataCsvRequest) -> ExportDataCsvResponse:
        assert self.review_manager is not None
        logger.info("Exporting data CSV for project %s", req.project_id)

        ep_settings = self._find_structured_endpoint()
        if ep_settings is None:
            raise ValueError("colrev.structured endpoint is not configured")

        data_path = self._get_structured_data_path(ep_settings)
        if not data_path.is_file():
            raise ValueError("No data CSV file found")

        csv_content = data_path.read_text(encoding="utf-8")
        return ExportDataCsvResponse(
            project_id=req.project_id,
            csv_content=csv_content,
            filename=data_path.name,
        )

    # -- configure_structured_endpoint --------------------------------------

    @rpc_method(
        name="configure_structured_endpoint",
        request=ConfigureStructuredEndpointRequest,
        response=ConfigureStructuredEndpointResponse,
        writes=True,
    )
    def configure_structured_endpoint(
        self, req: ConfigureStructuredEndpointRequest
    ) -> ConfigureStructuredEndpointResponse:
        assert self.review_manager is not None
        if not req.fields:
            raise ValueError(
                "fields parameter is required and must be a non-empty list"
            )

        valid_types = {"str", "int", "double", "select", "multi_select"}
        normalized_fields: List[Dict[str, Any]] = []
        for i, field in enumerate(req.fields):
            if not field.name:
                raise ValueError(f"Field {i} must have a non-empty name")
            if not field.explanation:
                raise ValueError(f"Field {i} must have a non-empty explanation")
            if field.data_type not in valid_types:
                raise ValueError(
                    f"Field {i} data_type must be one of {valid_types}"
                )
            nf: Dict[str, Any] = {
                "name": field.name,
                "explanation": field.explanation,
                "data_type": field.data_type,
            }
            if field.options:
                nf["options"] = field.options
            if field.optional:
                nf["optional"] = True
            normalized_fields.append(nf)

        logger.info(
            "Configuring structured endpoint for project %s", req.project_id
        )

        ep_settings = self._find_structured_endpoint()
        if ep_settings is not None:
            new_field_names = [f["name"] for f in normalized_fields]

            for i, ep in enumerate(
                self.review_manager.settings.data.data_package_endpoints
            ):
                ep_dict = ep if isinstance(ep, dict) else dict(ep)
                if ep_dict.get("endpoint") == "colrev.structured":
                    if isinstance(ep, dict):
                        ep["fields"] = normalized_fields
                    else:
                        self.review_manager.settings.data.data_package_endpoints[i] = {
                            "endpoint": "colrev.structured",
                            "version": ep_dict.get("version", "0.1"),
                            "fields": normalized_fields,
                            "data_path_relative": str(
                                ep_dict.get(
                                    "data_path_relative", "data/data/data.csv"
                                )
                            ),
                        }
                    break

            data_path = self._get_structured_data_path(ep_dict)
            if data_path.is_file():
                data_df = pd.read_csv(data_path, dtype=str)
                for fname in new_field_names:
                    if fname not in data_df.columns:
                        data_df[fname] = "TODO"
                cols_to_keep = [Fields.ID] + new_field_names
                data_df = data_df[[c for c in cols_to_keep if c in data_df.columns]]
                for fname in new_field_names:
                    if fname not in data_df.columns:
                        data_df[fname] = "TODO"
                data_df = data_df[[Fields.ID] + new_field_names]
                data_df.to_csv(data_path, index=False, quoting=csv.QUOTE_ALL)
        else:
            new_ep = {
                "endpoint": "colrev.structured",
                "version": "0.1",
                "fields": normalized_fields,
                "data_path_relative": "data/data/data.csv",
            }
            self.review_manager.settings.data.data_package_endpoints.append(new_ep)

        self.review_manager.save_settings()

        return ConfigureStructuredEndpointResponse(
            project_id=req.project_id,
            fields=normalized_fields,
            message=f"Configured {len(normalized_fields)} extraction fields",
        )

    # -- helpers ------------------------------------------------------------

    def _find_structured_endpoint(self) -> Optional[Dict[str, Any]]:
        assert self.review_manager is not None
        for ep in self.review_manager.settings.data.data_package_endpoints:
            ep_dict = ep if isinstance(ep, dict) else dict(ep)
            if ep_dict.get("endpoint") == "colrev.structured":
                return ep_dict
        return None

    def _get_structured_data_path(self, endpoint_settings: Dict[str, Any]) -> Path:
        assert self.review_manager is not None
        rel_path = endpoint_settings.get("data_path_relative", "data/data/data.csv")
        return self.review_manager.path / rel_path
