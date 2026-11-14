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
from colrev.ui_jsonrpc.errors import InvalidStateError
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import portability
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
    # Set only when configured on the endpoint (see get_data_extraction_queue).
    options: Optional[List[str]] = None
    optional: Optional[bool] = None


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
    """Field spec accepted by ``configure_structured_endpoint``. Mirrors
    ``FieldDefinition`` (the read-side shape) so the renderer can round-trip
    fields from ``get_data_extraction_queue`` without casts."""

    model_config = ConfigDict(extra="allow")

    name: str
    explanation: str = ""
    data_type: str = "str"
    options: Optional[List[Any]] = None
    optional: Optional[bool] = None
    # Set by the renderer when the user renamed an existing field, so that the
    # extracted values move to the new column instead of being dropped.
    previous_name: Optional[str] = None


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
        timeout_class="fast",
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

        field_dicts = self._normalize_fields(fields)
        field_names = [f["name"] for f in field_dicts]

        # Run operation to prime state notifications & load records
        self.op(OperationsType.data, notify=True)
        records_dict = self.review_manager.dataset.load_records_dict() or {}

        eligible_ids = [
            rid
            for rid, r in records_dict.items()
            if r.get(Fields.STATUS)
            in [RecordState.rev_included, RecordState.rev_synthesized]
        ]

        # A read must not write: rows for newly eligible records are added to
        # the frame in memory only. The CSV is created / updated by
        # ``save_data_extraction`` and ``configure_structured_endpoint``.
        data_df = self._load_frame(ep_settings, field_dicts, eligible_ids)

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
                    pdf_path=portability.to_posix(record_data.get(Fields.FILE, "")),
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
            raise InvalidStateError("colrev.structured endpoint is not configured")

        data_path = self._get_structured_data_path(ep_settings)
        field_dicts = self._normalize_fields(ep_settings.get("fields", []))

        eligible_ids = self._eligible_ids()
        # The CSV may not exist yet (loading the queue no longer creates it):
        # build the full frame, then write it with this record's values.
        data_df = self._load_frame(ep_settings, field_dicts, eligible_ids)
        mask = data_df[Fields.ID] == req.record_id
        if mask.sum() == 0:
            raise ValueError(f"Record '{req.record_id}' not found in data CSV")

        for field_name, field_value in req.values.items():
            if field_name in data_df.columns:
                data_df.loc[mask, field_name] = str(field_value)

        self._write_frame(ep_settings, data_df)

        data_operation = self.op(OperationsType.data, notify=True)
        data_operation.main(silent_mode=True)

        data_df = self._read_csv(data_path)
        field_names = [f["name"] for f in field_dicts]
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
    )
    def export_data_csv(self, req: ExportDataCsvRequest) -> ExportDataCsvResponse:
        assert self.review_manager is not None
        logger.info("Exporting data CSV for project %s", req.project_id)

        ep_settings = self._find_structured_endpoint()
        if ep_settings is None:
            raise InvalidStateError("colrev.structured endpoint is not configured")

        data_path = self._get_structured_data_path(ep_settings)
        if not data_path.is_file():
            raise InvalidStateError("No data CSV file found")

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

            self._rewrite_csv_for_fields(ep_dict, normalized_fields, req.fields)
        else:
            new_ep = {
                "endpoint": "colrev.structured",
                "version": "0.1",
                "fields": normalized_fields,
                "data_path_relative": "data/data/data.csv",
            }
            self.review_manager.settings.data.data_package_endpoints.append(new_ep)
            self._rewrite_csv_for_fields(new_ep, normalized_fields, req.fields)

        # Stages settings.json (commits are driven by ``commit_changes``).
        self.review_manager.save_settings()

        return ConfigureStructuredEndpointResponse(
            project_id=req.project_id,
            fields=normalized_fields,
            message=f"Configured {len(normalized_fields)} extraction fields",
        )

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _normalize_fields(fields: List[Any]) -> List[Dict[str, Any]]:
        """Field definitions (dicts or settings objects) as plain dicts."""
        out: List[Dict[str, Any]] = []
        for f in fields:
            if isinstance(f, dict):
                out.append(f)
                continue
            fd: Dict[str, Any] = {
                "name": f.name,
                "explanation": f.explanation,
                "data_type": f.data_type,
            }
            if getattr(f, "options", None):
                fd["options"] = f.options
            if getattr(f, "optional", False):
                fd["optional"] = True
            out.append(fd)
        return out

    @staticmethod
    def _read_csv(path: Path) -> pd.DataFrame:
        # keep_default_na=False: "NA", "N/A", "None", "null" and blank cells are
        # values the user typed, not missing data. Without it pandas turns them
        # into NaN ("nan" on display) and a later write erases them.
        return pd.read_csv(path, dtype=str, keep_default_na=False)

    @staticmethod
    def _complete_frame(
        data_df: pd.DataFrame,
        field_dicts: List[Dict[str, Any]],
        eligible_ids: List[str],
    ) -> pd.DataFrame:
        """Add a row for every eligible record that has none, and clear "TODO"
        placeholders in optional columns (so that
        ``structured.update_record_status_matrix`` accepts them). In memory
        only."""
        field_names = {f["name"] for f in field_dicts}
        optional_names = {f["name"] for f in field_dicts if f.get("optional")}
        columns = list(data_df.columns)

        existing_ids = set(data_df[Fields.ID].tolist())
        new_rows = []
        for rid in eligible_ids:
            if rid in existing_ids:
                continue
            row: Dict[str, List[str]] = {Fields.ID: [rid]}
            for col in columns:
                if col == Fields.ID:
                    continue
                # Columns of removed fields are not part of the extraction.
                row[col] = (
                    ["TODO"]
                    if col in field_names and col not in optional_names
                    else [""]
                )
            new_rows.append(pd.DataFrame(row)[columns])
        if new_rows:
            data_df = pd.concat([data_df, *new_rows], axis=0, ignore_index=True)

        for col in optional_names:
            if col in data_df.columns:
                data_df.loc[data_df[col] == "TODO", col] = ""

        return data_df.sort_values(by=[Fields.ID]).reset_index(drop=True)

    def _load_frame(
        self,
        ep_settings: Dict[str, Any],
        field_dicts: List[Dict[str, Any]],
        eligible_ids: List[str],
    ) -> pd.DataFrame:
        """The extraction table as it should be, built in memory (no writes):
        the CSV if there is one, completed for the eligible records."""
        data_path = self._get_structured_data_path(ep_settings)
        if data_path.is_file():
            data_df = self._read_csv(data_path)
        else:
            data_df = pd.DataFrame(
                columns=[Fields.ID] + [f["name"] for f in field_dicts]
            )
        return self._complete_frame(data_df, field_dicts, eligible_ids)

    def _eligible_ids(self) -> List[str]:
        assert self.review_manager is not None
        # Instantiating the operation is what lets the review manager load
        # records (it runs the precondition checks).
        self.op(OperationsType.data, notify=True)
        records_dict = self.review_manager.dataset.load_records_dict() or {}
        return [
            rid
            for rid, r in records_dict.items()
            if r.get(Fields.STATUS)
            in [RecordState.rev_included, RecordState.rev_synthesized]
        ]

    def _write_frame(self, ep_settings: Dict[str, Any], data_df: pd.DataFrame) -> None:
        """Write the extraction table and stage it."""
        assert self.review_manager is not None
        data_path = self._get_structured_data_path(ep_settings)
        data_path.parent.mkdir(parents=True, exist_ok=True)
        data_df.to_csv(
            data_path, index=False, quoting=csv.QUOTE_ALL, lineterminator="\n"
        )
        self.review_manager.dataset.git_repo.add_changes(
            Path(ep_settings.get("data_path_relative", "data/data/data.csv")),
            ignore_missing=True,
        )

    def _rewrite_csv_for_fields(
        self,
        ep_settings: Dict[str, Any],
        normalized_fields: List[Dict[str, Any]],
        specs: List[StructuredFieldSpec],
    ) -> None:
        """Bring the CSV in line with a new field set without losing data.

        A renamed field (``previous_name``) carries its column over. A removed
        field's column stays in the file (placeholders cleared) so that its
        values are not lost and come back if the field is re-added.
        """
        assert self.review_manager is not None
        data_path = self._get_structured_data_path(ep_settings)
        old_df = (
            self._read_csv(data_path)
            if data_path.is_file()
            else pd.DataFrame(columns=[Fields.ID])
        )
        old_columns = list(old_df.columns)

        # Which old column feeds which new field. Renames first, so that a new
        # field that reuses a renamed field's old name does not also take it.
        source: Dict[str, str] = {}
        claimed: set = set()
        for spec in specs:
            prev = spec.previous_name
            if prev and prev != spec.name and prev in old_columns and prev != Fields.ID:
                source[spec.name] = prev
                claimed.add(prev)
        for spec in specs:
            if spec.name in source:
                continue
            if spec.name in old_columns and spec.name not in claimed:
                source[spec.name] = spec.name
                claimed.add(spec.name)

        new_df = pd.DataFrame({Fields.ID: old_df[Fields.ID]})
        for f in normalized_fields:
            default = "" if f.get("optional") else "TODO"
            if f["name"] in source:
                new_df[f["name"]] = old_df[source[f["name"]]]
            else:
                new_df[f["name"]] = default
        for col in old_columns:
            if col != Fields.ID and col not in claimed:
                # Kept for the data, but a placeholder must not hold records
                # back from completing.
                new_df[col] = old_df[col].where(old_df[col] != "TODO", "")

        new_df = self._complete_frame(new_df, normalized_fields, self._eligible_ids())
        self._write_frame(ep_settings, new_df)

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
