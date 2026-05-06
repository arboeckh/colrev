import { defineStore } from 'pinia';
import { ref, onScopeDispose } from 'vue';

/**
 * Tracks online/offline state for the renderer and lets other stores
 * register handlers that should run when the network comes back.
 *
 * The browser's `navigator.onLine` is the source of truth for the indicator;
 * stores that detect a network failure mid-operation can also call
 * `markOffline()` to flip the badge before the OS-level event fires.
 */
export const useConnectionStore = defineStore('connection', () => {
  const isOnline = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  type ReconnectHandler = () => void | Promise<void>;
  const reconnectHandlers = new Set<ReconnectHandler>();

  function handleOnline() {
    const wasOffline = !isOnline.value;
    isOnline.value = true;
    if (wasOffline) {
      for (const h of reconnectHandlers) {
        try {
          void h();
        } catch (err) {
          console.warn('Reconnect handler threw:', err);
        }
      }
    }
  }

  function handleOffline() {
    isOnline.value = false;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    onScopeDispose(() => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    });
  }

  /** Called by stores that observed a network-shaped failure during an
   * operation. We flip the badge optimistically; the OS 'online' event
   * will flip it back when connectivity returns. */
  function markOffline() {
    isOnline.value = false;
  }

  /** Called by stores that just observed a successful network operation —
   * useful when navigator.onLine lags reality. Triggers reconnect handlers
   * if we were previously offline. */
  function markOnline() {
    if (!isOnline.value) {
      handleOnline();
    }
  }

  /** Register a callback to fire when the renderer transitions offline → online.
   * Returns an unregister function. */
  function onReconnect(handler: ReconnectHandler): () => void {
    reconnectHandlers.add(handler);
    return () => reconnectHandlers.delete(handler);
  }

  return {
    isOnline,
    markOffline,
    markOnline,
    onReconnect,
  };
});
