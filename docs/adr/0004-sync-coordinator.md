# ADR 0004: One coordinator owns remote sync; policy is pure and enforced

## Status

Accepted (2026-09)

## Context

Collaborative reviews diverge, and the app's job is to make divergence rare
rather than to be good at resolving it. Before this decision, the app only
learned about a collaborator's work on window focus, and every pull and push
was a button the user had to know to press. Two people working a screening
queue for a morning could accumulate a day of divergence and then meet a
merge — which is a *research-integrity* event in a systematic review, not just
a data-loss event, because discarding a co-reviewer's decisions silently
fabricates a single-reviewer result in a review that claims two.

Three concrete failure modes made the old shape untenable:

1. **Divergence windows were unbounded.** `git fetch` ran only on window focus
   (`AppLayout.handleWindowFocus`), so `behind` could be hours stale and the
   Pull button's badge with it.
2. **Sync was scattered.** Ten-odd call sites called `git.pull()` /
   `git.push()` / `git.fetch()` directly — pages, dialogs, stores, a readiness
   panel. Nothing could be added centrally (a debounce, an offline rule, a
   "don't pull mid-walkthrough" guard) without finding and editing all of
   them, and the next call site would miss it again.
3. **Pages could silently render pre-pull state.** `ReviewDefinitionPage`
   copied the protocol URL and objectives into local refs on mount and never
   again, so a pull left the form showing pre-pull text *and* reporting it as
   unsaved changes. Any page that loads project data into local refs and skips
   the invalidation seam has the same bug; nothing detected it.

## Decision

### Sync is automatic, asymmetrically

Pull and push have opposite risk profiles and are treated differently.

- **Auto-pull only when the pull is a strict fast-forward** — remote is ahead,
  local is not ahead, working tree is clean. That case is mechanically
  incapable of losing anything: it moves a ref and updates files. Everything
  else (diverged, dirty) is a decision only the user can make.
- **Auto-push whenever the push is a fast-forward**, debounced ~4s after the
  last commit so a decision streak becomes one push. A push destroys nothing;
  the worst case is publishing work slightly early, and a non-fast-forward
  push is refused by the remote anyway.
- **Background fetch every ~90s (jittered), plus on focus.** Fetch is
  read-only and never touches the working tree, so it runs even while sync is
  otherwise held off — the counts stay honest, and the moment a hold lifts the
  coordinator already knows what to do.

### Interruption happens at operation boundaries, never mid-operation

A modal that appears unprompted while someone is screening record 23 trains
them to dismiss sync prompts, which is strictly worse than never showing one.
So:

- Unresolved situations render a persistent, non-blocking banner
  (`SyncStatusBanner`) that stays until resolved and is not dismissible —
  dismissing a real divergence is never the right outcome.
- Only `escalationSeverity(...) === 'gate'` situations (divergence, an
  in-progress merge conflict) additionally block at boundaries — launching a
  managed review, publishing dev into main, cutting a release — via
  `useSyncGate`.

### Policy is a pure function; the coordinator only executes

`lib/syncPolicy.ts` holds every rule as `decideAutoSync(input): AutoSyncAction`
plus `computeSyncEscalation`. It has no side effects and no store access, so
the rules are exhaustively testable and there is exactly one answer to "is it
safe to pull right now". `stores/sync.ts` evaluates it on a timer and performs
what it returns, with an exhaustiveness guard (`const never: never = action`)
so a new action kind cannot be added to the policy and silently ignored by the
executor.

### Suspension is automatic, not opt-in

Two hold-off signals require no cooperation from new code:

- `backend.runningOperation` — set at the single RPC funnel in `callRaw`, so
  any writer RPC automatically holds off working-tree changes.
- `useWalkthroughNavigation` calls `useSyncSuspense('walkthrough')` itself, so
  every walkthrough surface is protected the moment it adopts the standard
  composable. There is no separate step to remember.

`useSyncSuspense` ties the release to the component lifecycle, so a suspension
cannot leak and wedge auto-sync off permanently.

## Enforcement

The point of this ADR is that none of the above can quietly stop being true.
Three mechanisms, in increasing order of strength:

1. **The type checker.** The git store's remote primitives are not members of
   its public surface; they live in `git.__remoteOps`. `git.pull(...)` from a
   new call site is a compile error, not a code-review miss.
2. **`renderer/architecture.test.ts`**, run with the normal test suite:
   - only `stores/git.ts` and `stores/sync.ts` may reference `__remoteOps`;
   - only `stores/git.ts` may reach `window.git.{pull,push,fetch,fastForwardMain}`
     (project creation in `LandingPage` is an explicit, documented exemption —
     it pushes a repo that is not the current project, before a coordinator
     exists);
   - `sync.start()` is called from exactly one file, which must also call
     `sync.stop()`;
   - **every view that reads project data subscribes to the invalidation
     seam** — the rule that would have caught the review-definition bug.
     Exemptions are explicit, carry a reason, and are themselves checked for
     staleness.
3. **Failure messages that say what to do.** Each assertion names the fix
   ("use `useSyncStore().pullNow()`", "add `useProjectDataChanged`") so the
   invariant is repaired rather than exempted.

Adding a rule here is the standard response to "you must also remember to X"
appearing in a review.

## Consequences

- New sync behaviour goes in `syncPolicy.ts` and is covered by table-driven
  tests; new *callers* cannot introduce sync behaviour at all.
- Turning auto-sync off is available to the user (the sync status indicator's
  menu, persisted in `localStorage`) — background machinery the user cannot
  disable is machinery they cannot recover from.
- `reset_to_remote` now stamps a `backup/pre-reset-*` branch before destroying
  anything, committing uncommitted work onto it, so the one irreversible
  operation in the app became reversible by something other than the reflog.
- Auto-pull replaces the working tree more often than before, which raises the
  cost of a page that ignores the invalidation seam — hence enforcement rule
  (2) rather than a convention.

## Alternatives considered

- **A modal on every pending change.** Rejected: unprompted modals mid-review
  get dismissed reflexively, so the one that matters gets dismissed too.
- **Rebase instead of merge on divergence.** Rejected: with auto-push the
  other side already has our commits, so a rebase duplicates them and forces a
  push — and `colrev validate --merge` computes inter-rater agreement from the
  two-parent merge commit, which a rebase destroys.
- **Repo-level "keep mine / keep theirs" as the default resolution.**
  Rejected as a default; kept only as the loud last resort
  (`reset_to_remote`), now with a recovery branch. Per-record resolution
  through the existing `analyze_merge` / `apply_merge` engine stays the
  primary path.
