"""Shared record-enrichment helpers.

Used by:
- ``framework_handlers/prescreen_handler.py`` for the on-demand
  ``batch_enrich_records`` / ``enrich_record_metadata`` RPCs.
- ``managed_review.py`` to pre-fetch abstracts on dev before bifurcating a
  managed-review task into reviewer branches.

Centralizing here keeps both call sites in lockstep — when a managed-review
task launches, the same enrichment that would otherwise run lazily on each
reviewer branch runs once on dev and is captured in the launch commit. That
avoids the long "fetching abstract" delay during review and the resulting
non-task metadata drift that blocks reconciliation.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from typing import Callable
from typing import Dict
from typing import List
from typing import Optional

import colrev.record.record
import colrev.search_file
from colrev.constants import Fields
from colrev.constants import SearchType

logger = logging.getLogger(__name__)


def _get_crossref_source(review_manager: Any) -> Optional[Any]:
    try:
        import colrev.packages.crossref.src.crossref_search_source as crossref_connector

        crossref_md_filename = Path("data/search/md_crossref.bib")
        existing = [
            s for s in review_manager.settings.sources
            if s.search_results_path == crossref_md_filename
        ]
        if existing:
            search_file = existing[0]
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
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to initialize Crossref source: %s", exc)
        return None


def _get_pubmed_source(review_manager: Any) -> Optional[Any]:
    try:
        import colrev.packages.pubmed.src.pubmed as pubmed_connector

        pubmed_md_filename = Path("data/search/md_pubmed.bib")
        existing = [
            s for s in review_manager.settings.sources
            if s.search_results_path == pubmed_md_filename
        ]
        if existing:
            search_file = existing[0]
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
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to initialize PubMed source: %s", exc)
        return None


def enrich_record(
    review_manager: Any, record_dict: Dict[str, Any], prep_operation: Any
) -> Dict[str, Any]:
    """Fetch abstract for a single record from Crossref then PubMed.

    Returns a dict with: ``success`` (bool — true iff a new abstract was
    obtained), ``enriched_fields`` (list of field names that changed),
    ``source`` (the connector that supplied the new abstract), ``record_data``
    (the enriched record dict, suitable for ``save_records_dict``), and
    ``record`` (a JSON-friendly snapshot for clients).
    """
    record_id = record_dict.get(Fields.ID)
    original_abstract = record_dict.get(Fields.ABSTRACT, "")
    record = colrev.record.record.Record(record_dict.copy())

    enriched_fields: List[str] = []
    source_used: Optional[str] = None

    if Fields.DOI in record_dict and record_dict[Fields.DOI]:
        crossref_source = _get_crossref_source(review_manager)
        if crossref_source is not None:
            try:
                record = crossref_source.prep_link_md(
                    prep_operation=prep_operation,
                    record=record,
                    save_feed=False,
                    timeout=15,
                )
                source_used = "crossref"
            except Exception as exc:  # noqa: BLE001
                logger.warning("Crossref enrichment failed for %s: %s", record_id, exc)

    new_abstract = record.data.get(Fields.ABSTRACT, "")
    if (
        not new_abstract
        and Fields.PUBMED_ID in record_dict
        and record_dict[Fields.PUBMED_ID]
    ):
        pubmed_source = _get_pubmed_source(review_manager)
        if pubmed_source is not None:
            try:
                record = pubmed_source.prep_link_md(
                    prep_operation=prep_operation,
                    record=record,
                    save_feed=False,
                    timeout=15,
                )
                source_used = "pubmed"
            except Exception as exc:  # noqa: BLE001
                logger.warning("PubMed enrichment failed for %s: %s", record_id, exc)

    # prep_link_md resets status to md_prepared — restore the caller's status
    # so the record stays at the original lifecycle stage on dev.
    if Fields.STATUS in record_dict:
        record.data[Fields.STATUS] = record_dict[Fields.STATUS]

    final_abstract = record.data.get(Fields.ABSTRACT, "")
    if final_abstract and final_abstract != original_abstract:
        enriched_fields.append(Fields.ABSTRACT)

    return {
        "success": bool(enriched_fields),
        "enriched_fields": enriched_fields,
        "source": source_used,
        "record_data": record.data,
        "record": record.data,
    }


def enrich_records(
    review_manager: Any,
    record_ids: List[str],
    *,
    on_progress: Optional[Callable[[int, int, str], None]] = None,
) -> Dict[str, Any]:
    """Enrich a batch of records and persist the new abstracts to dev.

    Idempotent: records that already have a non-empty abstract are skipped.
    Saves successfully enriched records via
    ``review_manager.dataset.save_records_dict(partial=True)`` so the caller
    is responsible for committing.

    Returns ``{"enriched_count", "failed_count", "skipped_count", "results"}``
    where ``results`` mirrors ``batch_enrich_records``' per-record output.
    """
    if not record_ids:
        return {
            "enriched_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "results": [],
        }

    prep_operation = review_manager.get_prep_operation()
    records_dict = review_manager.dataset.load_records_dict() or {}

    enriched_count = 0
    failed_count = 0
    skipped_count = 0
    results: List[Dict[str, Any]] = []
    records_to_save: Dict[str, Dict[str, Any]] = {}

    total = len(record_ids)
    for idx, record_id in enumerate(record_ids, start=1):
        if on_progress is not None:
            on_progress(idx, total, f"Enriching {record_id}")

        if record_id not in records_dict:
            logger.warning("Record '%s' not found, skipping", record_id)
            failed_count += 1
            results.append(
                {"id": record_id, "success": False, "error": "Record not found"}
            )
            continue

        record_dict = records_dict[record_id]
        if Fields.ABSTRACT in record_dict and record_dict[Fields.ABSTRACT]:
            skipped_count += 1
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
            result = enrich_record(review_manager, record_dict, prep_operation)
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
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to enrich record %s: %s", record_id, exc)
            failed_count += 1
            results.append({"id": record_id, "success": False, "error": str(exc)})

    if records_to_save:
        review_manager.dataset.save_records_dict(records_to_save, partial=True)

    return {
        "enriched_count": enriched_count,
        "failed_count": failed_count,
        "skipped_count": skipped_count,
        "results": results,
    }
