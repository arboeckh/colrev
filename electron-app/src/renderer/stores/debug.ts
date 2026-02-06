import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface DebugLogEntry {
  id: string;
  type: 'rpc-request' | 'rpc-response' | 'error' | 'backend' | 'info';
  message: string;
  data?: unknown;
  timestamp: Date;
  duration?: number; // For RPC responses, time in ms
  requestId?: string; // To link request/response
}

export const useDebugStore = defineStore('debug', () => {
  const logs = ref<DebugLogEntry[]>([]);
  const maxLogs = 500;

  // Track pending requests for duration calculation
  const pendingRequests = ref<Map<string, { timestamp: Date; method: string }>>(new Map());

  const hasErrors = computed(() => logs.value.some((log) => log.type === 'error'));

  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function addLog(entry: Omit<DebugLogEntry, 'id' | 'timestamp'>) {
    const log: DebugLogEntry = {
      ...entry,
      id: generateId(),
      timestamp: new Date(),
    };

    logs.value.push(log);

    // Trim if over max
    if (logs.value.length > maxLogs) {
      logs.value = logs.value.slice(-maxLogs);
    }

    // Also log to console for developer tools
    const prefix = `[DEBUG][${log.type.toUpperCase()}]`;
    if (log.type === 'error') {
      console.error(prefix, log.message, log.data);
    } else {
      console.log(prefix, log.message, log.data);
    }
  }

  function logRpcRequest(method: string, params: unknown, requestId?: string) {
    const id = requestId || generateId();
    pendingRequests.value.set(id, { timestamp: new Date(), method });

    addLog({
      type: 'rpc-request',
      message: `→ ${method}`,
      data: params,
      requestId: id,
    });

    return id;
  }

  function logRpcResponse(requestId: string, result: unknown, isError = false) {
    const pending = pendingRequests.value.get(requestId);
    const duration = pending ? Date.now() - pending.timestamp.getTime() : undefined;
    const method = pending?.method || 'unknown';

    pendingRequests.value.delete(requestId);

    addLog({
      type: isError ? 'error' : 'rpc-response',
      message: isError ? `✗ ${method} failed` : `← ${method}`,
      data: result,
      duration,
      requestId,
    });
  }

  function logError(message: string, error?: unknown) {
    addLog({
      type: 'error',
      message,
      data: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
  }

  function logBackend(message: string) {
    addLog({
      type: 'backend',
      message,
    });
  }

  function logInfo(message: string, data?: unknown) {
    addLog({
      type: 'info',
      message,
      data,
    });
  }

  function clear() {
    logs.value = [];
    pendingRequests.value.clear();
  }

  return {
    logs,
    hasErrors,
    addLog,
    logRpcRequest,
    logRpcResponse,
    logError,
    logBackend,
    logInfo,
    clear,
  };
});
