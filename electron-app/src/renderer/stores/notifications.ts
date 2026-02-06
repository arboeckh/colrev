import { defineStore } from 'pinia';
import { ref } from 'vue';
import { toast } from 'vue-sonner';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: Date;
}

export const useNotificationsStore = defineStore('notifications', () => {
  // Keep a history of notifications
  const history = ref<Notification[]>([]);

  function addToHistory(type: NotificationType, title: string, message?: string) {
    const notification: Notification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      title,
      message,
      timestamp: new Date(),
    };
    history.value.unshift(notification);

    // Keep last 50 notifications
    if (history.value.length > 50) {
      history.value.pop();
    }
  }

  function success(title: string, message?: string) {
    toast.success(title, {
      description: message,
    });
    addToHistory('success', title, message);
  }

  function error(title: string, message?: string) {
    toast.error(title, {
      description: message,
    });
    addToHistory('error', title, message);
  }

  function info(title: string, message?: string) {
    toast.info(title, {
      description: message,
    });
    addToHistory('info', title, message);
  }

  function warning(title: string, message?: string) {
    toast.warning(title, {
      description: message,
    });
    addToHistory('warning', title, message);
  }

  function clearHistory() {
    history.value = [];
  }

  return {
    history,
    success,
    error,
    info,
    warning,
    clearHistory,
  };
});
