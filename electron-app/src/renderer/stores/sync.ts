import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
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
/**
 * Quiet period after the branch first goes ahead before auto-push fires.
 *
 * The window is anchored to the *first* unpushed commit, not the latest, so a
 * streak of decisions still collapses into one push while the wait stays
 * bounded: work reaches the remote ~2s after it is committed no matter how
 * long the streak runs. The tick alone cannot deliver that — it samples every
 * `TICK_MS` — so `watchAhead` arms a timer the moment the snapshot changes and
 * the tick is only the backstop.
 */
const PUSH_DEBOUNCE_MS = 2_000;
/**
 * How long a failed auto-resolve suppresses the next attempt. `analyze_merge`
 * re-parses the whole record set, and divergence the engine declined to merge
 * on its own does not become mergeable a tick later — so retrying on the tick
 * would spend real work to reach the same "ask the user" every 5s.
 */
const RESOLVE_RETRY_MS = 60_000;

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
  const lastResolveAttemptAt = ref<number | null>(null);
  const lastSyncAt = ref<number | null>(null);
  const lastIdleReason = ref<IdleReason | null>(null);

  /** A coordinator-driven git operation is in flight. */
  const busy = ref(false);
  const isRunning = ref(false);

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
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
      lastResolveAttemptAt: lastResolveAttemptAt.value,
      now,
      fetchIntervalMs: FETCH_INTERVAL_MS + fetchJitter,
      pushDebounceMs: PUSH_DEBOUNCE_MS,
      resolveRetryMs: RESOLVE_RETRY_MS,
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

  /**
   * Combine a diverged branch with its upstream, but only where the engine
   * needs no decision from the user. A refusal is recorded, not reported: the
   * sync banner is already showing the divergence, and the cooldown keeps the
   * coordinator from re-analysing the record set every tick.
   */
  async function resolveNow(): Promise<boolean> {
    const ok = await runExclusive(() => git.__remoteOps.tryAutoResolveDivergence());
    if (ok) {
      lastSyncAt.value = Date.now();
      lastResolveAttemptAt.value = null;
      // The merge commit is ours to publish; let the push debounce start now.
      aheadSince.value = Date.now();
    } else if (ok === false) {
      // `null` means the executor was busy and never tried — not a refusal,
      // so it must not start a minute of silence.
      lastResolveAttemptAt.value = Date.now();
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
    // An explicit "sync now" is the user asking; a cooldown from an earlier
    // automatic refusal must not make the button do nothing.
    if (git.ahead > 0 && git.behind > 0 && git.isClean) {
      lastResolveAttemptAt.value = null;
      await resolveNow();
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
      case 'resolve':
        lastIdleReason.value = null;
        await resolveNow();
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

  function clearPushTimer(): void {
    if (pushTimer !== null) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  }

  /**
   * Turn "the branch went ahead" into a scheduled decision instead of waiting
   * for the next tick.
   *
   * Every mutating git operation in the main process rebuilds the snapshot and
   * pushes it to the store before it returns, so `git.ahead` moves the instant
   * a commit lands. Sampling that on a 5s timer meant a commit could sit for
   * the tick *plus* the debounce before anything happened — long enough that
   * the user reads the push counter as broken rather than pending. Arming a
   * timer for exactly the remaining debounce makes the wait the debounce, and
   * only the debounce; the tick stays as the backstop for everything the
   * watcher cannot see (a collaborator's push, coming back online).
   */
  function watchAhead(): void {
    trackAhead();
    clearPushTimer();
    if (aheadSince.value === null) return;

    const elapsed = Date.now() - aheadSince.value;
    const remaining = Math.max(0, PUSH_DEBOUNCE_MS - elapsed);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void tick();
    }, remaining);
  }

  async function tick(): Promise<void> {
    if (!projects.currentProjectId || !backend.isRunning) return;
    trackAhead();
    await executeAuto(decideAutoSync(policyInput(Date.now())));
  }

  /**
   * The snapshot is the only source of `ahead`, so watching it covers every
   * way a commit can appear — a screening decision, a merge, a managed review
   * — without each of those having to remember to poke the coordinator.
   */
  watch(
    () => (isRunning.value ? git.ahead : 0),
    () => {
      if (!isRunning.value) return;
      watchAhead();
    },
  );

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
    watchAhead();
    void tick();
  }

  function stop(): void {
    isRunning.value = false;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    clearPushTimer();
    suspensions.value = [];
    lastFetchAt.value = null;
    aheadSince.value = null;
    lastResolveAttemptAt.value = null;
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
    lastResolveAttemptAt,
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
    resolveNow,
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
