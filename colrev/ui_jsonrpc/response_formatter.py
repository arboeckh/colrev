"""Format operation results for JSON-RPC responses."""

from pathlib import Path
from typing import Any, Dict, List, Optional


def format_path(path: Path) -> str:
    """Convert Path object to string (resolved absolute path)."""
    return str(path.resolve())


def format_comprehensive_status_response(
    project_id: str,
    project_path: Path,
    status_stats: Any,
    next_operation: Optional[str],
    has_changes: bool,
    steps: Optional[List[Dict[str, Any]]] = None,
    stale_sources: Optional[List[Dict[str, Optional[str]]]] = None,
) -> Dict[str, Any]:
    """
    Format comprehensive response for get_status operation.

    Provides detailed breakdown of records by state for frontend display.
    All counts come straight from the engine's StatusStats — this function
    only reshapes, it never recomputes.

    Args:
        project_id: Project identifier
        project_path: Path to the project directory
        status_stats: StatusStats object from ReviewManager
        next_operation: Recommended next operation (or None)
        has_changes: Whether there are uncommitted Git changes
        steps: Per-step status payloads (operation_graph.build_step_payloads)
        stale_sources: Stale search sources (search_staleness.stale_source_entries)

    Returns:
        Formatted response dictionary with comprehensive status
    """
    # Extract overall counts (records that have ever been in each state)
    overall = status_stats.overall
    overall_dict = {
        "md_retrieved": overall.md_retrieved,
        "md_imported": overall.md_imported,
        "md_prepared": overall.md_prepared,
        "md_processed": overall.md_processed,
        "rev_prescreen_excluded": overall.rev_prescreen_excluded,
        "rev_prescreen_included": overall.rev_prescreen_included,
        "pdf_not_available": overall.pdf_not_available,
        "pdf_imported": overall.pdf_imported,
        "pdf_prepared": overall.pdf_prepared,
        "rev_excluded": overall.rev_excluded,
        "rev_included": overall.rev_included,
        "rev_synthesized": overall.rev_synthesized,
    }

    # Extract current counts (records currently in each state)
    currently = status_stats.currently
    currently_dict = {
        "md_retrieved": currently.md_retrieved,
        "md_imported": currently.md_imported,
        "md_needs_manual_preparation": currently.md_needs_manual_preparation,
        "md_prepared": currently.md_prepared,
        "md_processed": currently.md_processed,
        "rev_prescreen_excluded": currently.rev_prescreen_excluded,
        "rev_prescreen_included": currently.rev_prescreen_included,
        "pdf_needs_manual_retrieval": currently.pdf_needs_manual_retrieval,
        "pdf_not_available": currently.pdf_not_available,
        "pdf_imported": currently.pdf_imported,
        "pdf_needs_manual_preparation": currently.pdf_needs_manual_preparation,
        "pdf_prepared": currently.pdf_prepared,
        "rev_excluded": currently.rev_excluded,
        "rev_included": currently.rev_included,
        "rev_synthesized": currently.rev_synthesized,
    }

    # Total records = every record ever imported plus retrieved-but-not-yet-
    # imported search results. Both terms are the engine's own numbers
    # (overall.md_imported is len(records)).
    total_records = overall.md_imported + currently.md_retrieved

    stale_sources = stale_sources or []
    return {
        "success": True,
        "project_id": project_id,
        "path": format_path(project_path),
        "status": {
            "overall": overall_dict,
            "currently": currently_dict,
            "total_records": total_records,
            "next_operation": next_operation,
            "steps": steps or [],
            "search_stale": len(stale_sources) > 0,
            "stale_sources": stale_sources,
            "completeness_condition": status_stats.completeness_condition,
            "atomic_steps": status_stats.atomic_steps,
            "completed_atomic_steps": status_stats.completed_atomic_steps,
            "has_changes": has_changes,
            "duplicates_removed": status_stats.md_duplicates_removed,
            "nr_origins": status_stats.nr_origins,
            "screening_statistics": status_stats.screening_statistics,
        },
    }


