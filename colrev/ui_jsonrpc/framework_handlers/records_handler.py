"""Framework-native records handler.

JSON-RPC methods:
    - get_records: Paginated/filtered record listing (read-only).
    - get_record: Fetch a single record by ID (read-only).
    - update_record: Mutate selected fields of a record.

Commit behavior: writes stage changes only; commits are driven explicitly
via the ``commit_changes`` endpoint in ``git_handler``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

from colrev.constants import Fields
from colrev.constants import RecordState
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 50
MAX_LIMIT = 500


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class RecordFilters(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: Optional[Any] = None
    search_source: Optional[str] = None
    entrytype: Optional[Any] = None
    search_text: Optional[str] = None
    has_pdf: Optional[bool] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    is_merged_duplicate: Optional[bool] = None


class SortConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = "year"
    direction: str = "desc"


class Pagination(BaseModel):
    model_config = ConfigDict(extra="forbid")

    offset: int = 0
    limit: int = DEFAULT_LIMIT


class PaginationInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    offset: int
    limit: int
    has_more: bool


class GetRecordsRequest(ProjectScopedRequest):
    filters: Optional[RecordFilters] = None
    sort: Optional[SortConfig] = None
    pagination: Optional[Pagination] = None
    fields: Optional[List[str]] = None


class FormattedRecord(BaseModel):
    """A record dict formatted for the API.

    Accepts arbitrary bibliographic fields; identity/status are always present
    after formatting.
    """

    model_config = ConfigDict(extra="allow")


class GetRecordsResponse(ProjectResponse):
    total_count: int
    records: List[FormattedRecord]
    pagination: PaginationInfo


class GetRecordRequest(ProjectScopedRequest):
    record_id: Optional[str] = None


class GetRecordResponse(ProjectResponse):
    record: FormattedRecord


class UpdateRecordRequest(ProjectScopedRequest):
    record_id: Optional[str] = None
    fields: Optional[Dict[str, Any]] = None


class UpdateRecordResponse(ProjectResponse):
    operation: str
    details: Dict[str, Any]


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class RecordsHandler(BaseHandler):
    """All records JSON-RPC methods."""

    # -- get_records ---------------------------------------------------------

    @rpc_method(
        name="get_records",
        request=GetRecordsRequest,
        response=GetRecordsResponse,
    )
    def get_records(self, req: GetRecordsRequest) -> GetRecordsResponse:
        assert self.review_manager is not None
        logger.info("Getting records for project %s", req.project_id)

        # Need an operation to enable record loading; status is read-only.
        self.review_manager.get_status_operation()

        records_dict = self.review_manager.dataset.load_records_dict() or {}

        filters_dict = (
            req.filters.model_dump(exclude_none=True) if req.filters else {}
        )
        filtered_records = self._apply_filters(
            list(records_dict.values()), filters_dict
        )
        total_count = len(filtered_records)

        if req.sort is not None:
            filtered_records = self._apply_sorting(
                filtered_records, req.sort.model_dump()
            )

        offset = req.pagination.offset if req.pagination else 0
        limit = min(
            (req.pagination.limit if req.pagination else DEFAULT_LIMIT),
            MAX_LIMIT,
        )

        paginated_records = filtered_records[offset : offset + limit]
        has_more = (offset + limit) < total_count

        formatted_records = [
            FormattedRecord(**self._format_record(record, req.fields))
            for record in paginated_records
        ]

        return GetRecordsResponse(
            project_id=req.project_id,
            total_count=total_count,
            records=formatted_records,
            pagination=PaginationInfo(
                offset=offset, limit=limit, has_more=has_more
            ),
        )

    # -- get_record ----------------------------------------------------------

    @rpc_method(
        name="get_record",
        request=GetRecordRequest,
        response=GetRecordResponse,
    )
    def get_record(self, req: GetRecordRequest) -> GetRecordResponse:
        assert self.review_manager is not None
        if not req.record_id:
            raise ValueError("record_id parameter is required")

        logger.info(
            "Getting record %s from project %s", req.record_id, req.project_id
        )

        self.review_manager.get_status_operation()
        records_dict = self.review_manager.dataset.load_records_dict()

        if req.record_id not in records_dict:
            raise ValueError(f"Record '{req.record_id}' not found")

        record = records_dict[req.record_id]
        return GetRecordResponse(
            project_id=req.project_id,
            record=FormattedRecord(**self._format_record(record, None)),
        )

    # -- update_record -------------------------------------------------------

    @rpc_method(
        name="update_record",
        request=UpdateRecordRequest,
        response=UpdateRecordResponse,
    )
    def update_record(self, req: UpdateRecordRequest) -> UpdateRecordResponse:
        assert self.review_manager is not None
        if not req.record_id:
            raise ValueError("record_id parameter is required")

        fields_to_update = req.fields
        if not fields_to_update:
            raise ValueError("fields parameter is required")
        if not isinstance(fields_to_update, dict):
            raise ValueError("fields must be a dictionary")

        logger.info(
            "Updating record %s in project %s", req.record_id, req.project_id
        )

        self.review_manager.get_status_operation()
        records_dict = self.review_manager.dataset.load_records_dict()

        if req.record_id not in records_dict:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records_dict[req.record_id]

        # Protected fields (match legacy implementation exactly).
        protected_fields = {
            Fields.ID,
            Fields.ORIGIN,
            Fields.MD_PROV,
            Fields.D_PROV,
        }
        for field in protected_fields:
            if field in fields_to_update:
                raise ValueError(f"Cannot update protected field: {field}")

        updated_fields: List[str] = []
        for field, value in fields_to_update.items():
            if field == Fields.STATUS:
                if isinstance(value, str):
                    try:
                        value = RecordState[value]
                    except KeyError:
                        raise ValueError(f"Invalid status value: {value}")
            record_dict[field] = value
            updated_fields.append(field)

        self.review_manager.dataset.save_records_dict(
            {req.record_id: record_dict},
            partial=True,
        )

        return UpdateRecordResponse(
            project_id=req.project_id,
            operation="update_record",
            details={
                "record": self._format_record(record_dict, None),
                "message": f"Updated {len(updated_fields)} field(s)",
            },
        )

    # -- helpers -------------------------------------------------------------

    def _apply_filters(
        self,
        records: List[Dict[str, Any]],
        filters: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not filters:
            return records

        filtered = records

        if "status" in filters and filters["status"]:
            status_values = filters["status"]
            if isinstance(status_values, str):
                status_values = [status_values]
            status_enums = []
            for s in status_values:
                if isinstance(s, str):
                    try:
                        status_enums.append(RecordState[s])
                    except KeyError:
                        pass
                else:
                    status_enums.append(s)
            filtered = [
                r for r in filtered if r.get(Fields.STATUS) in status_enums
            ]

        if "search_source" in filters and filters["search_source"]:
            source = filters["search_source"]
            filtered = [
                r
                for r in filtered
                if any(source in origin for origin in r.get(Fields.ORIGIN, []))
            ]

        if "entrytype" in filters and filters["entrytype"]:
            entry_types = filters["entrytype"]
            if isinstance(entry_types, str):
                entry_types = [entry_types]
            filtered = [
                r for r in filtered if r.get(Fields.ENTRYTYPE) in entry_types
            ]

        if "search_text" in filters and filters["search_text"]:
            search_text = filters["search_text"].lower()
            filtered = [
                r
                for r in filtered
                if (
                    search_text in r.get(Fields.TITLE, "").lower()
                    or search_text in r.get(Fields.ABSTRACT, "").lower()
                    or search_text in r.get(Fields.AUTHOR, "").lower()
                )
            ]

        if "has_pdf" in filters:
            has_pdf = filters["has_pdf"]
            if has_pdf:
                filtered = [r for r in filtered if r.get(Fields.FILE)]
            else:
                filtered = [r for r in filtered if not r.get(Fields.FILE)]

        if "year_from" in filters and filters["year_from"]:
            year_from = int(filters["year_from"])
            filtered = [r for r in filtered if self._get_year(r) >= year_from]

        if "year_to" in filters and filters["year_to"]:
            year_to = int(filters["year_to"])
            filtered = [r for r in filtered if self._get_year(r) <= year_to]

        if "is_merged_duplicate" in filters:
            if filters["is_merged_duplicate"]:
                filtered = [
                    r
                    for r in filtered
                    if len(
                        [
                            o
                            for o in r.get(Fields.ORIGIN, [])
                            if not o.startswith("md_")
                        ]
                    )
                    > 1
                ]

        return filtered

    def _apply_sorting(
        self,
        records: List[Dict[str, Any]],
        sort_config: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        field = sort_config.get("field", "year")
        direction = sort_config.get("direction", "desc")
        reverse = direction == "desc"

        def get_sort_key(record: Dict[str, Any]) -> Any:
            if field == "year":
                return self._get_year(record)
            if field == "status":
                status = record.get(Fields.STATUS)
                return status.value if hasattr(status, "value") else 0
            return str(record.get(field, "")).lower()

        return sorted(records, key=get_sort_key, reverse=reverse)

    def _get_year(self, record: Dict[str, Any]) -> int:
        year_str = record.get(Fields.YEAR, "0")
        try:
            return int(year_str)
        except (ValueError, TypeError):
            return 0

    def _format_record(
        self,
        record: Dict[str, Any],
        requested_fields: Optional[List[str]],
    ) -> Dict[str, Any]:
        formatted: Dict[str, Any] = {}

        for key, value in record.items():
            if key == Fields.STATUS and hasattr(value, "name"):
                formatted[key] = value.name
            elif key == Fields.ORIGIN and isinstance(value, list):
                formatted[key] = value
            elif key in (Fields.MD_PROV, Fields.D_PROV) and isinstance(
                value, dict
            ):
                formatted[key] = {
                    k: (
                        {
                            "source": v.get("source", ""),
                            "note": v.get("note", ""),
                        }
                        if isinstance(v, dict)
                        else str(v)
                    )
                    for k, v in value.items()
                }
            else:
                formatted[key] = value

        # Computed: whether the PDF file referenced by this record is present
        # on disk. PDFs are gitignored, so metadata can say "prepared" while
        # the file is missing locally (e.g. collaborator uploaded but hasn't
        # shared the zip). None = no file expected.
        file_value = record.get(Fields.FILE)
        if file_value:
            assert self.review_manager is not None
            file_path = Path(str(file_value))
            if not file_path.is_absolute():
                file_path = self.review_manager.path / file_path
            formatted["file_on_disk"] = file_path.exists()
        else:
            formatted["file_on_disk"] = None

        if requested_fields:
            always_include = {
                Fields.ID,
                Fields.STATUS,
                Fields.ENTRYTYPE,
                "file_on_disk",
            }
            fields_to_include = set(requested_fields) | always_include
            formatted = {
                k: v for k, v in formatted.items() if k in fields_to_include
            }

        return formatted
