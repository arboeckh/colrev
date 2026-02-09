import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useDebugStore } from './debug';

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

    // Parse for search progress patterns
    parseSearchProgress(msg);
  }

  function parseSearchProgress(msg: string) {
    // Pattern: "Found X results" or "total_results: X" or "Total results found: X"
    // Process this FIRST to establish the real total before batch messages
    const resultsMatch = msg.match(/Found (\d+) results|total[_\s]?results[:\s]+(\d+)/i);
    if (resultsMatch) {
      const total = parseInt(resultsMatch[1] || resultsMatch[2], 10);
      const progress: SearchProgress = {
        currentBatch: 0,
        totalBatches: Math.ceil(total / 200), // Estimate based on batch size
        fetchedRecords: 0,
        totalRecords: total,
        status: `Found ${total} results`,
      };
      searchProgress.value = progress;
      notifySearchProgressListeners(progress);
      return;
    }

    // Pattern: "Fetching X records in batches"
    // This gives us the actual count to fetch (may differ from total results due to deduplication)
    const fetchingMatch = msg.match(/Fetching (\d+) records in batches/i);
    if (fetchingMatch) {
      const total = parseInt(fetchingMatch[1], 10);
      const progress: SearchProgress = {
        currentBatch: 0,
        totalBatches: Math.ceil(total / 200),
        fetchedRecords: 0,
        totalRecords: total,
        status: `Fetching ${total} records...`,
      };
      searchProgress.value = progress;
      notifySearchProgressListeners(progress);
      return;
    }

    // Pattern: "Fetching batch X/Y (Z records)..."
    // Update batch progress but preserve totalRecords from earlier messages
    const batchMatch = msg.match(/Fetching batch (\d+)\/(\d+) \((\d+) records\)/i);
    if (batchMatch) {
      const currentBatch = parseInt(batchMatch[1], 10);
      const totalBatches = parseInt(batchMatch[2], 10);
      const batchRecords = parseInt(batchMatch[3], 10);

      // Preserve the real totalRecords from earlier "Fetching X records in batches" message
      // Don't recalculate from batch info since last batch may be smaller
      const previousTotal = searchProgress.value?.totalRecords ?? 0;

      // Calculate fetched records: completed batches × batch size + current batch size
      // Use standard batch size (200) for completed batches, actual size for current
      const completedBatches = currentBatch - 1;
      const standardBatchSize = 200;
      const fetchedRecords = completedBatches * standardBatchSize + batchRecords;

      const progress: SearchProgress = {
        currentBatch,
        totalBatches,
        fetchedRecords,
        totalRecords: previousTotal > 0 ? previousTotal : totalBatches * standardBatchSize,
        status: `Fetching batch ${currentBatch}/${totalBatches}`,
      };
      searchProgress.value = progress;
      notifySearchProgressListeners(progress);
      return;
    }
  }

  function notifySearchProgressListeners(progress: SearchProgress) {
    searchProgressListeners.value.forEach(listener => listener(progress));
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
    searchProgress,
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
  };
});
