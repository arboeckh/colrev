import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useDebugStore } from './debug';
import { RpcError, type RpcCallEnvelope } from '@/lib/rpc-errors';
import rpcSchemas from '@/types/generated/rpc-schemas.json';
import type {
  ProgressEvent,
  RPCMethodName,
  RPCParams,
  RPCResult,
} from '@/types/generated/rpc';

// Methods flagged `writes: true` in the generated schema. Any call to one of
// these may leave staged changes in the repo, so the pending-changes store
// needs to re-check `get_git_status` after the response. Restricted to
// project-scoped methods: `init_project`/`delete_project` also write, but the
// refresh targets the *current* project, which a non-project method didn't
// touch (and may have just deleted).
const WRITER_METHODS: ReadonlySet<string> = new Set(
  Object.entries(
    rpcSchemas.methods as Record<
      string,
      { writes?: boolean; requires_project?: boolean }
    >,
  )
    .filter(([, spec]) => spec?.writes === true && spec?.requires_project === true)
    .map(([name]) => name),
);

export type BackendStatus = 'stopped' | 'starting' | 'running' | 'restarting' | 'error';

export interface SearchProgress {
  currentBatch: number;
  totalBatches: number;
  fetchedRecords: number;
  totalRecords: number;
  status: string;
}

export const useBackendStore = defineStore('backend', () => {
  // State
  const status = ref<BackendStatus>('stopped');
  const error = ref<string | null>(null);
  const logs = ref<string[]>([]);
  const basePath = ref<string>('./projects');

  // Search progress tracking
  const searchProgress = ref<SearchProgress | null>(null);
  const searchProgressListeners = ref<Set<(progress: SearchProgress) => void>>(new Set());

  // Generic operation progress (percentage 0–100, used by pdf_get, pdf_prep, etc.)
  const operationProgress = ref<number | null>(null);
  const operationTotal = ref<number>(0);
  const operationDone = ref<number>(0);

  // Serial RPC queue visibility: the Python backend handles one request at a
  // time — this exposes what it is working on and what is waiting, so the UI
  // can say "waiting on: search" instead of freezing silently.
  const rpcInFlight = ref<string | null>(null);
  const rpcQueued = ref<string[]>([]);

  // A writer RPC is in flight. Operation-triggering buttons disable off this
  // so double-clicks (and concurrent triggers from different surfaces) fire
  // exactly one RPC. Tracks the first writer when several overlap.
  const runningOperation = ref<{ method: string; startedAt: number } | null>(null);
  let writerDepth = 0;

  // Request ID counter for tracking
  let requestIdCounter = 0;

  // Cleanup functions for event listeners
  let unsubLog: (() => void) | null = null;
  let unsubError: (() => void) | null = null;
  let unsubClose: (() => void) | null = null;
  let unsubProgress: (() => void) | null = null;
  let unsubRestarting: (() => void) | null = null;
  let unsubRestarted: (() => void) | null = null;
  let unsubRestartFailed: (() => void) | null = null;
  let unsubRpcQueue: (() => void) | null = null;

  // Computed
  const isRunning = computed(() => status.value === 'running');
  const isStarting = computed(() => status.value === 'starting');
  const canStart = computed(() => status.value === 'stopped' || status.value === 'error');

  // Actions
  function addLog(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    logs.value.push(`[${timestamp}] ${msg}`);
    // Keep last 100 logs
    if (logs.value.length > 100) {
      logs.value.shift();
    }
  }

  function resetOperationProgress() {
    operationProgress.value = null;
    operationTotal.value = 0;
    operationDone.value = 0;
  }

  function notifySearchProgressListeners(progress: SearchProgress) {
    searchProgressListeners.value.forEach(listener => listener(progress));
  }

  function handleProgressEvent(event: ProgressEvent) {
    const current = typeof event.current === 'number' ? event.current : 0;
    const total = typeof event.total === 'number' ? event.total : 0;

    switch (event.kind) {
      case 'search_progress': {
        const progress: SearchProgress = {
          currentBatch: current,
          totalBatches: total,
          fetchedRecords: current,
          totalRecords: total,
          status: event.message,
        };
        searchProgress.value = progress;
        notifySearchProgressListeners(progress);
        return;
      }
      case 'load_progress':
      case 'prep_progress':
      case 'dedupe_progress':
      case 'pdf_get_progress':
      case 'pdf_prep_progress': {
        if (total > 0) {
          operationTotal.value = total;
          operationDone.value = Math.min(current, total);
          operationProgress.value = Math.round((operationDone.value / total) * 100);
          // Don't auto-reset on completion: many operations have a
          // post-pool tail (commit, rename, etc.) where no further
          // progress events fire. Resetting to null mid-tail flips the
          // button back to a spinner. The donut is gated on isRunning
          // anyway, so a lingering 100% disappears as soon as the call
          // resolves.
        }
        return;
      }
      case 'generic':
      default:
        // Appended to logs via onLog; no further state mutation.
        return;
    }
  }

  function onSearchProgress(listener: (progress: SearchProgress) => void) {
    searchProgressListeners.value.add(listener);
    return () => searchProgressListeners.value.delete(listener);
  }

  function clearSearchProgress() {
    searchProgress.value = null;
  }

  function clearLogs() {
    logs.value = [];
  }

  async function start(): Promise<boolean> {
    if (!canStart.value) return false;

    status.value = 'starting';
    error.value = null;
    addLog('Starting backend...');

    try {
      // Setup event listeners
      unsubLog = window.colrev.onLog((msg) => {
        addLog(`[backend] ${msg}`);
      });
      unsubError = window.colrev.onError((msg) => {
        addLog(`[error] ${msg}`);
      });
      unsubClose = window.colrev.onClose((code) => {
        addLog(`[close] Backend exited with code ${code}`);
        // An unexpected exit is followed within ms by a 'restarting' event
        // from the supervisor; 'stopped' is only the final state if no
        // restart follows (deliberate stop, or supervisor gave up).
        status.value = 'stopped';
      });
      unsubProgress = window.colrev.onProgress(handleProgressEvent);
      unsubRestarting = window.colrev.onRestarting((info) => {
        status.value = 'restarting';
        addLog(
          `[supervisor] Backend crashed — restarting (attempt ${info.attempt}/${info.maxAttempts})`
        );
      });
      unsubRestarted = window.colrev.onRestarted(() => {
        status.value = 'running';
        addLog('[supervisor] Backend restarted');
        // The new process has no memory of prior in-flight work — treat all
        // project state as stale and re-derive it.
        void refreshAfterRestart();
      });
      unsubRestartFailed = window.colrev.onRestartFailed(() => {
        status.value = 'error';
        error.value = 'Backend crashed and could not be restarted';
        addLog('[supervisor] Backend restart failed — giving up');
      });
      unsubRpcQueue = window.colrev.onRpcQueue((state) => {
        rpcInFlight.value = state.inFlight?.method ?? null;
        rpcQueued.value = state.queued;
      });

      const result = await window.colrev.start();

      if (result.success) {
        status.value = 'running';
        addLog('Backend started successfully');

        // Load app info to get projects path
        try {
          const appInfo = await window.appInfo.get();
          if (appInfo.projectsPath) {
            basePath.value = appInfo.projectsPath;
            addLog(`Projects path: ${basePath.value}`);
          }
        } catch {
          addLog('Could not load app info');
        }

        return true;
      } else {
        status.value = 'error';
        error.value = result.error || 'Failed to start backend';
        addLog(`Failed to start: ${error.value}`);
        return false;
      }
    } catch (err) {
      status.value = 'error';
      error.value = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Error: ${error.value}`);
      return false;
    }
  }

  async function stop(): Promise<void> {
    addLog('Stopping backend...');
    await window.colrev.stop();
    status.value = 'stopped';

    // Cleanup listeners
    unsubLog?.();
    unsubError?.();
    unsubClose?.();
    unsubProgress?.();
    unsubRestarting?.();
    unsubRestarted?.();
    unsubRestartFailed?.();
    unsubRpcQueue?.();
    unsubLog = unsubError = unsubClose = unsubProgress = null;
    unsubRestarting = unsubRestarted = unsubRestartFailed = unsubRpcQueue = null;

    addLog('Backend stopped');
  }

  /**
   * Send a JSON-RPC call. Git-touching methods are serialized in the main
   * process (see `main/gitMutex.ts`) so the renderer doesn't queue locally.
   */
  async function callRaw<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const debug = useDebugStore();

    // Calls during a supervised restart are accepted: the main process
    // queues them and sends them once the new backend answers ping.
    if (!isRunning.value && status.value !== 'restarting') {
      const err = new Error('Backend is not running');
      debug.logError(`Call to ${method} failed: backend not running`);
      throw err;
    }

    // Add base_path to params if not already present
    const paramsWithPath = {
      base_path: basePath.value,
      ...params,
    };

    // Generate request ID and log the request
    const requestId = `req-${++requestIdCounter}`;
    debug.logRpcRequest(method, paramsWithPath, requestId);

    const isWriter = WRITER_METHODS.has(method);
    if (isWriter) {
      writerDepth += 1;
      if (writerDepth === 1) {
        runningOperation.value = { method, startedAt: Date.now() };
      }
    }

    try {
      // The preload bridge is typed against known method names; callRaw is
      // the single untyped funnel beneath the typed `call` wrapper.
      const bridgeCall = window.colrev.call as (
        method: string,
        params: Record<string, unknown>,
      ) => Promise<RpcCallEnvelope<unknown>>;
      const envelope = await bridgeCall(method, paramsWithPath);
      if (!envelope.ok) {
        // Rethrow the serialized failure as a typed RpcError so call sites
        // can branch on `error.code` (never on message text).
        const err = new RpcError(envelope.error);
        debug.logRpcResponse(
          requestId,
          { code: err.code, message: err.message, data: err.data },
          true,
        );
        throw err;
      }
      debug.logRpcResponse(requestId, envelope.result, false);
      return envelope.result as T;
    } finally {
      if (isWriter) {
        writerDepth -= 1;
        if (writerDepth === 0) {
          runningOperation.value = null;
        }
        // Notify the invalidation seam on the error path too: a handler can
        // fail *after* mutating disk (e.g. serialization raising
        // post-commit), and the UI must not keep showing a clean git state.
        void notifyWriteCompleted(method);
      }
    }
  }

  // Lazy import to avoid circular `backend -> projectData -> stores -> backend`
  // load at module evaluation. Resolved on first use and memoized.
  let projectDataNotify: ((method: string) => void) | null = null;
  async function notifyWriteCompleted(method: string) {
    try {
      if (!projectDataNotify) {
        const mod = await import('./projectData');
        const store = mod.useProjectDataStore();
        projectDataNotify = (m) => store.notifyWriteCompleted(m);
      }
      projectDataNotify(method);
    } catch {
      // The seam being unavailable must not fail the RPC itself.
    }
  }

  /**
   * After a supervised backend restart, all project state derived from the
   * old process is stale — run a full invalidation through the seam.
   */
  async function refreshAfterRestart() {
    try {
      const mod = await import('./projectData');
      await mod.useProjectDataStore().invalidateAll();
    } catch {
      // Best-effort: a failed refresh must not take the restart path down.
    }
  }

  /**
   * Call a JSON-RPC method. Serialization against other git-touching
   * operations (dugite + backend RPC) happens in the Electron main process
   * via the shared git mutex — the renderer just forwards the call.
   *
   * Only known method names are accepted; params and result types come from
   * the generated schema (`types/generated/rpc.d.ts`). For dynamic method
   * names (e.g. an operation id held in a variable) use {@link callUntyped}.
   */
  function call<M extends RPCMethodName>(
    method: M,
    params: Omit<RPCParams<M>, 'base_path'>,
  ): Promise<RPCResult<M>> {
    return callRaw(method, params as Record<string, unknown>);
  }

  /**
   * Untyped escape hatch for dynamic method names. The result is `unknown`
   * unless narrowed by the caller — do not use this where the method name is
   * statically known.
   */
  function callUntyped<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return callRaw(method, params);
  }

  async function ping(): Promise<boolean> {
    try {
      const result = await call('ping', {});
      return result.status === 'pong';
    } catch {
      return false;
    }
  }

  return {
    // State
    status,
    error,
    logs,
    basePath,
    searchProgress,
    operationProgress,
    rpcInFlight,
    rpcQueued,
    runningOperation,
    // Computed
    isRunning,
    isStarting,
    canStart,
    // Actions
    start,
    stop,
    call,
    callUntyped,
    ping,
    addLog,
    clearLogs,
    onSearchProgress,
    clearSearchProgress,
    resetOperationProgress,
  };
});
