# WP-05: Renderer Data Freshness — One Invalidation Seam, Guarded Requests

## Context

"How does the UI learn the new state after a mutation?" currently has five answers: a post-write hook that refreshes only two stores, per-view hand-rolled reloads, `window.location.reload()` as a hammer, a dead `dataVersion` ref, and a dead operation-guard subsystem. Separately, async loaders apply responses without checking they're still relevant. This package gives freshness a single owner and kills the wrong-data races.

## Problems being fixed

1. **Incomplete post-write hook.** `schedulePostWriteRefresh` (`stores/backend.ts:230, 245-261`) fires after any `writes:true` method but refreshes **only** `pendingChanges` + `git.refreshStatus()` — never `projects.refreshCurrentProject()`, so status counts, `operationInfo`, and record lists go stale unless each view remembers to re-fetch. Its catch also swallows all errors (`:258-260`).
2. **Per-view reload roulette.** `SearchPage.vue:191-193`, `PdfsPage.vue:395-397`, `PrescreenPage.vue:423`, `ScreenPage.vue:283` each decide independently what to reload. Cross-view staleness is guaranteed (e.g. run search → `ProjectOverview` funnel still shows pre-search numbers; `pdf_get` from another surface → PDF table stale).
3. **Dead mechanisms.** `projects.dataVersion` (`stores/projects.ts:71`) is never bumped nor watched. `composables/useColrev.ts` + `useOperationGuard.ts` (double-click protection, post-op refresh, `isOperationRunning`) are imported nowhere — so `git.isOperationRunning` is always `false` app-wide and `autoSyncIfSafe` (`stores/git.ts:687`) is unreachable.
4. **Wrong-project races.** Every loader checks `currentProjectId` before the `await` and writes results back unconditionally after: `PrescreenPage.loadQueue` (`:253-284`), `PdfsPage.loadRecords` (`:206-247`), `ScreenPage.loadQueue` (`:215-250`), `PrescreenPage.makeDecision` (`:404-427`). Project/branch switch mid-flight paints the old project's records into the new view.
5. **Stale coalescing.** `loadAllOperationInfo`'s `_opInfoInFlight` (`stores/projects.ts:281-285`) returns the *older* in-flight promise to newer callers, so a post-mutation refresh can receive pre-mutation data. `refreshCurrentProject` has no in-flight guard at all — mount/focus/decision refreshes interleave last-write-wins.
6. **Inconsistent error surfacing.** Same failure, three behaviors: `ScreenPage` renders a Retry UI (`ScreenPage.vue:245-250, 426-439`); `PrescreenPage` `console.error`s and shows an empty state indistinguishable from "nothing to prescreen" (`:286`); many stores swallow silently (`projects.ts:171,186`, `managedReview.ts:95` — where a fetch failure looks like "no tasks" and drives access logic; `git.ts:285,495,519`; all of `reviewDefinition.ts`).

## Scope of work

### 1. One invalidation seam

- Introduce a single `projectData` refresh module (composable or store): a writer RPC completing (hook into the existing `WRITER_METHODS` interception in `stores/backend.ts`) emits one `project-data-changed {projectId, method}` event; subscribed stores re-derive what they own (`projects` status/opInfo, `git`, `pendingChanges`, `managedReview`, and page-level record lists via a registration API).
- Views stop calling refresh combos by hand: pages register "when project data changes and I'm active, reload my records" once. Delete the per-view refresh choreography.
- `location.reload()` sites (`stores/git.ts:145, 189`, post-merge `:642`) become full-invalidation events through the same seam. Keep reload only as a last-resort for backend restart if needed.
- Delete dead code: `dataVersion`, `useColrev.ts`, `useOperationGuard.ts`, `autoSyncIfSafe` (or resurrect deliberately — decide, don't leave ambient).

### 2. Request guards

- One fetch helper used by all project-scoped loads: captures `{projectId, epoch}` at call time; the invalidation seam bumps the epoch on project/branch switch; responses from a stale epoch are discarded. Apply to the four loaders above + `refreshCurrentProject` + `loadAllOperationInfo`.
- Fix `_opInfoInFlight`: coalesce only requests started *after* the current one; a refresh triggered post-mutation must start a new request.
- Add a real in-flight/dedupe policy to `refreshCurrentProject` (newest-wins with epoch check).

### 3. Operation-in-progress state (resurrected properly)

- One store-level `runningOperation: {method, startedAt} | null` set by the backend store around writer calls (this is where WP-02's queue visibility surfaces). Buttons that trigger operations disable off it — restoring the double-click protection the dead guard promised, in one place instead of per-button.

### 4. Error surfacing convention

- Pick one rule and apply it: **loads** set a per-store/page `loadError` rendered as retry UI (ScreenPage pattern generalized — extract its Retry block into a shared component); **mutations** toast on failure; **background refreshes** may stay quiet but must set a visible "data may be stale" flag rather than swallowing. `managedReview.refresh` must distinguish "no tasks" from "fetch failed" (it gates access control).
- Remove leftover debug logging (`stores/git.ts:628-630`).

## Acceptance criteria

- Mutating from any surface updates every visible consumer (manual matrix: search-run → Overview funnel; pdf_get → PDF table; decision → sidebar counts) without visiting the page.
- Project-switch during a slow queue load never renders the old project's records (unit-testable once WP-08's store testing lands; until then, e2e assertion with an artificial delay).
- `grep` shows no `window.location.reload` in stores, no `dataVersion`, no `useOperationGuard`.
- Double-clicking any operation button fires exactly one RPC.
- A failed queue load on PrescreenPage shows a retry UI, not an empty queue.

## Out of scope

- Status *derivation* consolidation (WP-06 — this package moves the data; that one unifies the math).
- Git store internal restructuring (WP-07); here it only subscribes to the seam.

## Dependencies

- WP-02 (transport events, `RpcError`) and WP-03 (typed calls) make this cleaner; hard dependency on neither. Strongly recommended before WP-06/07.
