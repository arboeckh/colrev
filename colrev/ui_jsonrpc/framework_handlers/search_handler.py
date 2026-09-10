"""Framework-native search handler.

Implements all search-source management RPC methods atop the typed framework.

Writes stage changes via ``save_settings()`` / ``save_source_history()``;
commits are driven explicitly via the ``commit_changes`` endpoint in
``git_handler``. (Note: ``search.main`` is a colrev batch op that commits on
its own, matching the CLI behavior.)
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime
from datetime import timezone
from pathlib import Path
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict

from colrev.constants import OperationsType
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProgressEventKind
from colrev.ui_jsonrpc.framework.search_staleness import check_source_staleness
from colrev.ui_jsonrpc.framework.search_staleness import preserve_last_run_snapshot
from colrev.ui_jsonrpc.framework.search_staleness import restore_last_run_snapshot
from colrev.ui_jsonrpc.framework.search_staleness import run_config_snapshot
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import make_progress_callback
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class SearchRequest(ProjectScopedRequest):
    source: str = "all"
    rerun: bool = False


class SearchDetails(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str
    rerun: bool
    message: str


class SearchResponse(ProjectResponse):
    operation: str
    message: str
    details: SearchDetails


class GetSourcesRequest(ProjectScopedRequest):
    pass


class SourceInfo(BaseModel):
    """The wire shape built in ``get_sources``: :func:`_source_payload` plus the
    staleness metadata. Extra fields ride along via ``extra="allow"``."""

    model_config = ConfigDict(extra="allow")

    platform: Optional[str] = None
    search_results_path: Optional[str] = None
    search_string: Optional[str] = None
    search_type: Optional[str] = None
    search_parameters: Optional[Dict[str, Any]] = None
    record_count: Optional[int] = None
    last_run_timestamp: Optional[str] = None
    is_stale: Optional[bool] = None
    stale_reason: Optional[str] = None


class GetSourcesResponse(ProjectResponse):
    sources: List[SourceInfo]


class AddSourceRequest(ProjectScopedRequest):
    endpoint: Optional[str] = None
    search_type: Optional[str] = None
    search_string: str = ""
    filename: Optional[str] = None
    run_date: Optional[str] = None
    search_parameters: Optional[Dict[str, Any]] = None


class AddSourceDetails(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: Dict[str, Any]
    message: str


class AddSourceResponse(ProjectResponse):
    operation: str
    message: str
    details: AddSourceDetails


class UploadSearchFileRequest(ProjectScopedRequest):
    filename: Optional[str] = None
    content: Optional[str] = None
    encoding: str = "utf-8"
    source_template: Optional[str] = None


class UploadSearchFileResponse(ProjectResponse):
    # Legacy response is flat (no `operation`/`details` wrapper) to match the
    # frontend's UploadSearchFileResponse interface.
    model_config = ConfigDict(extra="allow")

    path: str
    detected_format: str
    message: str


class RemoveSourceRequest(ProjectScopedRequest):
    filename: Optional[str] = None
    delete_file: bool = False


class RemoveSourceDetails(BaseModel):
    model_config = ConfigDict(extra="allow")

    message: str


class RemoveSourceResponse(ProjectResponse):
    operation: str
    message: str
    details: RemoveSourceDetails


class UpdateSourceRequest(ProjectScopedRequest):
    filename: Optional[str] = None
    search_string: Optional[str] = None
    search_parameters: Optional[Dict[str, Any]] = None
    run_date: Optional[str] = None


class UpdateSourceDetails(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: Dict[str, Any]
    message: str


class UpdateSourceResponse(ProjectResponse):
    operation: str
    message: str
    details: UpdateSourceDetails


class PaginationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    offset: int = 0
    limit: int = 50


class GetSourceRecordsRequest(ProjectScopedRequest):
    filename: Optional[str] = None
    pagination: Optional[PaginationRequest] = None


class SourceRecord(BaseModel):
    model_config = ConfigDict(extra="allow")


class PaginationInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    offset: int
    limit: int
    has_more: bool


class GetSourceRecordsResponse(ProjectResponse):
    filename: str
    records: List[SourceRecord]
    total_count: int
    pagination: PaginationInfo


def _source_payload(source: Any) -> Dict[str, Any]:
    """``model_dump()`` plus the search parameters the UI needs.

    colrev's ``model_dump`` is deliberately minimal and drops
    ``search_parameters``, but the edit form has to re-open on the structured
    query the source was built from. The stored URL has already had its API key
    stripped, so it is safe to hand to the renderer.
    """

    payload = source.model_dump()
    parameters = getattr(source, "search_parameters", None)
    if parameters:
        payload["search_parameters"] = parameters
    return payload


_OPENALEX_QUERY_FIELDS: Dict[str, Any] = {
    "search": "",
    "search_exact": False,
    "year_from": None,
    "year_to": None,
    "open_access_only": False,
    "work_types": None,
    "sort": "relevance",
    "min_citations": None,
    "language": None,
    "has_abstract": False,
    "raw_url": None,
}


def _is_openalex_api_url(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return text.startswith("http") and "openalex.org" in text


def _coerce_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_openalex_query(
    *,
    search_string: str = "",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return the canonical, persistable OpenAlex query.

    The structured ``query`` is the source of truth and the ``url`` stored
    beside it is derived from it. Rebuilding therefore always starts from the
    query: reading the derived URL back in would pin the source to whatever it
    was first built with and silently drop every later edit.
    """

    extra = extra or {}
    incoming = extra.get("query")
    query: Dict[str, Any] = dict(_OPENALEX_QUERY_FIELDS)

    if incoming is None:
        # No structured query: a bare ``url`` is one the user pasted verbatim.
        raw_url = str(extra.get("url") or "").strip()
        query["raw_url"] = raw_url or None
        query["search"] = "" if raw_url else search_string.strip()
        return query

    for key in _OPENALEX_QUERY_FIELDS:
        if key in incoming:
            query[key] = incoming[key]
    if "work_types" not in incoming and "types" in incoming:
        query["work_types"] = incoming["types"]

    raw_url = str(query.get("raw_url") or "").strip()
    if not raw_url and _is_openalex_api_url(query.get("search")):
        # Sources predating structured queries stored the pasted URL in
        # ``search``; keep them on the raw-URL path instead of searching for
        # the URL as keywords.
        raw_url = str(query["search"]).strip()
    query["raw_url"] = raw_url or None

    if raw_url:
        query["search"] = ""
    else:
        query["search"] = str(query.get("search") or search_string or "").strip()

    work_types = query.get("work_types")
    if isinstance(work_types, str):
        work_types = [work_types]
    if work_types:
        cleaned = [str(t).strip() for t in work_types if str(t).strip()]
        query["work_types"] = cleaned or None
    else:
        query["work_types"] = None

    for numeric in ("year_from", "year_to", "min_citations"):
        query[numeric] = _coerce_int(query.get(numeric))
    for flag in ("search_exact", "open_access_only", "has_abstract"):
        query[flag] = bool(query.get(flag))
    query["sort"] = str(query.get("sort") or "relevance")
    language = str(query.get("language") or "").strip()
    query["language"] = language or None

    return query


def _build_openalex_search_parameters(
    *,
    search_string: str = "",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build OpenAlex search_parameters without storing the API key."""

    import colrev.env.environment_manager
    from colrev.packages.open_alex.src import open_alex_api
    from colrev.packages.open_alex.src.open_alex_query_builder import OpenAlexSearchParams
    from colrev.packages.open_alex.src.open_alex_query_builder import build_works_url
    from colrev.packages.open_alex.src.open_alex_query_builder import strip_sensitive_url_params

    api_key = open_alex_api.OpenAlexAPI.require_api_key()
    _, email = (
        colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git()
    )

    query = _normalize_openalex_query(search_string=search_string, extra=extra)

    if query["raw_url"]:
        params = OpenAlexSearchParams(raw_url=str(query["raw_url"]))
    else:
        params = OpenAlexSearchParams(
            search=query["search"],
            search_exact=query["search_exact"],
            year_from=query["year_from"],
            year_to=query["year_to"],
            open_access_only=query["open_access_only"],
            work_types=query["work_types"],
            sort=query["sort"],
            min_citations=query["min_citations"],
            language=query["language"],
            has_abstract=query["has_abstract"],
        )

    url = build_works_url(params, api_key=api_key, mailto=email or "")
    return {
        "url": strip_sensitive_url_params(url),
        "query": query,
    }


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class SearchHandler(BaseHandler):
    """All search-source JSON-RPC methods."""

    # -- search --------------------------------------------------------------

    @rpc_method(
        name="search",
        request=SearchRequest,
        response=SearchResponse,
        operation_type=OperationsType.search,
        writes=True,
    )
    def search(self, req: SearchRequest) -> SearchResponse:
        assert self.review_manager is not None
        logger.info("Running search operation for project %s", req.project_id)

        search_operation = self.op(OperationsType.search, notify=True)

        # Tag every event with the source being searched so the UI can attribute
        # progress to one card. A batch run fans out into one call per source,
        # so ``req.source`` identifies the card; "all" carries no attribution.
        progress_cb = make_progress_callback(
            ProgressEventKind.search_progress,
            source=None if req.source == "all" else req.source,
        )

        # When source is "all", don't pass selection_str; the decorator
        # _check_source_selection_exists validates the kwarg if passed and
        # "all" is not a valid path.
        if req.source == "all":
            search_operation.main(
                rerun=req.rerun,
                progress_callback=progress_cb,
            )
        else:
            search_operation.main(
                selection_str=req.source,
                rerun=req.rerun,
                progress_callback=progress_cb,
            )

        # Record last_run timestamps so the UI can distinguish
        # "never run" from "ran with 0 results".
        self.review_manager.settings = self.review_manager.load_settings()
        sources_to_mark = self.review_manager.settings.sources
        if req.source != "all":
            sources_to_mark = [
                s
                for s in sources_to_mark
                if str(s.search_results_path) == req.source
                or s.search_results_path.name in req.source
            ]

        for src in sources_to_mark:
            self._save_source_history(src)

        return SearchResponse(
            project_id=req.project_id,
            operation="search",
            message="Search operation completed successfully",
            details=SearchDetails(
                source=req.source,
                rerun=req.rerun,
                message="Search completed",
            ),
        )

    # -- get_sources ---------------------------------------------------------

    @rpc_method(
        name="get_sources",
        request=GetSourcesRequest,
        response=GetSourcesResponse,
        timeout_class="fast",
    )
    def get_sources(self, req: GetSourcesRequest) -> GetSourcesResponse:
        assert self.review_manager is not None
        logger.info("Getting sources for project %s", req.project_id)

        sources = self.review_manager.settings.sources
        sources_list: List[SourceInfo] = []

        for source in sources:
            source_dict = _source_payload(source)

            results_path = self.review_manager.path / source.search_results_path
            record_count = 0
            if results_path.exists():
                try:
                    from colrev.loader import load_utils

                    record_count = load_utils.get_nr_records(results_path)
                except Exception:  # noqa: BLE001
                    pass

            history_path = (
                self.review_manager.path / source.get_search_history_path()
            )
            is_stale, stale_reason = check_source_staleness(source, history_path)

            last_run_timestamp: Optional[str] = None
            if history_path.is_file():
                try:
                    with open(history_path, "r", encoding="utf-8") as f:
                        history_data = json.load(f)
                    last_run_timestamp = history_data.get("last_run")
                except (json.JSONDecodeError, OSError):
                    pass

            source_dict.update(
                {
                    "record_count": record_count,
                    "last_run_timestamp": last_run_timestamp,
                    "is_stale": is_stale,
                    "stale_reason": stale_reason,
                }
            )
            sources_list.append(SourceInfo(**source_dict))

        return GetSourcesResponse(
            project_id=req.project_id,
            sources=sources_list,
        )

    # -- add_source ----------------------------------------------------------

    @rpc_method(
        name="add_source",
        request=AddSourceRequest,
        response=AddSourceResponse,
        writes=True,
    )
    def add_source(self, req: AddSourceRequest) -> AddSourceResponse:
        assert self.review_manager is not None

        if not req.endpoint:
            raise ValueError("endpoint parameter is required")
        if not req.search_type:
            raise ValueError("search_type parameter is required")

        logger.info("Adding source %s to project %s", req.endpoint, req.project_id)

        from colrev.constants import EndpointType
        from colrev.constants import SearchType
        from colrev.package_manager.package_manager import PackageManager
        from colrev.search_file import ExtendedSearchFile

        try:
            search_type_enum = SearchType[req.search_type]
        except KeyError:
            valid_types = ", ".join([t.name for t in SearchType])
            raise ValueError(
                f"Invalid search_type '{req.search_type}'. Valid types: {valid_types}"
            )

        filename = req.filename
        if not filename:
            endpoint_name = req.endpoint.split(".")[-1]
            filename = f"data/search/{endpoint_name}.bib"

        package_manager = PackageManager()
        version = "1.0"
        try:
            search_source_class = package_manager.get_package_endpoint_class(
                package_type=EndpointType.search_source,
                package_identifier=req.endpoint,
            )
            if hasattr(search_source_class, "CURRENT_SYNTAX_VERSION"):
                version = search_source_class.CURRENT_SYNTAX_VERSION
        except Exception:  # noqa: BLE001
            pass

        new_source = ExtendedSearchFile(
            search_string=req.search_string,
            platform=req.endpoint,
            search_results_path=Path(filename),
            search_type=search_type_enum,
            version=version,
        )

        # API-based sources need constructed search parameters.
        if search_type_enum == SearchType.API and req.endpoint == "colrev.pubmed":
            import urllib.parse

            encoded_query = urllib.parse.quote(req.search_string)
            pubmed_url = (
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
                f"esearch.fcgi?db=pubmed&term={encoded_query}"
            )
            new_source.search_parameters = {"url": pubmed_url}

        elif search_type_enum == SearchType.API and req.endpoint == "colrev.open_alex":
            new_source.search_parameters = _build_openalex_search_parameters(
                search_string=req.search_string,
                extra=req.search_parameters,
            )

        self.review_manager.settings.sources.append(new_source)
        self.review_manager.save_settings()

        # For file-based (DB) sources, the file already contains results — mark
        # as run immediately.
        if search_type_enum == SearchType.DB:
            self._save_source_history(new_source, req.run_date)

        return AddSourceResponse(
            project_id=req.project_id,
            operation="add_source",
            message="Add_source operation completed successfully",
            details=AddSourceDetails(
                source=_source_payload(new_source),
                message=f"Added search source: {req.endpoint}",
            ),
        )

    # -- upload_search_file --------------------------------------------------

    @rpc_method(
        name="upload_search_file",
        request=UploadSearchFileRequest,
        response=UploadSearchFileResponse,
        writes=True,
    )
    def upload_search_file(
        self, req: UploadSearchFileRequest
    ) -> UploadSearchFileResponse:
        assert self.review_manager is not None

        if not req.filename:
            raise ValueError("filename parameter is required")
        if not req.content:
            raise ValueError("content parameter is required")

        logger.info(
            "Uploading search file %s to project %s", req.filename, req.project_id
        )

        # Sanitize filename to prevent path traversal.
        safe_filename = Path(req.filename).name
        if not safe_filename:
            raise ValueError("Invalid filename")

        search_dir = self.review_manager.path / "data" / "search"
        search_dir.mkdir(parents=True, exist_ok=True)
        target_path = search_dir / safe_filename

        if req.encoding == "base64":
            try:
                file_content: Any = base64.b64decode(req.content)
            except Exception as e:  # noqa: BLE001
                raise ValueError(f"Invalid base64 content: {e}")
            write_mode = "wb"
        else:
            file_content = req.content
            write_mode = "w"

        # CSV source template transform outputs BibTeX (avoids pandas NaN issue).
        if req.source_template and Path(safe_filename).suffix.lower() in (
            ".csv",
            ".xlsx",
        ):
            from colrev.ui_jsonrpc.csv_transforms import transform_csv

            csv_text = (
                file_content
                if isinstance(file_content, str)
                else file_content.decode("utf-8", errors="replace")
            )
            logger.info(
                "Applying CSV source template '%s'", req.source_template
            )
            file_content = transform_csv(csv_text, req.source_template)
            write_mode = "w"

            safe_filename = Path(safe_filename).stem + ".bib"
            target_path = search_dir / safe_filename

        with open(target_path, write_mode) as f:
            f.write(file_content)

        detected_format = self._detect_file_format(target_path)

        return UploadSearchFileResponse(
            project_id=req.project_id,
            path=str(target_path.relative_to(self.review_manager.path)),
            detected_format=detected_format,
            message=f"Uploaded search file: {safe_filename}",
        )

    # -- remove_source -------------------------------------------------------

    @rpc_method(
        name="remove_source",
        request=RemoveSourceRequest,
        response=RemoveSourceResponse,
        writes=True,
    )
    def remove_source(self, req: RemoveSourceRequest) -> RemoveSourceResponse:
        assert self.review_manager is not None

        if not req.filename:
            raise ValueError("filename parameter is required")

        logger.info(
            "Removing source %s from project %s", req.filename, req.project_id
        )

        sources = self.review_manager.settings.sources
        source_to_remove = None
        source_index = None

        for i, source in enumerate(sources):
            source_filename = str(source.search_results_path)
            if source_filename == req.filename or source_filename.endswith(
                req.filename
            ):
                source_to_remove = source
                source_index = i
                break

        if source_to_remove is None:
            raise ValueError(f"Source with filename '{req.filename}' not found")

        self.review_manager.settings.sources.pop(source_index)

        # Sources are re-loaded by scanning *_search_history.json files, so
        # removing that file is required for permanent removal.
        search_history_path = (
            self.review_manager.path / source_to_remove.get_search_history_path()
        )
        if search_history_path.exists():
            search_history_path.unlink()
            logger.info("Deleted search history file: %s", search_history_path)

        self.review_manager.save_settings()

        if req.delete_file:
            file_path = (
                self.review_manager.path / source_to_remove.search_results_path
            )
            if file_path.exists():
                file_path.unlink()
                logger.info("Deleted search file: %s", file_path)

        return RemoveSourceResponse(
            project_id=req.project_id,
            operation="remove_source",
            message="Remove_source operation completed successfully",
            details=RemoveSourceDetails(
                message=f"Removed search source: {req.filename}",
            ),
        )

    # -- update_source -------------------------------------------------------

    @rpc_method(
        name="update_source",
        request=UpdateSourceRequest,
        response=UpdateSourceResponse,
        writes=True,
    )
    def update_source(self, req: UpdateSourceRequest) -> UpdateSourceResponse:
        assert self.review_manager is not None

        if not req.filename:
            raise ValueError("filename parameter is required")

        logger.info(
            "Updating source %s in project %s", req.filename, req.project_id
        )

        from colrev.constants import SearchType

        sources = self.review_manager.settings.sources
        source_to_update = None
        for source in sources:
            source_filename = str(source.search_results_path)
            if source_filename == req.filename or source_filename.endswith(
                req.filename
            ):
                source_to_update = source
                break

        if source_to_update is None:
            raise ValueError(f"Source with filename '{req.filename}' not found")

        history_path = (
            self.review_manager.path / source_to_update.get_search_history_path()
        )
        preserved_snapshot, preserved_last_run = (
            preserve_last_run_snapshot(history_path) if history_path.is_file() else (None, None)
        )

        # ``search_parameters`` is an optional attribute (file-based sources
        # have none), so edit a local copy and write it back only if it ends up
        # holding something.
        parameters: Dict[str, Any] = dict(
            getattr(source_to_update, "search_parameters", None) or {}
        )

        # The stored ``url`` is derived from the query, so whether the search
        # actually changed is decided by comparing the URL the source will be
        # run with — before and after. Comparing only ``search_string`` would
        # miss a filter-only edit (year range, open access, work types).
        previous_url = str(parameters.get("url") or "")
        stored_query = dict(parameters.get("query") or {})
        incoming_query = None
        if req.search_parameters is not None and isinstance(
            req.search_parameters.get("query"), dict
        ):
            incoming_query = dict(req.search_parameters["query"])

        is_api = source_to_update.search_type == SearchType.API
        search_string_changed = False
        if req.search_string is not None:
            search_string_changed = source_to_update.search_string != req.search_string
            source_to_update.search_string = req.search_string

            if is_api and source_to_update.platform == "colrev.pubmed":
                import urllib.parse

                encoded_query = urllib.parse.quote(req.search_string)
                pubmed_url = (
                    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
                    f"esearch.fcgi?db=pubmed&term={encoded_query}"
                )
                parameters["url"] = pubmed_url
                logger.info("Rebuilt PubMed URL: %s", pubmed_url)

        if req.search_parameters is not None:
            parameters.update(req.search_parameters)

        if (
            is_api
            and source_to_update.platform == "colrev.open_alex"
            # Rebuilding needs the API key; skip it for edits that touch
            # neither the query nor the search string (e.g. run_date only).
            and (req.search_string is not None or incoming_query is not None)
        ):
            # Merge over the stored query so a partial edit keeps the filters
            # it did not mention, then rebuild the URL from that merge.
            merged_query = {**stored_query, **(incoming_query or {})}
            if req.search_string is not None:
                merged_query["search"] = req.search_string
            parameters.update(
                _build_openalex_search_parameters(
                    search_string=req.search_string or "",
                    extra={"query": merged_query},
                )
            )
            logger.info("Rebuilt OpenAlex URL from the updated query")

        if parameters or hasattr(source_to_update, "search_parameters"):
            source_to_update.search_parameters = parameters

        new_url = str(parameters.get("url") or "")
        query_changed = search_string_changed or new_url != previous_url

        # If the query changed, wipe results so the next search starts fresh.
        if query_changed:
            results_path = (
                self.review_manager.path / source_to_update.search_results_path
            )
            if results_path.exists():
                logger.info(
                    "Query changed, clearing results file: %s", results_path
                )
                results_path.unlink()
                results_path.touch()

        self.review_manager.save_settings()

        if query_changed:
            restore_last_run_snapshot(
                history_path, preserved_snapshot, preserved_last_run
            )

        if req.run_date and source_to_update.search_type == SearchType.DB:
            self._save_source_history(source_to_update, req.run_date)

        return UpdateSourceResponse(
            project_id=req.project_id,
            operation="update_source",
            message="Update_source operation completed successfully",
            details=UpdateSourceDetails(
                source=_source_payload(source_to_update),
                message=f"Updated search source: {req.filename}",
            ),
        )

    # -- get_source_records --------------------------------------------------

    @rpc_method(
        name="get_source_records",
        request=GetSourceRecordsRequest,
        response=GetSourceRecordsResponse,
    )
    def get_source_records(
        self, req: GetSourceRecordsRequest
    ) -> GetSourceRecordsResponse:
        assert self.review_manager is not None

        from colrev.constants import Fields

        if not req.filename:
            raise ValueError("filename parameter is required")

        logger.info(
            "Getting records from source %s in project %s",
            req.filename,
            req.project_id,
        )

        source = None
        for s in self.review_manager.settings.sources:
            source_filename = str(s.search_results_path)
            if source_filename == req.filename or source_filename.endswith(
                req.filename
            ):
                source = s
                break

        if source is None:
            raise ValueError(f"Source with filename '{req.filename}' not found")

        origin_prefix = Path(source.search_results_path).name

        # Prefer main dataset (post-load); fall back to the raw search file
        # (post-search, pre-load).
        self.review_manager.get_status_operation()
        records_dict = self.review_manager.dataset.load_records_dict() or {}

        filtered_records: List[Dict[str, Any]] = []
        for record in records_dict.values():
            origins = record.get(Fields.ORIGIN, [])
            for origin in origins:
                if origin.startswith(origin_prefix + "/") or origin.startswith(
                    origin_prefix
                ):
                    filtered_records.append(record)
                    break

        if not filtered_records:
            results_path = self.review_manager.path / source.search_results_path
            if results_path.exists():
                filtered_records = self._read_search_file_records(results_path)

        total_count = len(filtered_records)

        pagination = req.pagination or PaginationRequest()
        offset = pagination.offset
        limit = min(pagination.limit, 500)
        paginated_records = filtered_records[offset : offset + limit]
        has_more = (offset + limit) < total_count

        formatted_records: List[SourceRecord] = []
        for record in paginated_records:
            status = record.get(Fields.STATUS)
            status_str = (
                status.name
                if hasattr(status, "name")
                else str(status)
                if status
                else ""
            )
            formatted: Dict[str, Any] = {
                "ID": record.get(Fields.ID, ""),
                "ENTRYTYPE": record.get(Fields.ENTRYTYPE, ""),
                "title": record.get(Fields.TITLE, ""),
                "author": record.get(Fields.AUTHOR, ""),
                "year": record.get(Fields.YEAR, ""),
                "colrev_status": status_str,
            }
            if record.get(Fields.JOURNAL):
                formatted["journal"] = record[Fields.JOURNAL]
            if record.get(Fields.BOOKTITLE):
                formatted["booktitle"] = record[Fields.BOOKTITLE]
            if record.get(Fields.DOI):
                formatted["doi"] = record[Fields.DOI]
            if record.get(Fields.ABSTRACT):
                abstract = record[Fields.ABSTRACT]
                formatted["abstract"] = (
                    abstract[:500] + "..." if len(abstract) > 500 else abstract
                )
            formatted_records.append(SourceRecord(**formatted))

        return GetSourceRecordsResponse(
            project_id=req.project_id,
            filename=req.filename,
            records=formatted_records,
            total_count=total_count,
            pagination=PaginationInfo(
                offset=offset,
                limit=limit,
                has_more=has_more,
            ),
        )

    # -- helpers -------------------------------------------------------------

    def _save_source_history(
        self, source, run_date: Optional[str] = None
    ) -> None:
        """Save/update the search history JSON file, marking the source run."""
        assert self.review_manager is not None
        history_path = self.review_manager.path / source.get_search_history_path()

        if run_date:
            last_run = run_date
        else:
            last_run = datetime.now(tz=timezone.utc).isoformat()

        history_data = source.to_dict()
        history_data.pop("search_history_path", None)
        history_data["last_run"] = last_run
        history_data["last_run_config"] = run_config_snapshot(source)
        # Mirror on the in-memory object so save_settings() preserves it.
        source.last_run = last_run

        history_path.parent.mkdir(parents=True, exist_ok=True)
        with open(history_path, "w", encoding="utf-8") as f:
            json.dump(history_data, f, indent=4, ensure_ascii=False)

        self.review_manager.dataset.git_repo.add_changes(history_path)

    def _read_search_file_records(self, file_path: Path) -> List[Dict[str, Any]]:
        """Read records from a search file (fallback pre-load).

        Maps format-specific field names (RIS, NBIB, ENL, CSV) to standard
        fields; defaults to BibTeX for .bib and unknown formats.
        """
        records: List[Dict[str, Any]] = []

        try:
            suffix = file_path.suffix.lower()

            if suffix == ".ris":
                from colrev.loader.ris import RISLoader

                loader = RISLoader(
                    filename=file_path, unique_id_field="INCREMENTAL"
                )
                raw_records = loader.load_records_list()
                for i, raw in enumerate(raw_records):
                    record = {
                        "ID": raw.get("ID", str(i + 1)),
                        "ENTRYTYPE": self._ris_type_to_entrytype(
                            raw.get("TY", "")
                        ),
                        "title": raw.get("T1", raw.get("TI", "")),
                        "author": self._format_ris_authors(
                            raw.get("A1", raw.get("AU", []))
                        ),
                        "year": self._extract_year(
                            raw.get("Y1", raw.get("PY", ""))
                        ),
                        "journal": raw.get("JF", raw.get("T2", "")),
                        "doi": raw.get("DO", ""),
                        "abstract": raw.get("N2", raw.get("AB", "")),
                    }
                    records.append(record)

            elif suffix == ".nbib":
                from colrev.loader.nbib import NBIBLoader

                loader = NBIBLoader(
                    filename=file_path, unique_id_field="INCREMENTAL"
                )
                raw_records = loader.load_records_list()
                for i, raw in enumerate(raw_records):
                    record = {
                        "ID": raw.get("ID", str(i + 1)),
                        "ENTRYTYPE": "article",
                        "title": raw.get("TI", ""),
                        "author": self._format_ris_authors(raw.get("AU", [])),
                        "year": raw.get("DP", "")[:4] if raw.get("DP") else "",
                        "journal": raw.get("JT", ""),
                        "doi": raw.get("AID", ""),
                        "abstract": raw.get("AB", ""),
                    }
                    records.append(record)

            elif suffix in [".enl", ".txt"]:
                from colrev.loader.enl import ENLLoader

                loader = ENLLoader(
                    filename=file_path, unique_id_field="INCREMENTAL"
                )
                raw_records = loader.load_records_list()
                for i, raw in enumerate(raw_records):
                    record = {
                        "ID": raw.get("ID", str(i + 1)),
                        "ENTRYTYPE": "article",
                        "title": raw.get("%T", ""),
                        "author": self._format_ris_authors(raw.get("%A", [])),
                        "year": raw.get("%D", ""),
                        "journal": raw.get("%B", raw.get("%J", "")),
                        "abstract": raw.get("%X", ""),
                    }
                    records.append(record)

            elif suffix in [".csv", ".xls", ".xlsx"]:
                from colrev.loader.table import TableLoader

                loader = TableLoader(
                    filename=file_path, unique_id_field="INCREMENTAL"
                )
                raw_records = loader.load_records_list()
                for i, raw in enumerate(raw_records):
                    record = {
                        "ID": raw.get("ID", str(i + 1)),
                        "ENTRYTYPE": raw.get(
                            "ENTRYTYPE", raw.get("type", "article")
                        ),
                        "title": raw.get("title", raw.get("display_name", "")),
                        "author": raw.get(
                            "author",
                            raw.get("authorships.author.display_name", ""),
                        ),
                        "year": raw.get("year", raw.get("publication_year", "")),
                        "journal": raw.get(
                            "journal",
                            raw.get("primary_location.source.display_name", ""),
                        ),
                        "doi": raw.get("doi", ""),
                        "abstract": raw.get("abstract", ""),
                    }
                    records.append(record)

            else:
                from colrev.loader.bib import BIBLoader

                loader = BIBLoader(
                    filename=file_path, unique_id_field="INCREMENTAL"
                )
                records = loader.load_records_list()

        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to parse %s: %s", file_path, e)

        return records

    def _ris_type_to_entrytype(self, ris_type: str) -> str:
        mapping = {
            "JOUR": "article",
            "BOOK": "book",
            "CHAP": "inbook",
            "CONF": "inproceedings",
            "THES": "phdthesis",
            "RPRT": "techreport",
            "UNPB": "unpublished",
        }
        return mapping.get(ris_type.upper(), "misc")

    def _format_ris_authors(self, authors: Any) -> str:
        if isinstance(authors, list):
            return " and ".join(authors)
        return str(authors) if authors else ""

    def _extract_year(self, year_field: str) -> str:
        if not year_field:
            return ""
        return year_field[:4] if len(year_field) >= 4 else year_field

    def _detect_file_format(self, file_path: Path) -> str:
        suffix = file_path.suffix.lower()

        format_map = {
            ".bib": "bibtex",
            ".ris": "ris",
            ".nbib": "nbib",
            ".enl": "endnote",
            ".csv": "csv",
            ".xlsx": "excel",
            ".txt": "text",
        }

        if suffix in format_map:
            return format_map[suffix]

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                first_lines = f.read(1000)

            if first_lines.startswith("@"):
                return "bibtex"
            if "TY  -" in first_lines:
                return "ris"
            if "PMID-" in first_lines:
                return "nbib"
        except Exception:  # noqa: BLE001
            pass

        return "unknown"
