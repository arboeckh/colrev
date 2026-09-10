/**
 * The sync policy: given the current state of the repo and the app, what — if
 * anything — should the sync coordinator do right now, on its own?
 *
 * This module is pure and side-effect free, and it is the ONLY place the rules
 * live. `stores/sync.ts` executes what this decides; it never decides anything
 * itself. Adding a rule means adding it here and to `syncPolicy.test.ts` — a
 * new caller cannot acquire its own notion of "is it safe to pull".
 *
 * The governing idea is that conflicts are a function of how long two clones
 * are allowed to diverge. The policy therefore syncs eagerly whenever the
 * operation cannot lose anything, and refuses entirely otherwise — it never
 * takes a risk on the user's behalf and never resolves a conflict silently.
 */

/** What the coordinator should do on this tick. */
export type AutoSyncAction =
  | { kind: 'idle'; reason: IdleReason }
  | { kind: 'fetch' }
  | { kind: 'pull' }
  | { kind: 'push' };

/**
 * Why the coordinator is doing nothing. Surfaced in the sync status UI and in
 * tests — an unexplained "nothing happened" is the failure mode that makes
 * background sync impossible to trust or debug.
 */
export type IdleReason =
  | 'no-remote'
  | 'offline'
  | 'merge-conflict'
  | 'busy'
  | 'operation-running'
  | 'suspended'
  | 'diverged'
  | 'dirty'
  | 'auto-pull-disabled'
  | 'auto-push-disabled'
  | 'push-debounce'
  | 'up-to-date';

export interface SyncPolicyInput {
  hasRemote: boolean;
  isOnline: boolean;
  /** Commits on the local branch that the remote does not have. */
  ahead: number;
  /** Commits on the upstream that the local branch does not have. */
  behind: number;
  /** No uncommitted or untracked files. */
  isClean: boolean;
  hasMergeConflict: boolean;
  /** A git operation started by the coordinator is still running. */
  busy: boolean;
  /** A writer RPC is in flight (`backend.runningOperation`). */
  operationRunning: boolean;
  /** Reasons registered via `sync.suspend()`. Non-empty means hold off. */
  suspensions: readonly string[];
  autoPullEnabled: boolean;
  autoPushEnabled: boolean;
  /** ms since epoch of the last successful fetch; null if never fetched. */
  lastFetchAt: number | null;
  /** ms since epoch when the branch first became `ahead`; null if not ahead. */
  aheadSince: number | null;
  now: number;
  fetchIntervalMs: number;
  /** Quiet period after the last commit before an auto-push fires, so a
   * streak of decisions becomes one push instead of one push per decision. */
  pushDebounceMs: number;
}

/**
 * True when pulling cannot lose anything: the remote is strictly ahead, so the
 * pull is a fast-forward — moving a ref and updating files, with no merge, no
 * conflict and nothing of the user's to overwrite.
 *
 * Every other shape (diverged, dirty tree) is a decision only the user can
 * make, and is escalated to the UI rather than resolved here.
 */
export function isFastForwardPull(input: {
  behind: number;
  ahead: number;
  isClean: boolean;
}): boolean {
  return input.behind > 0 && input.ahead === 0 && input.isClean;
}

/**
 * True when pushing cannot lose anything: we have commits the remote lacks and
 * the remote has nothing we lack, so the push is a fast-forward for them. The
 * worst case is publishing work slightly early, which is recoverable; a
 * non-fast-forward push is refused by the remote anyway.
 *
 * A dirty tree does not block a push — a push moves committed history only,
 * and uncommitted work stays local either way.
 */
export function isFastForwardPush(input: { ahead: number; behind: number }): boolean {
  return input.ahead > 0 && input.behind === 0;
}

function isDiverged(input: { ahead: number; behind: number }): boolean {
  return input.ahead > 0 && input.behind > 0;
}

/**
 * Decide this tick's action.
 *
 * Precedence, highest first:
 *  1. Hard blocks — nothing may run (no remote, offline, mid-merge, busy).
 *  2. Pull, when it is a strict fast-forward. Reading the collaborator's work
 *     before publishing ours is what keeps the divergence window short.
 *  3. Push, when it is a strict fast-forward and the debounce has elapsed.
 *  4. Fetch, when the remote counts are stale. Read-only, so it is safe even
 *     while suspended — but it is the lowest priority.
 */
export function decideAutoSync(input: SyncPolicyInput): AutoSyncAction {
  if (!input.hasRemote) return { kind: 'idle', reason: 'no-remote' };
  if (!input.isOnline) return { kind: 'idle', reason: 'offline' };
  if (input.hasMergeConflict) return { kind: 'idle', reason: 'merge-conflict' };
  if (input.busy) return { kind: 'idle', reason: 'busy' };

  const fetchIsStale =
    input.lastFetchAt === null || input.now - input.lastFetchAt >= input.fetchIntervalMs;

  // A writer RPC is mutating the repo, or something on screen asked us to hold
  // off (a walkthrough in progress, a sync dialog open). Neither blocks a
  // fetch: it only updates remote-tracking refs, never the working tree, so
  // the counts stay honest while we wait.
  if (input.operationRunning) {
    return fetchIsStale ? { kind: 'fetch' } : { kind: 'idle', reason: 'operation-running' };
  }
  if (input.suspensions.length > 0) {
    return fetchIsStale ? { kind: 'fetch' } : { kind: 'idle', reason: 'suspended' };
  }

  if (isFastForwardPull(input)) {
    if (!input.autoPullEnabled) return { kind: 'idle', reason: 'auto-pull-disabled' };
    return { kind: 'pull' };
  }

  if (isFastForwardPush(input)) {
    if (!input.autoPushEnabled) return { kind: 'idle', reason: 'auto-push-disabled' };
    const since = input.aheadSince;
    if (since !== null && input.now - since < input.pushDebounceMs) {
      return { kind: 'idle', reason: 'push-debounce' };
    }
    return { kind: 'push' };
  }

  if (fetchIsStale) return { kind: 'fetch' };

  // Nothing automatic applies. Say why, so the UI can escalate the two cases
  // that need a human instead of silently sitting still.
  if (isDiverged(input)) return { kind: 'idle', reason: 'diverged' };
  if (input.behind > 0 && !input.isClean) return { kind: 'idle', reason: 'dirty' };
  return { kind: 'idle', reason: 'up-to-date' };
}

// --- Escalation: what the user is asked to do, and when ---

/**
 * The one thing auto-sync could not do for the user. `null` means there is
 * nothing to say — the overwhelmingly common case, and the one where the UI
 * must stay completely silent.
 */
export type SyncEscalation =
  | 'diverged'
  | 'dirty-blocks-pull'
  | 'behind-auto-disabled'
  | 'merge-conflict';

export interface EscalationInput {
  hasRemote: boolean;
  ahead: number;
  behind: number;
  isClean: boolean;
  hasMergeConflict: boolean;
  autoPullEnabled: boolean;
}

export function computeSyncEscalation(input: EscalationInput): SyncEscalation | null {
  if (!input.hasRemote) return null;
  if (input.hasMergeConflict) return 'merge-conflict';
  if (isDiverged(input)) return 'diverged';
  if (input.behind > 0 && !input.isClean) return 'dirty-blocks-pull';
  if (input.behind > 0 && !input.autoPullEnabled) return 'behind-auto-disabled';
  return null;
}

/**
 * How hard an escalation is allowed to interrupt.
 *
 * `banner` is persistent and non-blocking — it stays until the situation is
 * resolved, but never steals focus. `gate` additionally blocks at operation
 * boundaries (starting a walkthrough, publishing, releasing), which is the
 * only moment an interruption is worth its cost. Nothing is ever allowed to
 * open a modal mid-operation: a user trained to dismiss sync prompts is worse
 * off than one who never saw them.
 */
export function escalationSeverity(escalation: SyncEscalation): 'banner' | 'gate' {
  switch (escalation) {
    case 'merge-conflict':
    case 'diverged':
      return 'gate';
    case 'dirty-blocks-pull':
    case 'behind-auto-disabled':
      return 'banner';
  }
}
