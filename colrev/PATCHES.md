# Core patches vs upstream CoLRev

The vendored `colrev/` package is treated as an upstream dependency. Any
deliberate modification to core (everything outside `colrev/ui_jsonrpc/`)
must be recorded here so re-vendoring is a checklist, not archaeology.

WP-01 will complete the full inventory of pre-existing diffs (per the
architecture review: `operation.py`, `review_manager.py`, `paths.py`,
`ops/pdf_get.py`, `ops/pdf_prep.py`, `ops/load.py`, `ops/prep.py`,
`ops/dedupe.py`, `ops/search.py`). Entries below document patches made
after that review.

## `colrev/ops/merge.py` — non-interactive merge API (WP-04)

Purpose: let the Electron app drive record-level merge reconciliation
through the JSON-RPC layer instead of reimplementing BibTeX merging in
TypeScript.

Changes relative to upstream:

- The interactive conflict-resolution loop is factored into
  `_reconcile_status_conflicts(..., resolver=...)`; the CLI `main()` passes
  a thin `input()`-based resolver, so CLI behavior is unchanged.
- New non-interactive methods used by
  `colrev/ui_jsonrpc/framework_handlers/merge_handler.py`:
  - `analyze(theirs=...)` — attempts `git merge --no-commit --no-ff`,
    reports per-record status disagreements, non-status blockers, and
    unmerged `settings.json` stage contents, then aborts the merge
    (repository state restored).
  - `apply(theirs=..., decisions=...)` — re-runs the merge, resolves
    status conflicts from a prepared decisions dict, saves records via the
    real BibTeX writer, regenerates `status.yaml`, computes inter-rater
    agreement via `validate_merge_prescreen_screen`, and leaves the merge
    in progress (MERGE_HEAD present) so the caller can resolve
    `settings.json` and create a true two-parent merge commit.
  - Helpers: `abort_merge()`, `get_unmerged_file_stages(path)`.
- The merge ref is parameterized everywhere (`theirs` may be any ref,
  e.g. `origin/dev`); no branch-name assumptions.
- Reconciled files are written directly and staged via the git CLI instead
  of `dataset.save_records_dict` / GitPython `index.add`: during a merge,
  GitPython's `index.add` writes a corrupt index (a stage-0 entry alongside
  the surviving conflict stages — gitpython#1185) that even a real
  `git add` cannot repair, leaving the repository uncommittable. This also
  fixes the same latent bug in the interactive CLI path (which previously
  told users to `git add . && git commit` after `save_records_dict` had
  already poisoned the index).
