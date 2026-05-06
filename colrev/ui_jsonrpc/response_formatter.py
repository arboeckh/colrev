"""Format operation results for JSON-RPC responses."""

from pathlib import Path
from typing import Any, Dict, Optional


def format_path(path: Path) -> str:
    """Convert Path object to string (resolved absolute path)."""
    return str(path.resolve())


def format_comprehensive_status_response(
    project_id: str,
    project_path: Path,
    status_stats: Any,
    next_operation: Optional[str],
    has_changes: bool,
) -> Dict[str, Any]:
    """
    Format comprehensive response for get_status operation.

    Provides detailed breakdown of records by state for frontend display.

    Args:
        project_id: Project identifier
        project_path: Path to the project directory
        status_stats: StatusStats object from ReviewManager
        next_operation: Recommended next operation (or None)
        has_changes: Whether there are uncommitted Git changes

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
    # Note: md_retrieved can be negative due to a bug in CoLRev's _get_currently_md_retrieved
    # when records have multiple origins (it counts origins, not unique records)
    # We clamp to 0 to prevent UI issues
    currently = status_stats.currently
    currently_dict = {
        "md_retrieved": max(0, currently.md_retrieved),
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

    # Calculate total records (all records in any state)
    total_records = (
        currently_dict["md_retrieved"]
        + currently_dict["md_imported"]
        + currently_dict["md_needs_manual_preparation"]
        + currently_dict["md_prepared"]
        + currently_dict["md_processed"]
        + currently_dict["rev_prescreen_excluded"]
        + currently_dict["rev_prescreen_included"]
        + currently_dict["pdf_needs_manual_retrieval"]
        + currently_dict["pdf_not_available"]
        + currently_dict["pdf_imported"]
        + currently_dict["pdf_needs_manual_preparation"]
        + currently_dict["pdf_prepared"]
        + currently_dict["rev_excluded"]
        + currently_dict["rev_included"]
        + currently_dict["rev_synthesized"]
    )

    return {
        "success": True,
        "project_id": project_id,
        "path": format_path(project_path),
        "status": {
            "overall": overall_dict,
            "currently": currently_dict,
            "total_records": total_records,
            "next_operation": next_operation,
            "completeness_condition": status_stats.completeness_condition,
            "atomic_steps": status_stats.atomic_steps,
            "completed_atomic_steps": status_stats.completed_atomic_steps,
            "has_changes": has_changes,
            "duplicates_removed": status_stats.md_duplicates_removed,
            "nr_origins": status_stats.nr_origins,
            "screening_statistics": status_stats.screening_statistics,
        },
    }


