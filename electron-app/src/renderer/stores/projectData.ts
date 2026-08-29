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
    await refreshStores(full);
    // Project switched while refreshing: this batch belongs to the old
    // context — don't tell pages to reload against it.
    if (useProjectsStore().currentProjectId !== projectId) return;
    await emitEvent({ projectId, methods, full });
  }

  /** Serialize refreshes so a full invalidation never races a write refresh. */
  function enqueueRefresh(methods: string[], full: boolean): Promise<void> {
    // Failures are surfaced through the staleness flag; never poison the
    // chain (a rejected link would silently stop all future refreshes).
    refreshChain = refreshChain
      .then(() => runRefresh(methods, full))
      .catch(() => {
        markStale('Background refresh failed');
      });
    return refreshChain;
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
   * record lists) is coalesced on a trailing debounce so decision streaks
   * and enrichment batches trigger one refresh, not one each.
   */
  function notifyWriteCompleted(method: string): void {
    void lightRefresh();
    pendingMethods.push(method);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const methods = pendingMethods;
      pendingMethods = [];
      void enqueueRefresh(methods, false);
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
