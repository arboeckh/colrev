# WP-07: Git State Ownership, Mutex Coverage, Sync Robustness

## Context

Git facts live in four renderer-visible copies (real git → Python `get_git_status` → `projects.currentGitStatus` → `git` store refs, plus `pendingChanges`' own copy), synced by manual `refreshStatus` calls and optimistic writes from three different writers. The mutex that should serialize repo access has deliberate holes. Sync failures are swallowed or mis-reported. And the decision-flow's dirty-tree model collides with branch switching via a silent, never-popped stash — the single worst data-loss risk in the app.

## Problems being fixed

1. **Stash stranding (fix first — data loss).** `gitCheckout` auto-stashes a dirty/untracked tree to complete a checkout and leaves the stash in place (`git-manager.ts:264-293`). The managed-review flow keeps `records.bib` dirty between decisions by design, and `ensureManagedTaskAccess` switches branches automatically (`PrescreenPage.vue:584-595`). Unsaved reviewer decisions can be silently stranded in a stash.
2. **Triple-cached status, three `currentBranch` writers.** `git.refreshStatus` copies `projects.currentGitStatus` into its own refs (`stores/git.ts:259-278`); `refreshBranches` sets `currentBranch` from dugite (`:298`); `switchBranch`/`ensureDevBranch`/`mergeDevIntoMain` set it optimistically (`:326, 377, 419`). `ProjectOverview` reads `projects.currentGitStatus.remote_url` while everything else reads `git.remoteUrl`. `pendingChanges` independently calls `get_git_status` (`stores/pendingChanges.ts:55`). Guards like `canPush`/`canPull` (`git.ts:78-79`) act on whichever copy last refreshed.
3. **Mutex holes.** `GIT_FREE_RPC_METHODS` includes `get_git_status` (`index.ts:60-67`), which constructs a `git.Repo` and reads index/refs (`git_handler.py:129-223`) — not git-free. `registerGitRead` (`index.ts:91-96`) exempts `git:analyze-divergence` and friends, which run bursts of git reads possibly during a Python commit. Classification is manual with no enforcement.
4. **Failure semantics.** `gitPush` returns raw stderr unclassified (`git-manager.ts:102-119`) — a non-fast-forward push shows a stderr toast with no "pull first" guidance, unlike `gitPull`'s classified `DIVERGED`/`DIRTY_WORKTREE`. Offline detection string-matches stderr (`git.ts:121`). Device-flow auth polling swallows network errors until expiry (`auth-manager.ts:406-408`).
5. **`index.ts` god module.** ~40 IPC handlers as inline lambdas over module globals (`index.ts:153-818`) — untestable; the GitHub handlers repeat token/parse/try-catch boilerplate ~10×.
6. **Managed-review loose ends.** Reviewer branches are never merged or deleted after reconciliation (accumulate on origin); the `"reconciling"` task state is defined but never written (`managed_review.py:41` vs `:476,563,910`); branch-switch orchestration is duplicated in two views with four uncoordinated switch sites (`PrescreenPage.vue:541-601`, `ScreenPage.vue:153-213`, `ManagedReviewWorkflowPage.selectPhase`, router guard `router/index.ts:210-212`).

## Scope of work

### 1. Kill the silent stash

- `git:checkout` must never auto-stash silently. Policy: if the tree is dirty, fail with a structured `DIRTY_WORKTREE` result; the renderer then offers "Save decisions & switch" (commit via the existing `commit_changes` path) or "Discard". If a stash fallback is kept for edge cases, it must be surfaced and restored, never dropped.
- Audit all switch sites for the new contract; add an e2e regression: make decisions, trigger a branch switch, assert decisions survive.

### 2. One git snapshot, one owner

- Main process owns a single `GitState` snapshot per project (branch, ahead/behind, main_ahead/behind, clean, remote, merge-conflict flag), refreshed under the mutex, pushed to the renderer over one IPC event (`git-state-changed`). Renderer `git` store becomes a subscriber: no optimistic `currentBranch` writes (mutating ops end by emitting a fresh snapshot), no copying from `projects`, and `pendingChanges` reads the same snapshot instead of its own `get_git_status` call.
- `projects.currentGitStatus` consumers migrate to the store; one source, verified by grep.
- Retire `window.location.reload()` sync hammers (coordinates with WP-05's invalidation seam).

### 3. Close the mutex holes

- `get_git_status` and `git:analyze-divergence` run under the lock (they're reads of mutable state, not lock-free). With WP-02's queue this no longer freezes the UI — status reads queue briefly and the UI shows why.
- Replace the manual `GIT_FREE_RPC_METHODS` / `registerGitRead` lists with lock-by-default: exemption requires an explicit `lockFree: true` at registration with a comment. Add a test that every registered git/RPC handler is classified.

### 4. Classify sync failures

- `gitPush`: classify non-fast-forward (`REJECTED_FETCH_FIRST`), auth, offline into a result enum like `gitPull` already has; renderer maps to actionable UX ("Pull first", "Sign in again", "You're offline"). Replace stderr string-matching for offline with a dugite error-code check where possible.
- Auth device-flow: surface repeated network failure as its own state instead of looping to "expired".

### 5. Extract testable modules from `index.ts`

- Move git/sync/GitHub IPC handler bodies into modules with injected dependencies (`{git, backend, auth}`), continuing WP-04's `merge-flow.ts` pattern; `setupIPC` becomes registration-only. Factor the repeated GitHub token/parse/error boilerplate into one wrapper.

### 6. Managed-review branch hygiene

- After successful reconciliation: delete local + remote `review/*` branches (behind a confirm, or automatically with the audit trail as the record). Either use the `"reconciling"` state during apply or delete it.
- Deduplicate `ensureManagedTaskAccess` into one composable owning the reviewer-branch invariant; the router guard delegates to it, eliminating competing switch sites.

## Acceptance criteria

- Dirty-tree branch switch is impossible without an explicit user choice; the decisions-survive-switch e2e passes.
- Exactly one code path calls `get_git_status`; `git` store has no writer besides the snapshot subscription (grep-verified).
- Non-fast-forward push shows "Pull first" UX, not raw stderr.
- `index.ts` contains no handler bodies >5 lines; extracted modules have unit tests (fake git/backend), including the apply-merge rollback paths.
- Completed tasks leave no `review/*` branches on origin (or a visible cleanup prompt).

## Out of scope

- Fake/real GitHub client contract tests (WP-08).
- Python-side merge logic (WP-04).

## Dependencies

- WP-02 (queue visibility makes lock-by-default acceptable UX). WP-05 recommended first (snapshot event rides the invalidation seam). §1 (stash) is independent and urgent — it may be cherry-picked and done immediately.
