# Local modifications to the vendored colrev core

The `colrev/` package (excluding `colrev/ui_jsonrpc/`, which is app code) is
treated as a vendored copy of upstream
[CoLRev-Environment/colrev](https://github.com/CoLRev-Environment/colrev).

**Upstream baseline:** commit `229568e176a9efd3276960073603ca50ccc4d8c7`
("crossref: fix connector for filter") — the merge-base with upstream `main`.

To re-vendor: diff each file below against the new upstream version and
re-apply the described change (or drop it if upstream has absorbed it).
Verify with:

```bash
git diff <upstream-ref> -- colrev/ ':!colrev/ui_jsonrpc'
```

The result should list exactly the files in this document.

## Engine behavior

| File | Change | Purpose |
|------|--------|---------|
| `colrev/process/operation.py` | `check_precondition` gains a narrow branch: when the JSON-RPC dispatcher sets `review_manager.manual_decision_mode = True`, prescreen/screen operations require a clean repo **except** `data/records.bib` (mirrors the stock `prep_man` precedent). | Per-record decision RPCs (`prescreen_record`, `screen_record`, `update_*_decisions`) stage one decision per call and commit once per session, so `records.bib` is legitimately dirty mid-session. Stock behavior is unchanged when the attribute is absent. |
| `colrev/ops/pdf_prep.py` | Catch `pymupdf.FileDataError` in `_prepare_pdf`; mark the record `pdf_needs_manual_preparation` with a `pdf-unreadable` provenance note instead of crashing the whole run. | A single corrupt PDF must not abort a batch pdf-prep from the app. |
| `colrev/ops/pdf_get.py` | `main()` accepts an optional `progress_callback`; on a worker exception, completed results are persisted (`save_records_dict(partial=True)`) before re-raising. | UI progress reporting; keeps state consistent for retries when one PDF retrieval fails. |
| `colrev/ops/load.py` | `main()` accepts an optional `progress_callback`. The `.ris` branch of `_rename_erroneous_extensions` operates on `search_results_path` (upstream mixed in `get_search_history_path()` and had the re-assignment commented out). | UI progress reporting; the rename block now uses one path concept consistently — the physical results file is what gets renamed. |
| `colrev/ops/search.py` | `main()` accepts an optional `progress_callback` (per source). | UI progress reporting. |
| `colrev/ops/prep.py` | `main()` accepts an optional `progress_callback` (per prep round). | UI progress reporting. |
| `colrev/ops/dedupe.py` | `main()` accepts an optional `progress_callback` (per dedupe endpoint). | UI progress reporting. |
| `colrev/__version__.py` | Fall back to `"0.0.dev"` when `importlib.metadata.version("colrev")` raises `PackageNotFoundError`. | The bundled/embedded Python distribution runs colrev without an installed dist-info. |
| `colrev/ops/merge.py` | (WP-04) The interactive conflict loop is factored into `_reconcile_status_conflicts(resolver=...)`; the CLI `main()` passes a thin `input()` resolver, behavior unchanged. New non-interactive API for the JSON-RPC layer: `analyze(theirs=...)` attempts `git merge --no-commit --no-ff`, reports per-record status disagreements, non-status blockers, and unmerged `settings.json` stage contents, then aborts (repo restored); `apply(theirs=..., decisions=...)` resolves status conflicts from a prepared decisions dict, saves records via the real BibTeX writer, regenerates `status.yaml`, computes agreement via `validate_merge_prescreen_screen`, and leaves the merge in progress so the caller commits with both parents. Helpers: `abort_merge()`, `get_unmerged_file_stages(path)`. The merge ref is fully parameterized (any ref, e.g. `origin/dev`). Reconciled files are staged via the git CLI instead of `dataset.save_records_dict` / GitPython `index.add`, which corrupts the index during a merge (stage-0 entry alongside surviving conflict stages — gitpython#1185) and left the repo uncommittable; this also fixes the same latent bug in the interactive CLI path. | The app drives record-level merge reconciliation through `colrev/ui_jsonrpc/framework_handlers/merge_handler.py` instead of reimplementing BibTeX merging in TypeScript. |

## Search-source packages

| File | Change | Purpose |
|------|--------|---------|
| `colrev/packages/open_alex/src/open_alex.py`, `open_alex_api.py`, `open_alex_query_builder.py` (new file) | Extended OpenAlex source: API-search support with a query builder, pagination, and richer field mapping. | The app offers OpenAlex as a first-class API search source. |
| `colrev/packages/pubmed/src/pubmed_api.py` | Extended PubMed API handling (retries, field mapping, robustness). | Reliability of PubMed API searches from the app. |
| `colrev/packages/unknown_source/src/unknown_source.py` | Additional RIS key mappings (`T1`, `A1`, `Y1`, `JF`, `JA`) across entry types. | Loads RIS exports that use primary-field tags. |
| `colrev/packages/unpaywall/src/unpaywall.py` | `_is_pdf` returns `False` on unreadable files (`pymupdf.FileDataError`, `RuntimeError`, `ValueError`) instead of raising. | A corrupt download must not abort pdf-get. |

## Removed local modifications (history)

- `colrev/review_manager.py` — the `interactive_mode` constructor flag (a
  blanket precondition bypass) was removed in WP-01; the file is back at
  stock. The narrow `manual_decision_mode` attribute in
  `process/operation.py` replaced it.
- `colrev/paths.py` — the `app_manifest` entry was removed; the app manifest
  path is owned by `colrev/ui_jsonrpc/managed_review.py`.
- `colrev/managed_review.py` — app code; moved to
  `colrev/ui_jsonrpc/managed_review.py` in WP-01.
