# WP-06: Single-Source Status Derivation — The Engine Owns Status

## Context

"Is this step done / runnable / next" is computed in at least seven places over different inputs, on both sides of the RPC seam. The sidebar, page completion screens, Overview CTA, and workflow stepper can each reach a different verdict for the same step — the classic "the app contradicts itself" bug family. The engine already owns the state machine (`colrev/process/model.py` — the linear `ProcessModel` transition chain); status should be derived once, next to it, and rendered thinly.

## Problems being fixed

1. **Python-side duplicate state machine.** `status_handler._determine_next_operation` (`status_handler.py:434-456`) hardcodes the load→prep→dedupe→prescreen→pdf_get→pdf_prep→screen→data ordering, and `PRECONDITION`/`OPERATION_INPUT_STATES` maps (`status_handler.py:64-74`) mirror core's operation→state mapping by hand. Upstream state-machine changes drift silently while the UI keeps pointing at the wrong "next step".
2. **Renderer-side duplicates.** Independent derivations in: `lib/stepStatus.ts` (the tested one), `stores/projects.ts:453-493` (wraps + freeze/reviewer logic), `stores/managedReview.ts:46-69` (own prescreen/screen status from task + record counts), `PdfsPage.vue:86-137` (own stage machine), `ManagedReviewWorkflowPage.vue:61-107` (own phase derivation, re-deriving "reviewer done" from working-tree counts), `PrescreenPage.vue:219-225` + `ScreenPage.vue:111-116` (bespoke completion predicates), plus `projects.nextOperation` from Python.
3. **Sticky dual-writer flag.** `hasStaleSearchSources` is computed one way in `SearchPage.loadSources` (`SearchPage.vue:115-123`: `is_stale || (API && !last_run_timestamp)`) and another in `projects.refreshCurrentProject` (`stores/projects.ts:342-345`: `operationInfo.search.needs_rerun`) — and the latter only ever sets it `true`. Once flipped, the sidebar shows search incomplete until the user happens to visit SearchPage.
4. **Seam-local recomputation of totals.** `response_formatter.py:52-91` clamps `md_retrieved` and re-sums `total_records` by hand to patch a core bug — UI totals are a local recomputation, not the engine's numbers. (Fix the bug in core or upstream it; delete the patch-over.)

## Scope of work

### 1. Derive the operation graph from core (Python)

- Replace the hardcoded maps in `status_handler.py` with derivations from `ProcessModel` transitions (`colrev/process/model.py:20-106`): operation order, input states, and "next operation" all computed from the transition table, so an upstream state-machine change propagates automatically.
- Extend the status RPC response to carry **everything views currently derive locally**, per step: `state: locked|ready|in_progress|complete`, `runnable: bool` + structured reason, `counts`, `next_operation`, and search-staleness (see §3). One payload = one truth.
- Fix the `md_retrieved` bug in `colrev/ops/status.py` (or core's `_get_currently_md_retrieved`) properly; delete the clamp/re-sum in `response_formatter.py` (record the core patch in `PATCHES.md`).

### 2. One thin renderer mapping

- `lib/stepStatus.ts` becomes the **only** renderer status module: a pure mapping from the (now-complete) status payload + UI-only inputs (freeze state, managed-review task role) to presentation. Keep its test suite; extend it.
- Delete/absorb the duplicates: `projects.getStepStatus` becomes a passthrough; `managedReview.getStepStatus` merges its task-role logic into the single module; `PdfsPage` stage machine, `ManagedReviewWorkflowPage.phaseStatus`, and both pages' completion predicates read the shared derivation. Where a page needs a sub-state the payload lacks (e.g. Pdfs upload-vs-fix stages), extend the payload rather than re-deriving from raw counts in the view.
- Sidebar badge, page completion screens, Overview CTA, and the workflow stepper all read the same source. Add a unit test asserting agreement by construction (same input → the components' inputs come from one function).

### 3. Search staleness: one writer

- Make search staleness part of the status payload (Python already has `framework/search_staleness.py` + `needs_rerun`): the renderer stores **no** independent `hasStaleSearchSources` — it reads the payload. Delete both current writers (`SearchPage.vue:115-123` local computation stays only as display detail per-source; `projects.ts:342-345` sticky flag goes).
- While in there: `search_staleness.py` hand-rewrites core's `*_search_history.json` (`restore_last_run_snapshot`, `:92-110`). Contain it behind one function with a format-drift test against core's writer, or move the snapshot into `colrev_app.json` where the wrapper owns the format.

## Acceptance criteria

- `grep` finds no operation-ordering literals (`load`→`prep`→…) outside the one Python derivation and no `OPERATION_INPUT_STATES`-style hand map.
- One renderer module computes step status; sidebar/step pages/Overview/stepper render from it (verified by imports).
- `hasStaleSearchSources` has exactly one writer (the status payload); the sticky-flag bug is gone (stale → run search → flag clears everywhere without visiting SearchPage).
- `response_formatter.py` no longer recomputes totals; status totals come from core.
- Extended `stepStatus` tests cover: mid-pipeline states, managed-review roles, freeze, staleness.

## Out of scope

- The freshness/refresh plumbing that delivers the payload (WP-05).
- Managed-review task lifecycle changes (WP-01/07).

## Dependencies

- WP-05 first (status flows through its invalidation seam). WP-03 helps (payload type changes propagate to TS automatically).
