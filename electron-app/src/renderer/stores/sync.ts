import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useGitStore } from './git';
import { useBackendStore } from './backend';
import { useConnectionStore } from './connection';
import { useNotificationsStore } from './notifications';
import { useProjectsStore } from './projects';
import {
  computeSyncEscalation,
  decideAutoSync,
  type AutoSyncAction,
  type IdleReason,
  type SyncEscalation,
} from '@/lib/syncPolicy';

/**
 * The sync coordinator: the single owner of when this app talks to the remote.
 *
 * Every fetch, pull and push in the renderer goes through here — automatic and
 * user-initiated alike — so there is exactly one place that knows about
 * suspension, debouncing, offline handling, invalidation and conflict
 * escalation. The git store's remote primitives are deliberately not on its
 * public surface (see `git.__remoteOps`), so a future call site cannot start
 * its own private sync path without the type checker and
 * `architecture.test.ts` both objecting.
 *
 * Policy lives in `lib/syncPolicy.ts` and is pure. This store only executes.
 */

/** How often the policy is evaluated. Cheap: it is a pure function over refs. */
const TICK_MS = 5_000;
/** Background fetch cadence. Fetch is read-only and does not touch the tree. */
const FETCH_INTERVAL_MS = 90_000;
/** Spread across clients so two collaborators don't fetch in lockstep. */
const FETCH_JITTER_MS = 15_000;
/** Quiet period after the last commit before auto-push fires. */
const PUSH_DEBOUNCE_MS = 4_000;

const AUTO_PULL_KEY = 'sync.autoPull';
const AUTO_PUSH_KEY = 'sync.autoPush';

function readPreference(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'false';
  } catch {
    return true;
  }
}

function writePreference(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // A blocked storage backend must not break syncing.
  }
}

export const useSyncStore = defineStore('sync', () => {
  const git = useGitStore();
  const backend = useBackendStore();
  const connection = useConnectionStore();
  const notifications = useNotificationsStore();
  const projects = useProjectsStore();

  const autoPullEnabled = ref(readPreference(AUTO_PULL_KEY));
  const autoPushEnabled = ref(readPreference(AUTO_PUSH_KEY));

  /** Active hold-off reasons, most recent last. Empty means auto-sync may run. */
  const suspensions = ref<string[]>([]);

  const lastFetchAt = ref<number | null>(null);
  const aheadSince = ref<number | null>(null);
  const lastSyncAt = ref<number | null>(null);
  const lastIdleReason = ref<IdleReason | null>(null);

  /** A coordinator-driven git operation is in flight. */
  const busy = ref(false);
  const isRunning = ref(false);

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let fetchJitter = Math.floor(Math.random() * FETCH_JITTER_MS);

  const escalation = computed<SyncEscalation | null>(() =>
    computeSyncEscalation({
      hasRemote: git.hasRemote,
      ahead: git.ahead,
      behind: git.behind,
      isClean: git.isClean,
      hasMergeConflict: git.hasMergeConflict,
      autoPullEnabled: autoPullEnabled.value,
    }),
  );

  const isSuspended = computed(() => suspensions.value.length > 0);

  /**
   * Ask auto-sync to hold off while something is in progress that a working
   * tree change would disrupt — a screening walkthrough, an open sync dialog.
   * Returns the release function; callers must call it (the `useSyncSuspense`
   * composable ties this to the component lifecycle so it cannot leak).
   *
   * Suspension never blocks a fetch: remote counts stay accurate throughout,
   * so the moment the hold lifts the coordinator already knows what to do.
   */
  function suspend(reason: string): () => void {
    const token = `${reason}#${Math.random().toString(36).slice(2, 8)}`;
    suspensions.value = [...suspensions.value, token];
    let released = false;
    return () => {
      if (released) return;
      released = true;
      suspensions.value = suspensions.value.filter((t) => t !== token);
    };
  }

  function policyInput(now: number) {
    return {
      hasRemote: git.hasRemote,
      isOnline: connection.isOnline,
      ahead: git.ahead,
      behind: git.behind,
      isClean: git.isClean,
      hasMergeConflict: git.hasMergeConflict,
      busy: busy.value,
      operationRunning: backend.runningOperation !== null,
      suspensions: suspensions.value,
      autoPullEnabled: autoPullEnabled.value,
      autoPushEnabled: autoPushEnabled.value,
      lastFetchAt: lastFetchAt.value,
      aheadSince: aheadSince.value,
      now,
      fetchIntervalMs: FETCH_INTERVAL_MS + fetchJitter,
      pushDebounceMs: PUSH_DEBOUNCE_MS,
    };
  }

  // --- Execution ---

  async function runExclusive<T>(fn: () => Promise<T>): Promise<T | null> {
    if (busy.value) return null;
    busy.value = true;
    try {
      return await fn();
    } finally {
      busy.value = false;
    }
  }

  /**
   * Fetch remote refs. Read-only: it never touches the working tree, so it is
   * safe at any time and is the one operation allowed while suspended.
   */
  async function fetchNow(): Promise<boolean> {
    const ok = await runExclusive(() => git.__remoteOps.fetch());
    if (ok) {
      lastFetchAt.value = Date.now();
      // Re-roll so a client that drifted into lockstep with another drifts out.
      fetchJitter = Math.floor(Math.random() * FETCH_JITTER_MS);
    }
    return ok === true;
  }

  /**
   * Pull. Safe shapes are handled by the git store (fast-forward); a diverged
   * or dirty repo is escalated there into the semantic merge flow or the
   * pull-blocked dialog rather than being forced through here.
   */
  async function pullNow(): Promise<boolean> {
    const ok = await runExclusive(() => git.__remoteOps.pull());
    if (ok) lastSyncAt.value = Date.now();
    return ok === true;
  }

  async function pushNow(): Promise<boolean> {
    const ok = await runExclusive(() => git.__remoteOps.push());
    if (ok) {
      lastSyncAt.value = Date.now();
      aheadSince.value = null;
    }
    return ok === true;
  }

  /** Fast-forward local `main` to `origin/main` without checking it out. */
  async function fastForwardMainNow(): Promise<boolean> {
    const ok = await runExclusive(() => git.__remoteOps.fastForwardMain());
    if (ok) lastSyncAt.value = Date.now();
    return ok === true;
  }

  /**
   * User-initiated "sync now": pull what is safe, then push what is safe.
   * Same executor as the automatic path, so the manual button can never
   * behave differently from the background loop.
   */
  async function syncNow(): Promise<void> {
    await fetchNow();
    if (git.behind > 0 && git.ahead === 0 && git.isClean) {
      await pullNow();
    }
    if (git.ahead > 0 && git.behind === 0) {
      await pushNow();
    }
  }

  /**
   * Auto-pull succeeded. A quiet, non-blocking confirmation: the user needs to
   * know their view changed under them, but must not be asked to acknowledge
   * something they never requested.
   */
  function announcePull(count: number): void {
    notifications.info(
      count === 1 ? 'Pulled 1 change' : `Pulled ${count} changes`,
      'Your collaborators’ latest work is now in this review.',
    );
  }

  async function executeAuto(action: AutoSyncAction): Promise<void> {
    switch (action.kind) {
      case 'idle':
        lastIdleReason.value = action.reason;
        return;
      case 'fetch':
        lastIdleReason.value = null;
        await fetchNow();
        return;
      case 'pull': {
        lastIdleReason.value = null;
        const count = git.behind;
        const ok = await pullNow();
        if (ok) announcePull(count);
        return;
      }
      case 'push':
        lastIdleReason.value = null;
        await pushNow();
        return;
      default: {
        // Exhaustiveness guard: a new action kind fails to compile here until
        // it is executed, so the policy can never grow a case the coordinator
        // silently ignores.
        const never: never = action;
        return never;
      }
    }
  }

  /** Track when the branch first became ahead, so the push debounce has a start. */
  function trackAhead(): void {
    if (git.ahead > 0) {
      if (aheadSince.value === null) aheadSince.value = Date.now();
    } else {
      aheadSince.value = null;
    }
  }

  async function tick(): Promise<void> {
    if (!projects.currentProjectId || !backend.isRunning) return;
    trackAhead();
    await executeAuto(decideAutoSync(policyInput(Date.now())));
  }

  /**
   * Start the background loop for the current project. Called once, from
   * `AppLayout`; `architecture.test.ts` enforces that it stays the only caller
   * so the loop cannot be started twice or forgotten on a new surface.
   */
  function start(): void {
    if (isRunning.value) return;
    // Re-read preferences at start rather than only at store construction:
    // the store may have been created long before a project was opened (and
    // in tests, before the harness set them).
    loadPreferences();
    isRunning.value = true;
    tickTimer = setInterval(() => void tick(), TICK_MS);
    void tick();
  }

  function stop(): void {
    isRunning.value = false;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    suspensions.value = [];
    lastFetchAt.value = null;
    aheadSince.value = null;
    lastIdleReason.value = null;
  }

  /** Window focus: the natural moment to pick up a collaborator's work. */
  function onWindowFocus(): void {
    lastFetchAt.value = null;
    void tick();
  }

  function loadPreferences(): void {
    autoPullEnabled.value = readPreference(AUTO_PULL_KEY);
    autoPushEnabled.value = readPreference(AUTO_PUSH_KEY);
  }

  function setAutoPull(enabled: boolean): void {
    autoPullEnabled.value = enabled;
    writePreference(AUTO_PULL_KEY, enabled);
  }

  function setAutoPush(enabled: boolean): void {
    autoPushEnabled.value = enabled;
    writePreference(AUTO_PUSH_KEY, enabled);
  }

  return {
    // state
    autoPullEnabled,
    autoPushEnabled,
    suspensions,
    lastFetchAt,
    lastSyncAt,
    lastIdleReason,
    busy,
    isRunning,
    // getters
    escalation,
    isSuspended,
    // suspension
    suspend,
    // operations (the only sanctioned remote entry points in the renderer)
    fetchNow,
    pullNow,
    pushNow,
    fastForwardMainNow,
    syncNow,
    // lifecycle
    start,
    stop,
    tick,
    onWindowFocus,
    loadPreferences,
    setAutoPull,
    setAutoPush,
  };
});
