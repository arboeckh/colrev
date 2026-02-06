"""Handler for search operations.

JSON-RPC Endpoints:
    - search: Execute search operation
    - get_sources: List all configured search sources
    - add_source: Add a new search source
    - update_source: Update an existing search source configuration
    - remove_source: Remove a search source
    - upload_search_file: Upload a search results file

See docs/source/api/jsonrpc/search.rst for full endpoint documentation.
"""

import base64
import logging
from pathlib import Path
from typing import Any, Dict, List

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
        List all configured search sources.

        Returns the list of search sources configured in the project settings.

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
        """
        project_id = params["project_id"]
        logger.info(f"Getting sources for project {project_id}")

        sources = self.review_manager.settings.sources
        sources_list = []

        for source in sources:
            # Use model_dump() for proper serialization
            source_dict = source.model_dump()
            sources_list.append(source_dict)

        return {
            "success": True,
            "project_id": project_id,
            "sources": sources_list,
        }

    def add_source(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Add a new search source.

        Adds a search source to the project configuration. The source can be
        an API-based source (like Crossref) or a file-based source.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - endpoint (str): Package endpoint/platform (required)
                    e.g., "colrev.crossref", "colrev.files_dir"
                - search_type (str): Type of search (required)
                    One of: "DB", "API", "BACKWARD", "FORWARD", "TOC", "OTHER", "FILES", "MD"
                - search_string (str, optional): Search query string (default: "")
                - filename (str, optional): Target filename (auto-generated if not provided)
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

        return response_formatter.format_operation_response(
            operation_name="upload_search_file",
            project_id=project_id,
            details={
                "path": str(target_path.relative_to(self.review_manager.path)),
                "detected_format": detected_format,
                "message": f"Uploaded search file: {safe_filename}",
            },
        )

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

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - filename (str): Source filename to update (required)
                - search_string (str, optional): New search query string
                - search_parameters (dict, optional): New search parameters
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
