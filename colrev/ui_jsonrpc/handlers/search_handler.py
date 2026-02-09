"""Handler for search operations.

JSON-RPC Endpoints:
    - search: Execute search operation
    - get_sources: List all configured search sources
    - add_source: Add a new search source
    - update_source: Update an existing search source configuration
    - remove_source: Remove a search source
    - upload_search_file: Upload a search results file
    - get_source_records: Get records from a specific search source file

See docs/source/api/jsonrpc/search.rst for full endpoint documentation.
"""

import base64
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import colrev.review_manager
from colrev.ui_jsonrpc import response_formatter, validation

logger = logging.getLogger(__name__)


class SearchHandler:
    """Handle search-related JSON-RPC methods.

    This handler provides endpoints for managing search sources and
    executing search operations.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize search handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def search(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute search operation to retrieve records from sources.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - source (str, optional): Source selection string (default: "all")
                - rerun (bool, optional): Rerun API-based searches (default: False)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "search"
                - project_id (str): Project identifier
                - details (dict): Search results
        """
        project_id = params["project_id"]
        source = validation.get_optional_param(params, "source", "all")
        rerun = validation.get_optional_param(params, "rerun", False)
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        logger.info(f"Running search operation for project {project_id}")

        # Get search operation
        search_operation = self.review_manager.get_search_operation()

        # Execute search
        # Note: When source is "all", don't pass selection_str to let main() use its default.
        # The decorator _check_source_selection_exists validates the kwarg if passed,
        # so "all" (not being a valid path) would fail validation.
        if source == "all":
            search_operation.main(
                rerun=rerun,
                skip_commit=skip_commit,
            )
        else:
            search_operation.main(
                selection_str=source,
                rerun=rerun,
                skip_commit=skip_commit,
            )

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="search",
            project_id=project_id,
            details={
                "source": source,
                "rerun": rerun,
                "message": "Search completed",
            },
        )

    def get_sources(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        List all configured search sources with metadata.

        Returns the list of search sources configured in the project settings,
        including per-source staleness status, record counts, and timestamps.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - sources (list): List of SearchSource objects with:
                    - platform (str): Platform/source identifier
                    - search_results_path (str): Path to search results file
                    - search_type (str): Type of search (DB, API, etc.)
                    - search_parameters (dict): Source-specific parameters
                    - record_count (int): Number of records in search results file
                    - last_run_timestamp (str|null): ISO timestamp of last search run
                    - is_stale (bool): Whether source settings changed since last run
                    - stale_reason (str|null): Reason for staleness if applicable
        """
        project_id = params["project_id"]
        logger.info(f"Getting sources for project {project_id}")

        sources = self.review_manager.settings.sources
        sources_list = []

        for source in sources:
            # Use model_dump() for proper serialization
            source_dict = source.model_dump()

            # Get record count from search results file
            results_path = self.review_manager.path / source.search_results_path
            record_count = 0
            if results_path.exists():
                try:
                    from colrev.loader import load_utils

                    record_count = load_utils.get_nr_records(results_path)
                except Exception:
                    pass

            # Check staleness by comparing current settings with saved history
            history_path = (
                self.review_manager.path / source.get_search_history_path()
            )
            is_stale, stale_reason = self._check_source_staleness(
                source, history_path
            )

            # Get last run timestamp from the history file
            # Prefer the 'last_run' field if present, otherwise fall back to file mtime
            last_run_timestamp = None
            if record_count > 0 and history_path.is_file():
                try:
                    with open(history_path, "r", encoding="utf-8") as f:
                        history_data = json.load(f)
                    last_run_timestamp = history_data.get("last_run")
                except (json.JSONDecodeError, OSError):
                    pass
                # Fall back to file mtime if last_run not in history
                if not last_run_timestamp:
                    mtime = history_path.stat().st_mtime
                    last_run_timestamp = datetime.fromtimestamp(
                        mtime, tz=timezone.utc
                    ).isoformat()

            source_dict.update(
                {
                    "record_count": record_count,
                    "last_run_timestamp": last_run_timestamp,
                    "is_stale": is_stale,
                    "stale_reason": stale_reason,
                }
            )
            sources_list.append(source_dict)

        return {
            "success": True,
            "project_id": project_id,
            "sources": sources_list,
        }

    def _check_source_staleness(
        self, source, history_path: Path
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if a single source is stale by comparing current settings with saved history.

        Args:
            source: ExtendedSearchFile object with current settings
            history_path: Path to the search history JSON file

        Returns:
            Tuple of (is_stale, stale_reason)
        """
        # If no history file exists, search hasn't been run yet
        if not history_path.is_file():
            return True, "Search has not been run"

        try:
            with open(history_path, "r", encoding="utf-8") as f:
                history = json.load(f)

            # Compare search_string (query)
            current_query = getattr(source, "search_string", "") or ""
            history_query = history.get("search_string", "") or ""
            if current_query != history_query:
                return True, "Search query changed"

            # Compare search_parameters
            current_params = getattr(source, "search_parameters", {}) or {}
            history_params = history.get("search_parameters", {}) or {}
            if current_params != history_params:
                return True, "Search parameters changed"

            return False, None

        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Error reading search history {history_path}: {e}")
            return True, "Unable to read search history"

    def _save_source_history(
        self, source, run_date: Optional[str] = None
    ) -> None:
        """
        Save the search history file for a source.

        This marks the source as "run" by creating/updating the history JSON file.
        For file-based sources (DB type), this should be called immediately after
        adding the source since the file already contains the search results.

        Args:
            source: ExtendedSearchFile object
            run_date: ISO timestamp for when the search was run.
                     Defaults to current time if not provided.
        """
        history_path = self.review_manager.path / source.get_search_history_path()

        # Use provided run_date or default to now
        if run_date:
            last_run = run_date
        else:
            last_run = datetime.now(tz=timezone.utc).isoformat()

        # Build history data from source
        history_data = source.to_dict()
        history_data.pop("search_history_path", None)
        history_data["last_run"] = last_run

        # Save the history file
        history_path.parent.mkdir(parents=True, exist_ok=True)
        with open(history_path, "w", encoding="utf-8") as f:
            json.dump(history_data, f, indent=4, ensure_ascii=False)

        # Stage the history file for git
        self.review_manager.dataset.git_repo.add_changes(history_path)

    def add_source(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Add a new search source.

        Adds a search source to the project configuration. The source can be
        an API-based source (like Crossref) or a file-based source.

        For file-based sources (DB type), the search history is automatically
        saved, marking the source as "run" immediately. This is because the
        file already contains the search results.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - endpoint (str): Package endpoint/platform (required)
                    e.g., "colrev.crossref", "colrev.files_dir"
                - search_type (str): Type of search (required)
                    One of: "DB", "API", "BACKWARD", "FORWARD", "TOC", "OTHER", "FILES", "MD"
                - search_string (str, optional): Search query string (default: "")
                - filename (str, optional): Target filename (auto-generated if not provided)
                - run_date (str, optional): ISO timestamp for when the search was run.
                    For file-based sources, this is when the database export was performed.
                    Defaults to current time if not provided.
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - source (dict): Added source details
                - message (str): Success message

        Raises:
            ValueError: If endpoint or search_type is missing/invalid
        """
        project_id = params["project_id"]
        endpoint = params.get("endpoint")
        search_type = params.get("search_type")
        search_string = validation.get_optional_param(params, "search_string", "")
        filename = validation.get_optional_param(params, "filename", None)
        run_date = validation.get_optional_param(params, "run_date", None)
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not endpoint:
            raise ValueError("endpoint parameter is required")

        if not search_type:
            raise ValueError("search_type parameter is required")

        logger.info(f"Adding source {endpoint} to project {project_id}")

        # Import SearchType enum
        from colrev.constants import SearchType
        from colrev.search_file import ExtendedSearchFile

        # Convert search_type string to enum
        try:
            search_type_enum = SearchType[search_type]
        except KeyError:
            valid_types = ", ".join([t.name for t in SearchType])
            raise ValueError(
                f"Invalid search_type '{search_type}'. Valid types: {valid_types}"
            )

        # Generate filename if not provided
        if not filename:
            # Create a filename based on endpoint
            endpoint_name = endpoint.split(".")[-1]
            filename = f"data/search/{endpoint_name}.bib"

        # Get the package's CURRENT_SYNTAX_VERSION if available
        from colrev.constants import EndpointType
        from colrev.package_manager.package_manager import PackageManager

        package_manager = PackageManager()
        version = "1.0"  # Default fallback
        try:
            search_source_class = package_manager.get_package_endpoint_class(
                package_type=EndpointType.search_source,
                package_identifier=endpoint,
            )
            if hasattr(search_source_class, 'CURRENT_SYNTAX_VERSION'):
                version = search_source_class.CURRENT_SYNTAX_VERSION
        except Exception:
            pass  # Use default version if package lookup fails

        # Create the ExtendedSearchFile
        new_source = ExtendedSearchFile(
            search_string=search_string,
            platform=endpoint,
            search_results_path=Path(filename),
            search_type=search_type_enum,
            version=version,
        )

        # For API-based sources like PubMed, set up search_parameters with the proper URL
        if search_type_enum == SearchType.API and endpoint == "colrev.pubmed":
            # Construct the PubMed eSearch URL from the search string
            import urllib.parse
            encoded_query = urllib.parse.quote(search_string)
            pubmed_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={encoded_query}"
            new_source.search_parameters = {"url": pubmed_url}

        # Add to settings
        self.review_manager.settings.sources.append(new_source)
        self.review_manager.save_settings()

        # For file-based sources (DB type), automatically save the search history
        # This marks the source as "run" since the file already contains results
        if search_type_enum == SearchType.DB:
            self._save_source_history(new_source, run_date)

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Add search source: {endpoint}",
            )

        return response_formatter.format_operation_response(
            operation_name="add_source",
            project_id=project_id,
            details={
                "source": new_source.model_dump(),
                "message": f"Added search source: {endpoint}",
            },
        )

    def upload_search_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Upload a search results file to the project.

        Uploads a search results file (RIS, BibTeX, etc.) to the data/search/
        directory of the project.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - filename (str): Target filename in data/search/ (required)
                - content (str): File content (required)
                - encoding (str, optional): Content encoding - "utf-8" (default) or "base64"

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - path (str): Path where file was saved
                - detected_format (str): Detected file format
                - message (str): Success message

        Raises:
            ValueError: If filename or content is missing
        """
        project_id = params["project_id"]
        filename = params.get("filename")
        content = params.get("content")
        encoding = validation.get_optional_param(params, "encoding", "utf-8")

        if not filename:
            raise ValueError("filename parameter is required")

        if not content:
            raise ValueError("content parameter is required")

        logger.info(f"Uploading search file {filename} to project {project_id}")

        # Sanitize filename to prevent path traversal
        safe_filename = Path(filename).name
        if not safe_filename:
            raise ValueError("Invalid filename")

        # Create the target path
        search_dir = self.review_manager.path / "data" / "search"
        search_dir.mkdir(parents=True, exist_ok=True)
        target_path = search_dir / safe_filename

        # Decode content if base64 encoded
        if encoding == "base64":
            try:
                file_content = base64.b64decode(content)
            except Exception as e:
                raise ValueError(f"Invalid base64 content: {e}")
            write_mode = "wb"
        else:
            file_content = content
            write_mode = "w"

        # Write the file
        with open(target_path, write_mode) as f:
            f.write(file_content)

        # Detect file format
        detected_format = self._detect_file_format(target_path)

        # Return flat response to match frontend UploadSearchFileResponse interface
        return {
            "success": True,
            "path": str(target_path.relative_to(self.review_manager.path)),
            "detected_format": detected_format,
            "message": f"Uploaded search file: {safe_filename}",
        }

    def remove_source(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Remove a search source from the project.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - filename (str): Source filename to remove (required)
                - delete_file (bool, optional): Also delete the search file (default: False)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - message (str): Success message

        Raises:
            ValueError: If filename is missing or source not found
        """
        project_id = params["project_id"]
        filename = params.get("filename")
        delete_file = validation.get_optional_param(params, "delete_file", False)
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not filename:
            raise ValueError("filename parameter is required")

        logger.info(f"Removing source {filename} from project {project_id}")

        # Find the source with matching filename
        sources = self.review_manager.settings.sources
        source_to_remove = None
        source_index = None

        for i, source in enumerate(sources):
            # Match by filename (could be full path or just filename)
            source_filename = str(source.search_results_path)
            if source_filename == filename or source_filename.endswith(filename):
                source_to_remove = source
                source_index = i
                break

        if source_to_remove is None:
            raise ValueError(f"Source with filename '{filename}' not found")

        # Remove from settings list
        self.review_manager.settings.sources.pop(source_index)

        # Delete the search_history.json file (required to remove source permanently)
        # Sources are loaded by scanning *_search_history.json files in data/search/
        search_history_path = self.review_manager.path / source_to_remove.get_search_history_path()
        if search_history_path.exists():
            search_history_path.unlink()
            logger.info(f"Deleted search history file: {search_history_path}")

        # Save settings (this saves other sources but the removed one won't be re-saved)
        self.review_manager.save_settings()

        # Optionally delete the search results file (e.g., pubmed.bib)
        if delete_file:
            file_path = self.review_manager.path / source_to_remove.search_results_path
            if file_path.exists():
                file_path.unlink()
                logger.info(f"Deleted search file: {file_path}")

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Remove search source: {filename}",
            )

        return response_formatter.format_operation_response(
            operation_name="remove_source",
            project_id=project_id,
            details={
                "message": f"Removed search source: {filename}",
            },
        )

    def update_source(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update an existing search source configuration.

        For file-based sources (DB type), you can provide a run_date to update
        the search history, which marks the source as freshly "run".

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - filename (str): Source filename to update (required)
                - search_string (str, optional): New search query string
                - search_parameters (dict, optional): New search parameters
                - run_date (str, optional): ISO timestamp for when the search was run.
                    For file-based sources, providing this will update the search history.
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - source (dict): Updated source details
                - message (str): Success message

        Raises:
            ValueError: If filename is missing or source not found
        """
        project_id = params["project_id"]
        filename = params.get("filename")
        search_string = params.get("search_string")
        search_parameters = params.get("search_parameters")
        run_date = params.get("run_date")
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not filename:
            raise ValueError("filename parameter is required")

        logger.info(f"Updating source {filename} in project {project_id}")

        # Find the source with matching filename
        sources = self.review_manager.settings.sources
        source_to_update = None

        for source in sources:
            source_filename = str(source.search_results_path)
            if source_filename == filename or source_filename.endswith(filename):
                source_to_update = source
                break

        if source_to_update is None:
            raise ValueError(f"Source with filename '{filename}' not found")

        # Track if query changed (to clear results)
        query_changed = False

        # Update fields if provided
        if search_string is not None:
            if source_to_update.search_string != search_string:
                query_changed = True
            source_to_update.search_string = search_string

            # For PubMed API sources, rebuild the URL from the new search string
            from colrev.constants import SearchType

            if (
                source_to_update.search_type == SearchType.API
                and source_to_update.platform == "colrev.pubmed"
            ):
                import urllib.parse

                encoded_query = urllib.parse.quote(search_string)
                pubmed_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={encoded_query}"
                source_to_update.search_parameters["url"] = pubmed_url
                logger.info(f"Rebuilt PubMed URL: {pubmed_url}")

        if search_parameters is not None:
            # Check if URL parameter changed (main query for API sources)
            if "url" in search_parameters:
                old_url = source_to_update.search_parameters.get("url", "")
                if old_url != search_parameters["url"]:
                    query_changed = True
            # Merge new parameters with existing ones
            for key, value in search_parameters.items():
                source_to_update.search_parameters[key] = value

        # If query changed, clear the existing results file so next search starts fresh
        if query_changed:
            results_path = self.review_manager.path / source_to_update.search_results_path
            if results_path.exists():
                logger.info(f"Query changed, clearing results file: {results_path}")
                results_path.unlink()
                # Create empty file to maintain the source
                results_path.touch()

        # Save settings
        self.review_manager.save_settings()

        # For file-based sources, if run_date is provided, update the search history
        # This marks the source as freshly "run" with the specified date
        from colrev.constants import SearchType

        if run_date and source_to_update.search_type == SearchType.DB:
            self._save_source_history(source_to_update, run_date)

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Update search source: {filename}",
            )

        return response_formatter.format_operation_response(
            operation_name="update_source",
            project_id=project_id,
            details={
                "source": source_to_update.model_dump(),
                "message": f"Updated search source: {filename}",
            },
        )

    def get_source_records(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get records originating from a specific search source.

        Reads records from the main records.bib dataset and filters by colrev_origin
        to show records that came from a specific search source.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - filename (str): Source filename to filter by (required)
                - pagination (dict, optional): Pagination options:
                    - offset (int): Skip first N records (default: 0)
                    - limit (int): Max records to return (default: 50, max: 500)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - project_id (str): Project identifier
                - filename (str): Source filename
                - records (list): List of record dictionaries with:
                    - ID (str): Record identifier
                    - ENTRYTYPE (str): Entry type (article, book, etc.)
                    - title (str): Record title
                    - author (str): Authors
                    - year (str): Publication year
                    - journal (str, optional): Journal name
                    - doi (str, optional): DOI
                    - colrev_status (str): Current record status
                - total_count (int): Total number of records from this source
                - pagination (dict): Pagination info (offset, limit, has_more)

        Raises:
            ValueError: If filename is missing or source not found
        """
        from colrev.constants import Fields

        project_id = params["project_id"]
        filename = params.get("filename")
        pagination = validation.get_optional_param(params, "pagination", {})

        if not filename:
            raise ValueError("filename parameter is required")

        logger.info(f"Getting records from source {filename} in project {project_id}")

        # Find the source to get origin prefix
        source = None
        for s in self.review_manager.settings.sources:
            source_filename = str(s.search_results_path)
            if source_filename == filename or source_filename.endswith(filename):
                source = s
                break

        if source is None:
            raise ValueError(f"Source with filename '{filename}' not found")

        # Get origin prefix from the source path (e.g., "data/search/pubmed.bib" -> "pubmed.bib")
        origin_prefix = Path(source.search_results_path).name

        # Try to load records from the main dataset first (after load operation)
        self.review_manager.get_status_operation()
        records_dict = self.review_manager.dataset.load_records_dict()

        if records_dict is None:
            records_dict = {}

        # Filter records by origin
        filtered_records = []
        for record in records_dict.values():
            origins = record.get(Fields.ORIGIN, [])
            # Check if any origin starts with the source filename
            for origin in origins:
                if origin.startswith(origin_prefix + "/") or origin.startswith(origin_prefix):
                    filtered_records.append(record)
                    break

        # If no records found in main dataset, try reading from search file directly
        # This happens after search but before load
        if not filtered_records:
            results_path = self.review_manager.path / source.search_results_path
            if results_path.exists():
                filtered_records = self._read_search_file_records(results_path)

        # Get total count
        total_count = len(filtered_records)

        # Apply pagination
        offset = pagination.get("offset", 0)
        limit = min(pagination.get("limit", 50), 500)
        paginated_records = filtered_records[offset:offset + limit]
        has_more = (offset + limit) < total_count

        # Format records for response
        formatted_records = []
        for record in paginated_records:
            # Get status as string
            status = record.get(Fields.STATUS)
            status_str = status.name if hasattr(status, 'name') else str(status) if status else ""

            formatted = {
                "ID": record.get(Fields.ID, ""),
                "ENTRYTYPE": record.get(Fields.ENTRYTYPE, ""),
                "title": record.get(Fields.TITLE, ""),
                "author": record.get(Fields.AUTHOR, ""),
                "year": record.get(Fields.YEAR, ""),
                "colrev_status": status_str,
            }
            # Add optional fields if present
            if record.get(Fields.JOURNAL):
                formatted["journal"] = record[Fields.JOURNAL]
            if record.get(Fields.BOOKTITLE):
                formatted["booktitle"] = record[Fields.BOOKTITLE]
            if record.get(Fields.DOI):
                formatted["doi"] = record[Fields.DOI]
            if record.get(Fields.ABSTRACT):
                abstract = record[Fields.ABSTRACT]
                formatted["abstract"] = abstract[:500] + "..." if len(abstract) > 500 else abstract
            formatted_records.append(formatted)

        return {
            "success": True,
            "project_id": project_id,
            "filename": filename,
            "records": formatted_records,
            "total_count": total_count,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "has_more": has_more,
            },
        }

    def _read_search_file_records(self, file_path: Path) -> List[Dict[str, Any]]:
        """Read records from a search file.

        Supports multiple formats: BibTeX, RIS, NBIB, EndNote, etc.
        Used as fallback when records haven't been loaded into records.bib yet.

        Does simple field mapping to extract title, author, year from
        format-specific field names.
        """
        records = []

        try:
            # Select appropriate loader based on file extension
            suffix = file_path.suffix.lower()

            if suffix == ".ris":
                from colrev.loader.ris import RISLoader

                loader = RISLoader(filename=file_path, unique_id_field="INCREMENTAL")
                raw_records = loader.load_records_list()
                # Map RIS fields to standard fields
                for i, raw in enumerate(raw_records):
                    record = {
                        "ID": raw.get("ID", str(i + 1)),
                        "ENTRYTYPE": self._ris_type_to_entrytype(raw.get("TY", "")),
                        "title": raw.get("T1", raw.get("TI", "")),
                        "author": self._format_ris_authors(raw.get("A1", raw.get("AU", []))),
                        "year": self._extract_year(raw.get("Y1", raw.get("PY", ""))),
                        "journal": raw.get("JF", raw.get("T2", "")),
                        "doi": raw.get("DO", ""),
                        "abstract": raw.get("N2", raw.get("AB", "")),
                    }
                    records.append(record)

            elif suffix == ".nbib":
                from colrev.loader.nbib import NBIBLoader

                loader = NBIBLoader(filename=file_path, unique_id_field="INCREMENTAL")
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

                loader = ENLLoader(filename=file_path, unique_id_field="INCREMENTAL")
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

                loader = TableLoader(filename=file_path, unique_id_field="INCREMENTAL")
                raw_records = loader.load_records_list()
                # Table files usually have standard field names
                records = raw_records

            else:
                # Default to BibTeX for .bib and unknown formats
                from colrev.loader.bib import BIBLoader

                loader = BIBLoader(filename=file_path, unique_id_field="INCREMENTAL")
                # BibTeX files have standard field names
                records = loader.load_records_list()

        except Exception as e:
            logger.warning(f"Failed to parse {file_path}: {e}")

        return records

    def _ris_type_to_entrytype(self, ris_type: str) -> str:
        """Convert RIS type (TY field) to standard entry type."""
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
        """Format RIS author field (list or string) to standard author string."""
        if isinstance(authors, list):
            return " and ".join(authors)
        return str(authors) if authors else ""

    def _extract_year(self, year_field: str) -> str:
        """Extract year from RIS date field (e.g., '2025//' -> '2025')."""
        if not year_field:
            return ""
        # Take first 4 characters (the year part)
        return year_field[:4] if len(year_field) >= 4 else year_field

    def _detect_file_format(self, file_path: Path) -> str:
        """Detect the format of a search file."""
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

        # Try to detect from content
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                first_lines = f.read(1000)

            if first_lines.startswith("@"):
                return "bibtex"
            elif "TY  -" in first_lines:
                return "ris"
            elif "PMID-" in first_lines:
                return "nbib"
        except Exception:
            pass

        return "unknown"
