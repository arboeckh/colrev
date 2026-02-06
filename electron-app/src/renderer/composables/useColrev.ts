import { ref } from 'vue';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';

/**
 * Composable for making JSON-RPC calls to the CoLRev backend.
 * Provides loading state, error handling, and automatic notifications.
 */
export function useColrev() {
  const backend = useBackendStore();
  const notifications = useNotificationsStore();

  const isLoading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Make a JSON-RPC call with automatic loading state and error handling.
   */
  async function call<T>(
    method: string,
    params: Record<string, unknown> = {},
    options?: {
      silent?: boolean; // Don't show error notifications
      projectId?: string; // Add project_id to params
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

      const result = await backend.call<T>(method, callParams);
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
