"""Handler for prescreen operations.

JSON-RPC Endpoints:
    - prescreen: Execute prescreen operation (batch mode)
    - get_prescreen_queue: Get records awaiting prescreening
    - prescreen_record: Submit prescreening decision for a single record
    - enrich_record_metadata: Enrich a single record with API data (abstract, etc.)
    - batch_enrich_records: Enrich multiple records in one call

See docs/source/api/jsonrpc/prescreen.rst for full endpoint documentation.
"""
import logging
from pathlib import Path
from typing import Any
from typing import Dict
from typing import Optional

import colrev.record.record
import colrev.review_manager
import colrev.search_file
from colrev.constants import Fields
from colrev.constants import RecordState
from colrev.constants import SearchType
from colrev.ui_jsonrpc import response_formatter
from colrev.ui_jsonrpc import validation

logger = logging.getLogger(__name__)


class PrescreenHandler:
    """Handle prescreen-related JSON-RPC methods.

    This handler provides endpoints for prescreening records based on
    title and abstract review.

    Attributes:
        review_manager: ReviewManager instance for the current project
    """

    def __init__(self, review_manager: colrev.review_manager.ReviewManager):
        """Initialize prescreen handler.

        Args:
            review_manager: ReviewManager instance for the project
        """
        self.review_manager = review_manager

    def prescreen(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute prescreen operation (batch mode).

        Runs the prescreen operation using configured prescreen packages.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - split_str (str, optional): Split string for parallel prescreening (default: "NA")

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - operation (str): "prescreen"
                - project_id (str): Project identifier
                - details (dict): Operation results
        """
        project_id = params["project_id"]
        split_str = validation.get_optional_param(params, "split_str", "NA")

        logger.info(f"Running prescreen operation for project {project_id}")

        # Get prescreen operation
        prescreen_operation = self.review_manager.get_prescreen_operation(
            notify_state_transition_operation=True
        )

        # Execute prescreen
        prescreen_operation.main(split_str=split_str)

        # Return success response
        return response_formatter.format_operation_response(
            operation_name="prescreen",
            project_id=project_id,
            details={"message": "Prescreen completed", "split_str": split_str},
        )

    def get_prescreen_queue(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get records awaiting prescreening.

        Returns records that are ready for prescreening (status: md_processed).

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - limit (int, optional): Max records to return (default: 50)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - total_count (int): Total records awaiting prescreen
                - records (list): List of records with:
                    - id (str): Record ID
                    - title (str): Record title
                    - author (str): Authors
                    - year (str): Publication year
                    - abstract (str, optional): Abstract text
                    - journal (str, optional): Journal name
                    - booktitle (str, optional): Conference/book title
        """
        project_id = params["project_id"]
        limit = validation.get_optional_param(params, "limit", 50)

        logger.info(f"Getting prescreen queue for project {project_id}")

        # Need to get an operation to enable record loading
        self.review_manager.get_prescreen_operation(
            notify_state_transition_operation=True
        )

        # Load all records (may return empty dict for new projects)
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        # Filter to records awaiting prescreen (md_processed status)
        prescreen_records = [
            record
            for record in records_dict.values()
            if record.get(Fields.STATUS) == RecordState.md_processed
        ]

        total_count = len(prescreen_records)

        # Apply limit
        limited_records = prescreen_records[:limit]

        # Format records for response
        formatted_records = []
        for record in limited_records:
            formatted = {
                "id": record.get(Fields.ID),
                "title": record.get(Fields.TITLE, ""),
                "author": record.get(Fields.AUTHOR, ""),
                "year": record.get(Fields.YEAR, ""),
            }

            # Include optional fields if present
            if Fields.ABSTRACT in record:
                formatted["abstract"] = record[Fields.ABSTRACT]
            if Fields.JOURNAL in record:
                formatted["journal"] = record[Fields.JOURNAL]
            if Fields.BOOKTITLE in record:
                formatted["booktitle"] = record[Fields.BOOKTITLE]

            # Include enrichment capability fields
            if Fields.DOI in record:
                formatted["doi"] = record[Fields.DOI]
            if Fields.PUBMED_ID in record:
                formatted["pubmedid"] = record[Fields.PUBMED_ID]

            # Determine if record can be enriched (has identifier but no abstract)
            has_abstract = Fields.ABSTRACT in record and record[Fields.ABSTRACT]
            has_enrichable_id = Fields.DOI in record or Fields.PUBMED_ID in record
            formatted["can_enrich"] = not has_abstract and has_enrichable_id

            formatted_records.append(formatted)

        return {
            "success": True,
            "total_count": total_count,
            "records": formatted_records,
        }

    def prescreen_record(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Submit prescreening decision for a single record.

        Updates the record status based on the prescreen decision.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID (required)
                - decision (str): Decision - "include" or "exclude" (required)
                - skip_commit (bool, optional): Skip git commit (default: False)

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - record (dict): Updated record data
                - remaining_count (int): Records still awaiting prescreen
                - message (str): Success message

        Raises:
            ValueError: If record_id or decision is missing/invalid
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        decision = params.get("decision")
        skip_commit = validation.get_optional_param(params, "skip_commit", False)

        if not record_id:
            raise ValueError("record_id parameter is required")

        if not decision:
            raise ValueError("decision parameter is required")

        if decision not in ("include", "exclude"):
            raise ValueError("decision must be 'include' or 'exclude'")

        logger.info(
            f"Prescreening record {record_id} as {decision} in project {project_id}"
        )

        # Need to get an operation to enable record loading
        self.review_manager.get_prescreen_operation(
            notify_state_transition_operation=True
        )

        # Load records
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        if record_id not in records_dict:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records_dict[record_id]

        # Verify record is in correct state
        current_status = record_dict.get(Fields.STATUS)
        if current_status != RecordState.md_processed:
            raise ValueError(
                f"Record '{record_id}' is not ready for prescreen "
                f"(current status: {current_status})"
            )

        # Create Record object and update status
        record = colrev.record.record.Record(record_dict)

        if decision == "include":
            record.set_status(RecordState.rev_prescreen_included)
        else:
            record.set_status(RecordState.rev_prescreen_excluded)

        # Save the updated record
        self.review_manager.dataset.save_records_dict(
            {record_id: record.get_data()},
            partial=True,
        )

        # Create commit if not skipped
        if not skip_commit:
            self.review_manager.create_commit(
                msg=f"Prescreen {decision}: {record_id}",
            )

        # Count remaining records
        remaining_count = sum(
            1
            for r in records_dict.values()
            if r.get(Fields.STATUS) == RecordState.md_processed
            and r.get(Fields.ID) != record_id
        )

        return response_formatter.format_operation_response(
            operation_name="prescreen_record",
            project_id=project_id,
            details={
                "record": {
                    "id": record_id,
                    "decision": decision,
                    "new_status": record.get_data().get(Fields.STATUS).name,
                },
                "remaining_count": remaining_count,
                "message": f"Record {record_id} prescreened as {decision}",
            },
        )

    def update_prescreen_decisions(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update prescreen decisions for records already in prescreen states.

        Allows flipping records between rev_prescreen_included and
        rev_prescreen_excluded after the initial prescreen is complete.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - changes (list): List of dicts with:
                    - record_id (str): Record ID
                    - decision (str): "include" or "exclude"

        Returns:
            Dict containing:
                - success (bool): Always True on success
                - changes_count (int): Number of records actually updated
                - skipped (list): Records that were skipped with reasons
                - updated_records (list): IDs of records that were updated
                - message (str): Summary message

        Raises:
            ValueError: If changes is missing or empty
        """
        project_id = params["project_id"]
        changes = params.get("changes")

        if not changes or not isinstance(changes, list):
            raise ValueError("changes parameter is required and must be a non-empty list")

        # Validate each change entry
        for change in changes:
            if not isinstance(change, dict):
                raise ValueError("Each change must be a dict with record_id and decision")
            if not change.get("record_id"):
                raise ValueError("Each change must have a record_id")
            if change.get("decision") not in ("include", "exclude"):
                raise ValueError("Each change decision must be 'include' or 'exclude'")

        logger.info(
            f"Updating {len(changes)} prescreen decisions in project {project_id}"
        )

        self.review_manager.get_prescreen_operation(
            notify_state_transition_operation=True
        )

        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        valid_states = {RecordState.rev_prescreen_included, RecordState.rev_prescreen_excluded}
        records_to_save = {}
        skipped = []
        updated_ids = []

        for change in changes:
            record_id = change["record_id"]
            decision = change["decision"]

            if record_id not in records_dict:
                skipped.append({"record_id": record_id, "reason": "Record not found"})
                continue

            record_dict = records_dict[record_id]
            current_status = record_dict.get(Fields.STATUS)

            if current_status not in valid_states:
                skipped.append({
                    "record_id": record_id,
                    "reason": f"Invalid state: {current_status}",
                })
                continue

            target_state = (
                RecordState.rev_prescreen_included
                if decision == "include"
                else RecordState.rev_prescreen_excluded
            )

            if current_status == target_state:
                continue  # No change needed

            record = colrev.record.record.Record(record_dict)
            record.set_status(target_state)
            records_to_save[record_id] = record.get_data()
            updated_ids.append(record_id)

        if records_to_save:
            self.review_manager.dataset.save_records_dict(
                records_to_save,
                partial=True,
            )
            self.review_manager.create_commit(
                msg=f"Prescreen (edit): updated {len(records_to_save)} record(s)",
            )

        return {
            "success": True,
            "changes_count": len(updated_ids),
            "skipped": skipped,
            "updated_records": updated_ids,
            "message": f"Updated {len(updated_ids)} record(s)"
            + (f", skipped {len(skipped)}" if skipped else ""),
        }

    def _get_crossref_source(self) -> Optional[Any]:
        """Get or create a Crossref source for metadata enrichment."""
        try:
            import colrev.packages.crossref.src.crossref_search_source as crossref_connector

            crossref_md_filename = Path("data/search/md_crossref.bib")
            crossref_md_source_l = [
                s
                for s in self.review_manager.settings.sources
                if s.search_results_path == crossref_md_filename
            ]
            if crossref_md_source_l:
                search_file = crossref_md_source_l[0]
            else:
                search_file = colrev.search_file.ExtendedSearchFile(
                    platform="colrev.crossref",
                    search_results_path=crossref_md_filename,
                    search_type=SearchType.MD,
                    search_string="",
                    comment="",
                    version=crossref_connector.CrossrefSearchSource.CURRENT_SYNTAX_VERSION,
                )

            return crossref_connector.CrossrefSearchSource(search_file=search_file)
        except Exception as e:
            logger.warning(f"Failed to initialize Crossref source: {e}")
            return None

    def _get_pubmed_source(self) -> Optional[Any]:
        """Get or create a PubMed source for metadata enrichment."""
        try:
            import colrev.packages.pubmed.src.pubmed as pubmed_connector

            pubmed_md_filename = Path("data/search/md_pubmed.bib")
            pubmed_md_source_l = [
                s
                for s in self.review_manager.settings.sources
                if s.search_results_path == pubmed_md_filename
            ]
            if pubmed_md_source_l:
                search_file = pubmed_md_source_l[0]
            else:
                search_file = colrev.search_file.ExtendedSearchFile(
                    platform="colrev.pubmed",
                    search_results_path=pubmed_md_filename,
                    search_type=SearchType.MD,
                    search_string="",
                    comment="",
                    version=pubmed_connector.PubMedSearchSource.CURRENT_SYNTAX_VERSION,
                )

            return pubmed_connector.PubMedSearchSource(search_file=search_file)
        except Exception as e:
            logger.warning(f"Failed to initialize PubMed source: {e}")
            return None

    def _enrich_single_record(
        self,
        record_dict: Dict[str, Any],
        prep_operation: Any,
    ) -> Dict[str, Any]:
        """
        Enrich a single record using available APIs.

        Args:
            record_dict: The record data dictionary
            prep_operation: The prep operation for API access

        Returns:
            Dict containing enrichment result with:
                - success (bool): Whether enrichment succeeded
                - enriched_fields (list): Fields that were enriched
                - source (str, optional): API source used
                - record (dict): Updated record data
        """
        record_id = record_dict.get(Fields.ID)
        original_abstract = record_dict.get(Fields.ABSTRACT, "")

        # Create a Record object for enrichment
        record = colrev.record.record.Record(record_dict.copy())

        enriched_fields = []
        source_used = None

        # Try Crossref if DOI is present
        if Fields.DOI in record_dict and record_dict[Fields.DOI]:
            crossref_source = self._get_crossref_source()
            if crossref_source:
                try:
                    record = crossref_source.prep_link_md(
                        prep_operation=prep_operation,
                        record=record,
                        save_feed=False,  # Don't save feed for UI enrichment
                        timeout=15,
                    )
                    source_used = "crossref"
                except Exception as e:
                    logger.warning(f"Crossref enrichment failed for {record_id}: {e}")

        # Try PubMed if PubMed ID is present and Crossref didn't get abstract
        new_abstract = record.data.get(Fields.ABSTRACT, "")
        if (
            not new_abstract
            and Fields.PUBMED_ID in record_dict
            and record_dict[Fields.PUBMED_ID]
        ):
            pubmed_source = self._get_pubmed_source()
            if pubmed_source:
                try:
                    record = pubmed_source.prep_link_md(
                        prep_operation=prep_operation,
                        record=record,
                        save_feed=False,
                        timeout=15,
                    )
                    source_used = "pubmed"
                except Exception as e:
                    logger.warning(f"PubMed enrichment failed for {record_id}: {e}")

        # Restore original status — prep_link_md resets it to md_prepared
        # as part of its normal prep workflow, but we only want the metadata fields
        record.data[Fields.STATUS] = record_dict.get(Fields.STATUS)

        # Check what fields were enriched
        new_abstract = record.data.get(Fields.ABSTRACT, "")
        if new_abstract and new_abstract != original_abstract:
            enriched_fields.append("abstract")

        # Format the enriched record for response
        enriched_record = {
            "id": record.data.get(Fields.ID),
            "title": record.data.get(Fields.TITLE, ""),
            "author": record.data.get(Fields.AUTHOR, ""),
            "year": record.data.get(Fields.YEAR, ""),
        }

        if Fields.ABSTRACT in record.data:
            enriched_record["abstract"] = record.data[Fields.ABSTRACT]
        if Fields.JOURNAL in record.data:
            enriched_record["journal"] = record.data[Fields.JOURNAL]
        if Fields.BOOKTITLE in record.data:
            enriched_record["booktitle"] = record.data[Fields.BOOKTITLE]
        if Fields.DOI in record.data:
            enriched_record["doi"] = record.data[Fields.DOI]
        if Fields.PUBMED_ID in record.data:
            enriched_record["pubmedid"] = record.data[Fields.PUBMED_ID]

        enriched_record["can_enrich"] = False  # Already enriched

        return {
            "success": len(enriched_fields) > 0,
            "enriched_fields": enriched_fields,
            "source": source_used,
            "record": enriched_record,
            "record_data": record.data,  # Full record data for saving
        }

    def enrich_record_metadata(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enrich a single record by fetching metadata from APIs.

        Fetches additional metadata (primarily abstract) from Crossref or PubMed
        based on available identifiers (DOI, PubMed ID).

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_id (str): Record ID to enrich (required)
                - fields (list, optional): Fields to enrich (default: ["abstract"])
                - skip_commit (bool, optional): Skip git commit (default: True)

        Returns:
            Dict containing:
                - success (bool): Whether enrichment succeeded
                - record (dict): Enriched record data
                - enriched_fields (list): Fields that were enriched
                - source (str, optional): API source used (crossref, pubmed)

        Raises:
            ValueError: If record_id is missing or record not found
        """
        project_id = params["project_id"]
        record_id = params.get("record_id")
        skip_commit = validation.get_optional_param(params, "skip_commit", True)

        if not record_id:
            raise ValueError("record_id parameter is required")

        logger.info(f"Enriching record {record_id} in project {project_id}")

        # Get prep operation for API access
        prep_operation = self.review_manager.get_prep_operation()

        # Load records
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        if record_id not in records_dict:
            raise ValueError(f"Record '{record_id}' not found")

        record_dict = records_dict[record_id]

        # Skip if abstract already present
        if Fields.ABSTRACT in record_dict and record_dict[Fields.ABSTRACT]:
            return {
                "success": True,
                "record": {
                    "id": record_id,
                    "title": record_dict.get(Fields.TITLE, ""),
                    "author": record_dict.get(Fields.AUTHOR, ""),
                    "year": record_dict.get(Fields.YEAR, ""),
                    "abstract": record_dict[Fields.ABSTRACT],
                    "can_enrich": False,
                },
                "enriched_fields": [],
                "source": None,
                "message": "Abstract already present",
            }

        # Enrich the record
        result = self._enrich_single_record(record_dict, prep_operation)

        # Save if enrichment was successful
        if result["success"]:
            self.review_manager.dataset.save_records_dict(
                {record_id: result["record_data"]},
                partial=True,
            )

            if not skip_commit:
                self.review_manager.create_commit(
                    msg=f"Enrich metadata: {record_id}",
                )

        return {
            "success": result["success"],
            "record": result["record"],
            "enriched_fields": result["enriched_fields"],
            "source": result["source"],
        }

    def batch_enrich_records(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enrich multiple records in one call.

        Processes records sequentially with API rate limiting.
        Useful for background prefetching of abstracts.

        Args:
            params: Method parameters containing:
                - project_id (str): Project identifier (required)
                - record_ids (list): List of record IDs to enrich (required)
                - fields (list, optional): Fields to enrich (default: ["abstract"])
                - skip_commit (bool, optional): Skip git commit (default: True)

        Returns:
            Dict containing:
                - success (bool): Always True on completion
                - enriched_count (int): Number of records successfully enriched
                - failed_count (int): Number of records that failed enrichment
                - records (list): List of enriched records with their status

        Raises:
            ValueError: If record_ids is missing or empty
        """
        project_id = params["project_id"]
        record_ids = params.get("record_ids", [])
        skip_commit = validation.get_optional_param(params, "skip_commit", True)

        if not record_ids:
            raise ValueError("record_ids parameter is required and must not be empty")

        logger.info(
            f"Batch enriching {len(record_ids)} records in project {project_id}"
        )

        # Get prep operation for API access
        prep_operation = self.review_manager.get_prep_operation()

        # Load records
        records_dict = self.review_manager.dataset.load_records_dict()
        if records_dict is None:
            records_dict = {}

        enriched_count = 0
        failed_count = 0
        results = []
        records_to_save = {}

        for record_id in record_ids:
            if record_id not in records_dict:
                logger.warning(f"Record '{record_id}' not found, skipping")
                failed_count += 1
                results.append(
                    {
                        "id": record_id,
                        "success": False,
                        "error": "Record not found",
                    }
                )
                continue

            record_dict = records_dict[record_id]

            # Skip if abstract already present
            if Fields.ABSTRACT in record_dict and record_dict[Fields.ABSTRACT]:
                results.append(
                    {
                        "id": record_id,
                        "success": True,
                        "enriched_fields": [],
                        "message": "Abstract already present",
                    }
                )
                continue

            try:
                result = self._enrich_single_record(record_dict, prep_operation)

                if result["success"]:
                    enriched_count += 1
                    records_to_save[record_id] = result["record_data"]

                results.append(
                    {
                        "id": record_id,
                        "success": result["success"],
                        "enriched_fields": result["enriched_fields"],
                        "source": result["source"],
                        "record": result["record"],
                    }
                )

            except Exception as e:
                logger.warning(f"Failed to enrich record {record_id}: {e}")
                failed_count += 1
                results.append(
                    {
                        "id": record_id,
                        "success": False,
                        "error": str(e),
                    }
                )

        # Save all enriched records at once
        if records_to_save:
            self.review_manager.dataset.save_records_dict(
                records_to_save,
                partial=True,
            )

            if not skip_commit:
                self.review_manager.create_commit(
                    msg=f"Batch enrich metadata: {len(records_to_save)} records",
                )

        return {
            "success": True,
            "enriched_count": enriched_count,
            "failed_count": failed_count,
            "records": results,
        }
