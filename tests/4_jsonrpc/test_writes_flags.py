"""Golden test pinning the audited ``writes`` flags.

The ``writes`` flag is load-bearing in the renderer: ``stores/backend.ts``
triggers its post-write git/pending-changes refresh off the flags exported
into ``rpc-schemas.json``. A mutating handler registered without
``writes=True`` leaves the UI showing stale git state after the write.

This test walks the registry and compares against the audited set
(see ``plans/03-rpc-contract-writes-audit.md``). Adding a method or flipping
a flag must update this list consciously — audit what the handler actually
does to disk before editing it.
"""

import colrev.ui_jsonrpc.framework_handlers  # noqa: F401  (registers methods)
from colrev.ui_jsonrpc.framework import registry

AUDITED_WRITERS = {
    "add_screening_criterion",
    "add_source",
    "apply_reconciliation",
    "batch_enrich_records",
    "cancel_managed_review_task",
    "commit_changes",
    "configure_structured_endpoint",
    "create_managed_review_task",
    "data",
    "dedupe",
    "delete_project",
    "discard_changes",
    "enrich_record_metadata",
    # Despite the get_ prefix, it creates/backfills data/data/data.csv.
    "get_data_extraction_queue",
    "import_pdfs",
    "include_all_screen",
    "init_project",
    "load",
    "mark_pdf_not_available",
    "pdf_get",
    "pdf_prep",
    "prep",
    "prep_man_update_record",
    "prescreen",
    "prescreen_record",
    "remove_screening_criterion",
    "remove_source",
    "reset_to_remote",
    "restore_pdf_file",
    "save_data_extraction",
    "screen",
    "screen_record",
    "search",
    "undo_pdf_not_available",
    "update_prescreen_decisions",
    "update_record",
    "update_review_definition",
    "update_screen_decisions",
    "update_screening_criterion",
    "update_settings",
    "update_source",
    "upload_pdf",
    "upload_search_file",
    # Conservative: caller-controlled filter_setting can write
    # data/dedupe/merge_candidates_file.txt.
    "validate",
}


def test_writes_flags_match_audit() -> None:
    actual_writers = {spec.name for spec in registry.all() if spec.writes}
    assert actual_writers == AUDITED_WRITERS, (
        "writes flags drifted from the audited set. If a handler's disk "
        "behavior changed (or a new method was added), re-audit it and "
        "update AUDITED_WRITERS plus plans/03-rpc-contract-writes-audit.md. "
        f"Unexpected writers: {sorted(actual_writers - AUDITED_WRITERS)}; "
        f"missing writers: {sorted(AUDITED_WRITERS - actual_writers)}"
    )
