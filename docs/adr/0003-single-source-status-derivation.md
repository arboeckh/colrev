# ADR 0003: The engine derives step status once; the renderer only maps it

## Status

Accepted (2026-08, WP-06)

## Context

"Is this step done / runnable / next" was computed in at least seven places
over different inputs, on both sides of the RPC seam: a Python-side copy of
the operation ordering (`_determine_next_operation` + hand-maintained
`OPERATION_INPUT_STATES`), the renderer's `lib/stepStatus.ts`, wrappers in
`stores/projects.ts` and `stores/managedReview.ts`, a private stage machine
in `PdfsPage.vue`, a phase derivation in `ManagedReviewWorkflowPage.vue`,
and bespoke completion predicates in the prescreen/screen pages. The sidebar,
page completion screens, Overview CTA, and workflow stepper could each reach
a different verdict for the same step. Search staleness had two independent
writers, one of which only ever set the flag `true` (sticky until the user
happened to visit the Search page). `response_formatter.py` clamped and
re-summed the engine's totals to patch over a core counting bug.

## Decision

- **The operation graph is derived, not maintained.**
  `colrev/ui_jsonrpc/framework/operation_graph.py` computes operation order,
  per-operation input/output states, pending counts, and `next_operation`
  from core's `ProcessModel.transitions`. Manual repair operations
  (`prep_man`, `pdf_get_man`, `pdf_prep_man`) are folded into their
  canonical operation structurally (their source state is produced by the
  canonical operation and their dests re-join its dest set). An upstream
  state-machine change propagates automatically;
  `tests/ui_jsonrpc/test_operation_graph.py` reconstructs the chain
  independently and fails loudly on drift.
- **One payload = one truth.** `get_status` ships `status.steps` (one entry
  for `search` plus one per pipeline operation, each with
  `state: locked|ready|in_progress|complete`, `runnable` + reason,
  pending/processed/ever counts, and per-state `state_counts`),
  `status.search_stale` + `stale_sources`, and the derived
  `next_operation`. `get_operation_info` answers from the same derivation.
  The renderer's old 9-RPC `get_operation_info` fan-out is gone —
  `stores/projects.ts` exposes `payloadSteps`/`operationInfo` as computeds
  over the status payload.
- **One renderer module.** `lib/stepStatus.ts` is the only renderer status
  module: a pure mapping from the payload plus UI-only inputs (managed
  review task role, branch-switch freeze, reviewer-branch suppression) to
  presentation. Sidebar status, managed-review sidebar/phase status, the
  PDFs page stage machine, preprocessing stage completion, prescreen/screen
  completion predicates, and Overview next-step routing all import from it.
  Views never re-derive status from raw record counts.
- **Search staleness has one writer.** `search_staleness.stale_source_entries`
  is THE definition (never run, or query/params changed since last run;
  FILES/MD sources exempt); the renderer's `hasStaleSearchSources` is a
  computed over `status.search_stale`. The sticky-flag bug is structurally
  impossible.
- **Engine numbers are not patched over.** Core's per-source
  `currently.md_retrieved` accounting was fixed in `colrev/process/status.py`
  (recorded in `colrev/PATCHES.md`); `response_formatter.py` reshapes the
  engine's numbers and never recomputes them.

## Consequences

- A status disagreement between two surfaces is now a bug in exactly one of
  two places: the Python derivation or the single renderer mapping.
- The status payload is the extension point: when a view needs a sub-state,
  extend `status.steps` (or its `state_counts`) rather than deriving from
  raw counts in the view.
- Sidebar count badges still display effective counts (dev's counts on a
  reviewer branch); that substitution affects displayed numbers only, not
  status verdicts.
