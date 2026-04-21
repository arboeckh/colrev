import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useDebugStore } from './debug';
import rpcSchemas from '@/types/generated/rpc-schemas.json';
import type {
  ProgressEvent,
  RPCMethodName,
  RPCParams,
  RPCResult,
} from '@/types/generated/rpc';

// Methods flagged `writes: true` in the generated schema. Any successful call
// to one of these leaves staged changes in the repo, so the pending-changes
// store needs to re-check `get_git_status` after the response.
const WRITER_METHODS: ReadonlySet<string> = new Set(
  Object.entries(rpcSchemas.methods as Record<string, { writes?: boolean }>)
    .filter(([, spec]) => spec?.writes === true)
    .map(([name]) => name),
);

export type BackendStatus = 'stopped' | 'starting' | 'running' | 'error';

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

  // Request ID counter for tracking
  let requestIdCounter = 0;

  // Cleanup functions for event listeners
  let unsubLog: (() => void) | null = null;
  let unsubError: (() => void) | null = null;
  let unsubClose: (() => void) | null = null;
  let unsubProgress: (() => void) | null = null;

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
          if (current >= total) {
            setTimeout(() => { resetOperationProgress(); }, 500);
          }
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
        status.value = 'stopped';
      });
      unsubProgress = window.colrev.onProgress(handleProgressEvent);

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
    unsubLog = unsubError = unsubClose = unsubProgress = null;

    addLog('Backend stopped');
  }

  /**
   * Send a JSON-RPC call. Git-touching methods are serialized in the main
   * process (see `main/gitMutex.ts`) so the renderer doesn't queue locally.
   */
  async function callRaw<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const debug = useDebugStore();

    if (!isRunning.value) {
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

    try {
      const result = await window.colrev.call<T>(method, paramsWithPath);
      debug.logRpcResponse(requestId, result, false);
      if (WRITER_METHODS.has(method)) {
        schedulePostWriteRefresh();
      }
      return result;
    } catch (err) {
      const errorData = err instanceof Error ? { message: err.message, stack: err.stack } : err;
      debug.logRpcResponse(requestId, errorData, true);
      throw err;
    }
  }

  // Lazy imports to avoid circular `backend -> pendingChanges/git -> backend`
  // load. Resolved on first use and memoized.
  let pendingChangesRefresh: (() => Promise<void>) | null = null;
  let gitRefresh: (() => Promise<void>) | null = null;
  async function schedulePostWriteRefresh() {
    try {
      if (!pendingChangesRefresh) {
        const mod = await import('./pendingChanges');
        const store = mod.usePendingChangesStore();
        pendingChangesRefresh = () => store.refresh();
      }
      if (!gitRefresh) {
        const mod = await import('./git');
        const store = mod.useGitStore();
        gitRefresh = () => store.refreshStatus();
      }
      void Promise.all([pendingChangesRefresh(), gitRefresh()]);
    } catch {
      // Post-write refresh is best-effort; swallow.
    }
  }

  /**
   * Call a JSON-RPC method. Serialization against other git-touching
   * operations (dugite + backend RPC) happens in the Electron main process
   * via the shared git mutex — the renderer just forwards the call.
   *
   * Typed overload: when ``method`` is a known RPC method name, the params and
   * return type are inferred from the generated schema. Generic ``<T>`` fallback
   * remains so legacy call sites keep compiling during the typed migration.
   */
  function call<M extends RPCMethodName>(
    method: M,
    params: Omit<RPCParams<M>, 'base_path'>,
  ): Promise<RPCResult<M>>;
  function call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  function call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return callRaw(method, params);
  }

  async function ping(): Promise<boolean> {
    try {
      const result = await call<{ status: string }>('ping', {});
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
    // Computed
    isRunning,
    isStarting,
    canStart,
    // Actions
    start,
    stop,
    call,
    ping,
    addLog,
    clearLogs,
    onSearchProgress,
    clearSearchProgress,
    resetOperationProgress,
  };
});
