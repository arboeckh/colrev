# WP-01: Restore Engine Preconditions & Route State Writes Through Operations

## Context

The app currently runs the entire colrev engine with its safety checks turned off, and its reconciliation path writes record states by hand. Both were workarounds for narrow frictions (see analysis in `00-overview.md`); this package replaces them with narrow, principled fixes so the engine's own validation guards every operation again.

## Problems being fixed

1. **Blanket precondition bypass.** `colrev/process/operation.py:122-123` makes `check_precondition()` a no-op whenever `interactive_mode` is set, and `colrev/ui_jsonrpc/framework/dispatcher.py:145` constructs **every** project-scoped `ReviewManager` with `interactive_mode=True`. Result: clean-repo checks and record-state model checks are disabled app-wide — prep/dedupe/search/load run unguarded over possibly-dirty trees.
   - Root cause: the dispatcher builds a fresh `ReviewManager` + operation per RPC. Per-record decision RPCs (`prescreen_record`, `screen_record`) therefore look like a fresh "operation start" against a tree left dirty by the previous decision, which would fail the engine's clean-repo precondition — even though the engine itself works exactly this way *within* a CLI session (per-record `save_records_dict(partial=True)` on a dirty tree, one commit per session).
2. **Reconciliation bypasses the engine's write path.** `colrev/managed_review.py:844-887` applies final decisions via raw `record.set_status(FINAL_STATES_BY_KIND[...])` + hand-editing of `Fields.SCREENING_CRITERIA`, then `save_records_dict` at `:931` — never calling `prescreen_op.prescreen()` / `screen_op.screen()`. It maintains a private copy of the state maps (`ELIGIBLE_STATE_BY_KIND` / `FINAL_STATES_BY_KIND`, `managed_review.py:26-42`).
3. **App code inside the vendored core tree.** `colrev/managed_review.py` (1031 lines) is app code but lives next to core modules; any upstream re-vendor conflicts with it. Same for the smaller mirrors: `_record_enrichment.py` restores status by hand after `prep_link_md` (`colrev/ui_jsonrpc/_record_enrichment.py:137-140`).

## Scope of work

### 1. Replace `interactive_mode` with a per-operation precondition policy

- Remove the early-return at `operation.py:122-123` (restore core toward stock).
- Add a **narrow, upstream-defensible** precondition class for manual decisions, mirroring the existing `prep_man` precedent (`operation.py:134-138` — "clean except `data/records.bib`"): prescreen/screen manual decision paths may run with only `records.bib` dirty.
  - Preferred shape: a `ManualDecision` flavor on the operation type or an explicit `ignored_files=[RECORDS_FILE]` route for `prescreen`/`screen` when invoked in per-record mode. Keep the diff to core minimal and documented in the file header.
- Make precondition policy part of the RPC method's interface: add a field to `MethodSpec` (`colrev/ui_jsonrpc/framework/registry.py`) — e.g. `precondition: "enforce" | "manual_decision" | "skip"` — defaulting to **enforce**. The dispatcher (`dispatcher.py:143-148`) constructs the `ReviewManager` accordingly instead of hardcoding `interactive_mode=True`.
- Audit every registered method and assign the correct policy. Expected outcome: `search`, `load`, `prep`, `dedupe`, `pdf_get`, `pdf_prep`, `data` all get `enforce`; only `prescreen_record`, `screen_record` (and any explicitly-audited others) get `manual_decision`; `skip` requires a written justification comment.
- Surface precondition failures as **structured RPC errors** (distinct error code, e.g. `PRECONDITION_FAILED` with the exception class in `data`) so the renderer can show "commit or discard your changes first" instead of a generic failure. (Renderer handling of that code lands with WP-02's structured errors; here just emit it.)

### 2. Route reconciliation writes through engine operations

- In `apply_reconciliation`, replace the raw `set_status`/criteria writes (`managed_review.py:832-887`) with calls to the same operations the live decision path uses (`prescreen_handler.py:222`, `screen_handler.py:283`):
  - auto / manual-pick → `prescreen_op.prescreen(record, prescreen_inclusion=...)` or `screen_op.screen(record, screen_inclusion=..., screening_criteria=...)`.
  - screen `manual_custom` → `screen_op.screen(...)` with the resolved criteria string.
- Delete `FINAL_STATES_BY_KIND`; derive eligibility (`ELIGIBLE_STATE_BY_KIND`) from core's `ProcessModel` transitions instead of a hand map if feasible.
- Keep what is legitimately wrapper-owned: classification (auto/conflict/pending/blocked), block-override, the manifest audit trail, and the final `create_commit`.

### 3. Relocate managed-review code out of the vendored tree

- Move `colrev/managed_review.py` → `colrev/ui_jsonrpc/managed_review.py` (or a `colrev_app/` package if one is introduced). Update the two import sites (`framework_handlers/managed_review_handler.py:23`, `_managed_review_utils.py:16`).
- Inventory the remaining core diffs vs upstream (per review: `operation.py`, `review_manager.py`, `paths.py`, `ops/pdf_get.py`, `ops/pdf_prep.py`, `ops/load.py`, `ops/prep.py`, `ops/dedupe.py`, `ops/search.py`) and record them in a `colrev/PATCHES.md` so re-vendoring is a checklist, not archaeology.

### 4. Fix the load.py path-concept mix

- `colrev/ops/load.py` mixes `get_search_history_path()` and `search_results_path` in the same rename block (introduced by a local edit). Reconcile to one concept.

## Acceptance criteria

- `interactive_mode` no longer exists as a blanket bypass; grep shows no `interactive_mode` early-return in `check_precondition`.
- Running `prep`/`dedupe`/`search` via RPC on a dirty repo returns a structured precondition error; the same ops on a clean repo succeed.
- `prescreen_record`/`screen_record` still work mid-session with a dirty `records.bib` (existing e2e specs `03-prescreen-2-reviewer`, `06-screen` pass).
- `apply_reconciliation` produces records byte-identical (statuses + criteria) to the current implementation on a fixture task — add a handler-level test comparing before/after snapshots.
- No references to `colrev.managed_review` outside `ui_jsonrpc`.
- `colrev/PATCHES.md` lists every remaining core modification with purpose.

## Out of scope

- Renderer-side display of the new error codes (WP-02/05).
- Reviewer-branch cleanup and stash stranding (WP-07).

## Dependencies

None — this is the first package deliberately. It changes error behavior that WP-02 will surface properly, but is independently shippable.
