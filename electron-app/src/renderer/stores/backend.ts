import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useDebugStore } from './debug';

export type BackendStatus = 'stopped' | 'starting' | 'running' | 'error';

export const useBackendStore = defineStore('backend', () => {
  // State
  const status = ref<BackendStatus>('stopped');
  const error = ref<string | null>(null);
  const logs = ref<string[]>([]);
  const basePath = ref<string>('./projects');

  // Request ID counter for tracking
  let requestIdCounter = 0;

  // Cleanup functions for event listeners
  let unsubLog: (() => void) | null = null;
  let unsubError: (() => void) | null = null;
  let unsubClose: (() => void) | null = null;

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
    unsubLog = unsubError = unsubClose = null;

    addLog('Backend stopped');
  }

  async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
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
      return result;
    } catch (err) {
      const errorData = err instanceof Error ? { message: err.message, stack: err.stack } : err;
      debug.logRpcResponse(requestId, errorData, true);
      throw err;
    }
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
  };
});
