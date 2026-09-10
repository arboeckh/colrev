import { defineStore } from 'pinia';
import { ref } from 'vue';
// Store modules are imported statically but their use*Store() factories are
// only invoked inside functions — same circular-import pattern as
// projects <-> git (safe via Vite ESM live bindings).
import { useProjectsStore } from './projects';
import { useGitStore } from './git';
import { usePendingChangesStore } from './pendingChanges';
import { useReviewDefinitionStore } from './reviewDefinition';

/**
 * One event per (coalesced) batch of completed writer RPCs, or one per full
 * invalidation (pull, reset-to-remote, merge, backend restart).
 */
export interface ProjectDataEvent {
  projectId: string | null;
  /** Writer RPC methods that completed since the last event. */
  methods: string[];
  /**
   * True when the working tree may have been replaced wholesale (pull, reset,
   * merge, backend restart). Pages holding walkthrough state (prescreen /
   * screen queues) should discard and reload on `full`; plain record tables
   * can reload on every event.
   */
  full: boolean;
}

type ProjectDataSubscriber = (event: ProjectDataEvent) => void | Promise<void>;

/** Trailing debounce for write-triggered refreshes: rapid successive writes
 * (decision streaks, enrichment batches) collapse into one refresh. */
const WRITE_REFRESH_DEBOUNCE_MS = 400;

/**
 * Backoff for re-deriving store state after a failed refresh.
 *
 * A refresh that fails is not a cosmetic problem: every page that renders
 * *derived* state (the PDF stage machine, step status, runnability) reads it
 * from the stores and nothing else, so one lost `get_status` freezes those
 * views on the pre-mutation payload until something reloads the project
 * outright — switching accounts, or reopening the review. Retrying here is
 * what keeps a single transient failure (an RPC timeout, a backend restart)
 * from turning into permanently wrong-looking UI.
 */
const REFRESH_RETRY_BACKOFFS_MS = [1_000, 3_000, 9_000];

/**
 * The single invalidation seam for project data freshness (WP-05).
 *
 * "How does the UI learn the new state after a mutation?" has exactly one
 * answer: the backend store reports every completed writer RPC here (see
 * `notifyWriteCompleted`), this store re-derives all store-owned state
 * (project status, operation info, git, pending changes, managed review) and
 * then emits one `project-data-changed` event to mounted pages, which reload
 * the record lists they own.
 *
 * It also owns the request epoch: bumped on project/branch switch and full
 * invalidation so in-flight loads from a previous context are discarded
 * instead of painting stale data (see `snapshot`).
 */
export const useProjectDataStore = defineStore('projectData', () => {
  // Request epoch: any project-scoped load captures a snapshot before its
  // await and discards the response if the epoch moved underneath it.
  const epoch = ref(0);

  // Set when a background (seam-driven) refresh failed: data on screen may be
  // stale. Rendered in the header; cleared by the next successful refresh.
  const isStale = ref(false);
  const staleReason = ref<string | null>(null);

  const subscribers = new Set<ProjectDataSubscriber>();

  let pendingMethods: string[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshChain: Promise<void> = Promise.resolve();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  /** When the last write-triggered refresh was dispatched, for the leading edge. */
  let lastDispatchAt = 0;
  /**
   * Depth of `runRefresh` calls currently on the stack. Non-zero means we are
   * inside a subscriber handler, which must never chain onto `refreshChain`
   * (see `enqueueRefresh`).
   */
  let refreshDepth = 0;
  /**
   * A handler that invalidates on every event would recurse forever. Nothing
   * legitimately needs more than one level (branch switch inside a handler),
   * so cut it off well short of a stack overflow.
   */
  const MAX_REFRESH_DEPTH = 4;

  function bumpEpoch(): void {
    epoch.value += 1;
  }

  /**
   * Capture the current {projectId, epoch}. Loaders call this before their
   * await and check `isCurrent()` after — a project/branch switch or full
   * invalidation in between makes the response stale.
   */
  function snapshot(): { isCurrent: () => boolean } {
    const projects = useProjectsStore();
    const epochAtStart = epoch.value;
    const projectAtStart = projects.currentProjectId;
    return {
      isCurrent: () =>
        epoch.value === epochAtStart &&
        useProjectsStore().currentProjectId === projectAtStart,
    };
  }

  /** Register a page-level "reload my records" handler. Returns unsubscribe. */
  function subscribe(fn: ProjectDataSubscriber): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function markStale(reason: string): void {
    isStale.value = true;
    staleReason.value = reason;
  }

  function clearStale(): void {
    isStale.value = false;
    staleReason.value = null;
  }

  function cancelRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryAttempt = 0;
  }

  /**
   * Re-derive store state after a failed refresh, on a capped backoff.
   *
   * Only the store side is retried: pages were already told to reload their
   * own record lists by the refresh that failed, and repeating that would
   * churn every mounted table. Giving up after the last backoff leaves
   * `isStale` set, which is what the header's staleness indicator and the
   * manual Refresh button are for.
   */
  function scheduleRetry(full: boolean): void {
    if (retryTimer) return;
    const delay = REFRESH_RETRY_BACKOFFS_MS[retryAttempt];
    if (delay === undefined) return;
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      refreshChain = refreshChain
        .then(async () => {
          if (!isStale.value) {
            retryAttempt = 0;
            return;
          }
          await refreshStores(full);
          if (isStale.value) scheduleRetry(full);
          else retryAttempt = 0;
        })
        .catch(() => {
          markStale('Background refresh failed');
        });
    }, delay);
  }

  async function emitEvent(event: ProjectDataEvent): Promise<void> {
    await Promise.all(
      Array.from(subscribers).map(async (fn) => {
        try {
          await fn(event);
        } catch {
          // A page handler failing must not break the seam or other pages.
        }
      }),
    );
  }

  /**
   * Re-derive all store-owned project state. `full` additionally reloads
   * state that only changes when the working tree is replaced (branches,
   * review definition).
   */
  async function refreshStores(full: boolean): Promise<void> {
    const projects = useProjectsStore();
    const git = useGitStore();
    const pending = usePendingChangesStore();

    if (!projects.currentProjectId) return;

    const tasks: Promise<unknown>[] = [
      // Covers status, settings, operation info, managed review, branch delta.
      projects.refreshCurrentProject(),
      // One snapshot refresh covers branch, ahead/behind, cleanliness, pending
      // changes and the merge-conflict flag — `pending` reads the same one.
      // It reports failure rather than throwing, so surface it as a rejection
      // for the staleness check below.
      git.refreshStatus().then((ok) => {
        if (!ok) throw new Error(git.lastRefreshError ?? 'Git refresh failed');
      }),
    ];
    if (full) {
      tasks.push(git.refreshBranches());
      const reviewDef = useReviewDefinitionStore();
      if (reviewDef.definition) {
        tasks.push(reviewDef.loadDefinition());
      }
    }

    const results = await Promise.allSettled(tasks);
    const failure = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    if (failure) {
      markStale(
        failure.reason instanceof Error
          ? failure.reason.message
          : 'Background refresh failed',
      );
    } else {
      clearStale();
    }
  }

  async function runRefresh(methods: string[], full: boolean): Promise<void> {
    const projects = useProjectsStore();
    const projectId = projects.currentProjectId;
    if (!projectId) return;
    refreshDepth += 1;
    try {
      await refreshStores(full);
      // Project switched while refreshing: this batch belongs to the old
      // context — don't tell pages to reload against it.
      if (useProjectsStore().currentProjectId !== projectId) return;
      await emitEvent({ projectId, methods, full });
      // `refreshStores` reports failure through the staleness flag rather than
      // throwing, so this is the only place that learns the stores did not
      // actually catch up with the write that triggered this refresh.
      if (isStale.value) scheduleRetry(full);
    } finally {
      refreshDepth -= 1;
    }
  }

  /** Serialize refreshes so a full invalidation never races a write refresh. */
  function enqueueRefresh(methods: string[], full: boolean): Promise<void> {
    cancelRetry();
    lastDispatchAt = Date.now();
    // Reentrant call: a subscriber handler reacted to an event by triggering
    // another invalidation (a branch switch is the real case — see
    // `git.switchBranch`). Chaining here would deadlock: the link we would
    // wait for is the one that is awaiting this very handler. Serialization
    // is already satisfied — nothing else can run while the chain is busy —
    // so run it inline instead.
    if (refreshDepth > 0) {
      if (refreshDepth >= MAX_REFRESH_DEPTH) {
        markStale('Refresh loop detected');
        return Promise.resolve();
      }
      return runRefresh(methods, full).catch(() => {
        markStale('Background refresh failed');
      });
    }
    // Failures are surfaced through the staleness flag; never poison the
    // chain (a rejected link would silently stop all future refreshes).
    refreshChain = refreshChain
      .then(() => runRefresh(methods, full))
      .catch(() => {
        markStale('Background refresh failed');
      });
    return refreshChain;
  }

  /** Dispatch everything queued so far as one refresh. */
  function flushPending(full: boolean): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const methods = pendingMethods;
    pendingMethods = [];
    void enqueueRefresh(methods, full);
  }

  /**
   * Cheap, latency-critical refresh fired immediately after every write: the
   * git snapshot gates commit buttons and launch readiness, and must never lag
   * behind a mutation (a debounce here would open a window where the tree is
   * dirty but the UI still claims clean).
   */
  async function lightRefresh(): Promise<void> {
    if (!useProjectsStore().currentProjectId) return;
    try {
      await useGitStore().refreshStatus();
    } catch {
      // The debounced full refresh surfaces staleness if this keeps failing.
    }
  }

  /**
   * A writer RPC completed. Pending-changes/git state refreshes immediately;
   * the comprehensive refresh (status, operation info, managed review, page
   * record lists) is debounced leading-and-trailing.
   *
   * Leading edge matters for how the app feels: a single deliberate action
   * (mark a PDF unavailable, finish an operation) is one write after a quiet
   * period, and making the user watch a debounce elapse before the row leaves
   * the table is latency we simply added ourselves. The trailing edge is what
   * the debounce was for — decision streaks and enrichment batches still
   * collapse into one follow-up refresh rather than one refresh each.
   */
  function notifyWriteCompleted(method: string): void {
    void lightRefresh();
    pendingMethods.push(method);
    const quiet = Date.now() - lastDispatchAt >= WRITE_REFRESH_DEBOUNCE_MS;
    if (!debounceTimer && quiet) {
      flushPending(false);
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushPending(false);
    }, WRITE_REFRESH_DEBOUNCE_MS);
  }

  /**
   * The working tree changed wholesale (pull, reset-to-remote, merge apply,
   * backend restart). Bumps the epoch so in-flight loads are discarded, then
   * refreshes everything and tells pages to reload from scratch.
   */
  async function invalidateAll(): Promise<void> {
    bumpEpoch();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const methods = pendingMethods;
    pendingMethods = [];
    await enqueueRefresh([...methods, 'invalidate'], true);
  }

  /**
   * Immediate (non-debounced) refresh: header Refresh button, and pages that
   * need fresh store state before rendering (e.g. a completion screen).
   * Absorbs any pending debounced write events so they don't refresh twice.
   */
  async function refreshNow(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const methods = pendingMethods;
    pendingMethods = [];
    await enqueueRefresh([...methods, 'refresh'], false);
  }

  return {
    // State
    epoch,
    isStale,
    staleReason,
    // Epoch / request guards
    bumpEpoch,
    snapshot,
    // Seam
    subscribe,
    notifyWriteCompleted,
    invalidateAll,
    refreshNow,
    // Staleness flag
    markStale,
    clearStale,
  };
});
