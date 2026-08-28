# WP-03 — `writes` flag audit (2026-08-28)

Context: the `writes` flag was removed from `MethodSpec`/`@rpc_method` in
commit b3272d68f ("removed dead code refactor") although it is load-bearing —
`stores/backend.ts` derives `WRITER_METHODS` from the exported schema and
triggers the post-write git/pending-changes refresh off it. Since that commit,
`scripts/export_rpc_schemas.py` crashed on `spec.writes` and the committed
schema was stale. The flag is restored (registry, decorator,
`BaseHandler.__init_subclass__`) and every one of the 73 registered methods was
audited against what its handler actually does to disk.

Convention (also documented on `MethodSpec.writes`): any handler that commits,
saves, or stages files inside the project MUST set `writes=True` on its
`@rpc_method` registration. Not counted as writes: pure reads, exports that
only return content in the response, writes to temp files outside the project,
and the `.report.log` truncation that any CoLRev operation constructor performs
(gitignored log artifact).

## Corrections vs the previously committed schema

| method | was | now | why |
|---|---|---|---|
| `get_data_extraction_queue` | `false` | `true` | despite the `get_` name it creates/backfills `data/data/data.csv` on read |
| `restore_pdf_file` | `false` | `true` | writes PDF bytes to the record's `file` path under `data/pdfs` |
| `validate` | `false` | `true` | conservative: `filter_setting="dedupe"`/`"all"` (caller-controlled) writes `data/dedupe/merge_candidates_file.txt`; the UI's settings are pure reads, but a spurious refresh is cheaper than a stale UI |
| `get_connector_api_key_status`, `set_connector_api_key` | absent | `false` | new methods; env-var only, nothing persisted |

Post-merge addition (WP-04): `apply_merge` is a writer (merges, reconciles,
and commits); `analyze_merge` stays read-only (analysis restores repo state).

## Flags confirmed (writes=True, 45 methods)

init_project, delete_project, commit_changes, discard_changes,
reset_to_remote, load, prep, dedupe, pdf_prep, prep_man_update_record, data,
get_data_extraction_queue, save_data_extraction,
configure_structured_endpoint, search, add_source, upload_search_file,
remove_source, update_source, update_record, prescreen_record, prescreen,
update_prescreen_decisions, enrich_record_metadata, batch_enrich_records,
screen, screen_record, update_screen_decisions, include_all_screen, pdf_get,
upload_pdf, mark_pdf_not_available, undo_pdf_not_available, import_pdfs,
restore_pdf_file, update_review_definition, add_screening_criterion,
update_screening_criterion, remove_screening_criterion, update_settings,
create_managed_review_task, cancel_managed_review_task, apply_reconciliation,
validate, apply_merge

All remaining 30 methods are read-only (`writes=False`).

The audited set is pinned by `tests/4_jsonrpc/test_writes_flags.py` — a
registry-walking golden test, so adding a method (or flipping a flag) forces a
conscious update of the audited list.

## Documented edge cases

- **export_pdfs** stays `false`: it zips to a caller-supplied `output_path`
  (user save dialog). Nothing enforces that the path is outside the project
  tree; if it ever lands inside, the file is untracked either way.
- **pdf_get** additionally quarantines corrupt PDFs into
  `data/pdfs/_quarantine/` even when the operation ultimately fails —
  covered by its `writes=True`.
