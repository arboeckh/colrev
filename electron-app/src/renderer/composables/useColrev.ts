import { ref } from 'vue';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useOperationGuard } from './useOperationGuard';

// Methods that modify the repository and should go through the operation guard.
// Query-only methods (get_status, get_settings, etc.) are excluded.
const GUARDED_METHODS = new Set([
  'run_search',
  'run_load',
  'run_prep',
  'run_dedupe',
  'run_prescreen',
  'run_pdf_get',
  'run_pdf_prep',
  'run_screen',
  'run_data',
  'add_search_source',
  'remove_search_source',
  'update_settings',
  'update_record',
  'set_prescreen_decision',
  'set_screen_decision',
  'set_data_extraction',
  'init_project',
]);

/**
 * Composable for making JSON-RPC calls to the CoLRev backend.
 * Provides loading state, error handling, and automatic notifications.
 * Operations that modify the repo are automatically guarded with pre-sync and auto-save.
 */
export function useColrev() {
  const backend = useBackendStore();
  const notifications = useNotificationsStore();
  const { guardedOperation } = useOperationGuard();

  const isLoading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Make a JSON-RPC call with automatic loading state and error handling.
   * Mutating operations are automatically wrapped with the operation guard.
   */
  async function call<T>(
    method: string,
    params: Record<string, unknown> = {},
    options?: {
      silent?: boolean; // Don't show error notifications
      projectId?: string; // Add project_id to params
      skipGuard?: boolean; // Skip the operation guard even for mutating methods
    }
  ): Promise<T | null> {
    if (!backend.isRunning) {
      error.value = 'Backend is not running';
      if (!options?.silent) {
        notifications.error('Backend not running', 'Please wait for the backend to start');
      }
      return null;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const callParams = options?.projectId
        ? { project_id: options.projectId, ...params }
        : params;

      const doCall = async (): Promise<T> => {
        return await backend.call<T>(method, callParams);
      };

      // Wrap mutating operations with the guard
      let result: T | null;
      if (GUARDED_METHODS.has(method) && !options?.skipGuard) {
        result = await guardedOperation(doCall);
      } else {
        result = await doCall();
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error.value = message;

      if (!options?.silent) {
        notifications.error(`${method} failed`, message);
      }

      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Make a call with automatic success notification.
   */
  async function callWithNotification<T>(
    method: string,
    params: Record<string, unknown>,
    successMessage: string,
    options?: {
      projectId?: string;
    }
  ): Promise<T | null> {
    const result = await call<T>(method, params, options);

    if (result !== null) {
      notifications.success(successMessage);
    }

    return result;
  }

  return {
    isLoading,
    error,
    call,
    callWithNotification,
    isBackendRunning: backend.isRunning,
  };
}
