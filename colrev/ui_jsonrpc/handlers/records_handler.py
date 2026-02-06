"""Handler for records operations.

JSON-RPC Endpoints:
    - get_records: Get records with filtering and pagination
    - get_record: Get a single record by ID
    - update_record: Update a record's fields

See docs/source/api/jsonrpc/records.rst for full endpoint documentation.
"""

import logging
from typing import Any, Dict, List, Optional

import colrev.record.record
import colrev.review_manager
from colrev.constants import Fields, RecordState
from colrev.ui_jsonrpc import response_formatter, validation as param_validation

logger = logging.getLogger(__name__)

# Default pagination settings
DEFAULT_LIMIT = 50
MAX_LIMIT = 500


class RecordsHandler:
    """Handle records-related JSON-RPC methods.

    This handler provides endpoints for retrieving and updating records
    in the project dataset.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize records handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def get_records(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get records with filtering and pagination.

        Retrieves records from the project dataset with optional filtering
        by status, search source, entry type, and text search. Supports
        pagination and sorting.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - filters (dict, optional): Filter criteria:
                    - status (list): Filter by record status(es)
                    - search_source (str): Filter by origin source
                    - entrytype (list): Filter by entry type
                    - search_text (str): Full-text search in title/abstract/author
                    - has_pdf (bool): Has PDF attached
                    - year_from (int): Minimum year
                    - year_to (int): Maximum year
                - sort (dict, optional): Sort configuration:
                    - field (str): Field to sort by ("year", "author", "title", "status")
                    - direction (str): "asc" or "desc"
                - pagination (dict, optional): Pagination:
                    - offset (int): Skip first N records
                    - limit (int): Max records to return (default: 50, max: 500)
                - fields (list, optional): Specific fields to return

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - total_count (int): Total matching records
                - records (list): List of record dictionaries
                - pagination (dict): Pagination info (offset, limit, has_more)
        """
        project_id = params["project_id"]
        filters = param_validation.get_optional_param(params, "filters", {})
        sort_config = param_validation.get_optional_param(params, "sort", None)
        pagination = param_validation.get_optional_param(params, "pagination", {})
        requested_fields = param_validation.get_optional_param(params, "fields", None)

        logger.info(f"Getting records for project {project_id}")

        # Need to get an operation to enable record loading
        # Using status operation as it's generic and doesn't modify state
        self.review_manager.get_status_operation()

        # Load all records (may return empty dict for new projects)
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        # Apply filters
        filtered_records = self._apply_filters(list(records_dict.values()), filters)

        # Get total count before pagination
        total_count = len(filtered_records)

        # Apply sorting
        if sort_config:
            filtered_records = self._apply_sorting(filtered_records, sort_config)

        # Apply pagination
        offset = pagination.get("offset", 0)
        limit = min(pagination.get("limit", DEFAULT_LIMIT), MAX_LIMIT)

        paginated_records = filtered_records[offset:offset + limit]
        has_more = (offset + limit) < total_count

        # Format records for response
        formatted_records = [
            self._format_record(record, requested_fields)
            for record in paginated_records
        ]

        return {
            "success": True,
            "total_count": total_count,
            "records": formatted_records,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "has_more": has_more,
            },
        }

    def get_record(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get a single record by ID.

        Retrieves complete record data for a specific record.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - record (dict): Complete record data

        Raises:
            ValueError: If record_id is not found
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")

        if not record_id:
            raise ValueError("record_id parameter is required")

        logger.info(f"Getting record {record_id} from project {project_id}")

        # Need to get an operation to enable record loading
        self.review_manager.get_status_operation()

        # Load all records
        records_dict = self.review_manager.dataset.load_records_dict()

        if record_id not in records_dict:
            raise ValueError(f"Record '{record_id}' not found")

        record = records_dict[record_id]

        return {
            "success": True,
            "record": self._format_record(record, None),
        }

    def update_record(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update a record's fields.

        Updates specified fields of a record in the dataset.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID (required)
                - fields (dict): Fields to update (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - record (dict): Updated record data
                - message (str): Success message

        Raises:
            ValueError: If record_id is not found or fields is missing
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

        logger.info(f"Updating record {record_id} in project {project_id}")

        # Need to get an operation to enable record loading
        self.review_manager.get_status_operation()

        # Load all records
        records_dict = self.review_manager.dataset.load_records_dict()

        if record_id not in records_dict:
            raise ValueError(f"Record '{record_id}' not found")

        # Get the record and update fields
        record_dict = records_dict[record_id]

        # Prevent updating certain protected fields
        protected_fields = {Fields.ID, Fields.ORIGIN, Fields.MD_PROV, Fields.D_PROV}
        for field in protected_fields:
            if field in fields_to_update:
                raise ValueError(f"Cannot update protected field: {field}")

        # Update the record fields
        updated_fields = []
        for field, value in fields_to_update.items():
            if field == Fields.STATUS:
                # Handle status updates specially - convert string to enum
                if isinstance(value, str):
                    try:
                        value = RecordState[value]
                    except KeyError:
                        raise ValueError(f"Invalid status value: {value}")
            record_dict[field] = value
            updated_fields.append(field)

        # Save the updated record
        self.review_manager.dataset.save_records_dict(
            {record_id: record_dict},
            partial=True,
        )

        # Create commit if not skipped
        if not skip_commit and updated_fields:
            self.review_manager.create_commit(
                msg=f"Update record {record_id}: {', '.join(updated_fields[:3])}{'...' if len(updated_fields) > 3 else ''}",
            )

        return response_formatter.format_operation_response(
            operation_name="update_record",
            project_id=project_id,
            details={
                "record": self._format_record(record_dict, None),
                "message": f"Updated {len(updated_fields)} field(s)",
            },
        )

    def _apply_filters(
        self,
        records: List[Dict[str, Any]],
        filters: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Apply filter criteria to records."""
        if not filters:
            return records

        filtered = records

        # Filter by status
        if "status" in filters and filters["status"]:
            status_values = filters["status"]
            if isinstance(status_values, str):
                status_values = [status_values]
            # Convert string status names to RecordState enums
            status_enums = []
            for s in status_values:
                if isinstance(s, str):
                    try:
                        status_enums.append(RecordState[s])
                    except KeyError:
                        pass  # Skip invalid status names
                else:
                    status_enums.append(s)
            filtered = [
                r for r in filtered
                if r.get(Fields.STATUS) in status_enums
            ]

        # Filter by search source (origin)
        if "search_source" in filters and filters["search_source"]:
            source = filters["search_source"]
            filtered = [
                r for r in filtered
                if any(source in origin for origin in r.get(Fields.ORIGIN, []))
            ]

        # Filter by entry type
        if "entrytype" in filters and filters["entrytype"]:
            entry_types = filters["entrytype"]
            if isinstance(entry_types, str):
                entry_types = [entry_types]
            filtered = [
                r for r in filtered
                if r.get(Fields.ENTRYTYPE) in entry_types
            ]

        # Filter by text search
        if "search_text" in filters and filters["search_text"]:
            search_text = filters["search_text"].lower()
            filtered = [
                r for r in filtered
                if (
                    search_text in r.get(Fields.TITLE, "").lower()
                    or search_text in r.get(Fields.ABSTRACT, "").lower()
                    or search_text in r.get(Fields.AUTHOR, "").lower()
                )
            ]

        # Filter by has_pdf
        if "has_pdf" in filters:
            has_pdf = filters["has_pdf"]
            if has_pdf:
                filtered = [
                    r for r in filtered
                    if r.get(Fields.FILE)
                ]
            else:
                filtered = [
                    r for r in filtered
                    if not r.get(Fields.FILE)
                ]

        # Filter by year range
        if "year_from" in filters and filters["year_from"]:
            year_from = int(filters["year_from"])
            filtered = [
                r for r in filtered
                if self._get_year(r) >= year_from
            ]

        if "year_to" in filters and filters["year_to"]:
            year_to = int(filters["year_to"])
            filtered = [
                r for r in filtered
                if self._get_year(r) <= year_to
            ]

        return filtered

    def _apply_sorting(
        self,
        records: List[Dict[str, Any]],
        sort_config: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        """Apply sorting to records."""
        field = sort_config.get("field", "year")
        direction = sort_config.get("direction", "desc")
        reverse = direction == "desc"

        def get_sort_key(record: Dict[str, Any]) -> Any:
            if field == "year":
                return self._get_year(record)
            elif field == "status":
                status = record.get(Fields.STATUS)
                return status.value if hasattr(status, 'value') else 0
            else:
                return str(record.get(field, "")).lower()

        return sorted(records, key=get_sort_key, reverse=reverse)

    def _get_year(self, record: Dict[str, Any]) -> int:
        """Extract year as integer from record."""
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
        """Format a record for API response."""
        # Convert status enum to string
        formatted = {}

        for key, value in record.items():
            if key == Fields.STATUS and hasattr(value, 'name'):
                formatted[key] = value.name
            elif key == Fields.ORIGIN and isinstance(value, list):
                formatted[key] = value
            elif key in (Fields.MD_PROV, Fields.D_PROV) and isinstance(value, dict):
                # Simplify provenance for API response
                formatted[key] = {
                    k: {"source": v.get("source", ""), "note": v.get("note", "")}
                    if isinstance(v, dict) else str(v)
                    for k, v in value.items()
                }
            else:
                formatted[key] = value

        # If specific fields requested, filter
        if requested_fields:
            # Always include ID and status
            always_include = {Fields.ID, Fields.STATUS, Fields.ENTRYTYPE}
            fields_to_include = set(requested_fields) | always_include
            formatted = {
                k: v for k, v in formatted.items()
                if k in fields_to_include
            }

        return formatted
