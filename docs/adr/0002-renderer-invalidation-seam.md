# ADR 0002: Renderer data freshness flows through one invalidation seam

## Status

Accepted (2026-08, WP-05)

## Context

"How does the UI learn the new state after a mutation?" used to have five
answers: a post-write hook in `stores/backend.ts` that refreshed only
pending-changes + git status, per-view hand-rolled refresh combos after each
mutation, `window.location.reload()` after pull/reset, a dead `dataVersion`
ref, and a dead operation-guard composable. Separately, async loaders applied
responses without checking they were still relevant, so a project or branch
switch mid-flight could paint the old context's records into the new view.

## Decision

- **One seam.** `stores/projectData.ts` is the single owner of renderer
  freshness. The backend store reports every completed writer RPC (flagged
  `writes: true` in the generated schema, error path included) to
  `notifyWriteCompleted`. The seam then:
  1. immediately refreshes pending-changes + git status (cheap, and these
     gate commit buttons / launch readiness — they must never lag a write);
  2. on a short trailing debounce, runs the comprehensive refresh
     (`projects.refreshCurrentProject` — status, settings, operation info,
     managed review, branch delta — plus git + pending) and emits one
     `project-data-changed {projectId, methods, full}` event.
- **Pages subscribe instead of choreographing.** Views register "when
  project data changes and I'm active, reload my records" once via
  `useProjectDataChanged`. Walkthrough pages (prescreen/screen) reload only
  on `full` events — their in-progress queue is self-managed; plain record
  tables (search sources, PDFs) reload on every event.
- **Full invalidation replaces `location.reload()`.** Pull, reset-to-remote,
  merge apply, and backend restart call `invalidateAll()`: bump the request
  epoch, refresh everything (including branches and the review definition),
  and emit a `full` event.
- **Request guards.** The seam owns an epoch, bumped on project/branch
  switch (`loadProject`) and full invalidation. Project-scoped loaders
  capture `snapshot()` before their await and discard responses whose epoch
  or project moved (`isCurrent()`), so stale responses are never painted.
  `loadAllOperationInfo` and `refreshCurrentProject` coalesce with a "dirty
  re-run": callers arriving mid-flight share one follow-up request that
  starts after the current one — a post-mutation refresh never receives
  pre-mutation data.
- **Operation-in-progress state.** `backend.runningOperation` is set around
  writer RPCs; operation buttons disable off it (double-click protection in
  one place).
- **Error surfacing convention.** Loads set a page-level `loadError`
  rendered as a shared retry UI (`LoadErrorState`); mutations toast;
  background (seam) refresh failures set a visible "data may be stale" flag
  in the header instead of being swallowed. `managedReview.refresh` keeps
  last-known tasks and sets `lastRefreshError` on failure so a fetch failure
  is distinguishable from "no tasks" (task state gates access control).

## Consequences

- Mutating from any surface updates every visible consumer without the view
  having to know what else depends on the data.
- The comprehensive refresh costs ~13 serialized reads (see ADR 0001); the
  debounce coalesces decision streaks and enrichment batches so it runs once
  per burst, not once per write. The immediate light refresh keeps the
  latency-critical dirty/clean state exact.
- Completion screens that need fresh counts *now* call
  `projectData.refreshNow()` (flushes the pending debounce) instead of
  hand-rolling store refreshes.
- `window.location.reload()` survives only in the logout flow (`UserMenu`),
  where rebinding all stores to a different account genuinely wants a fresh
  renderer.
