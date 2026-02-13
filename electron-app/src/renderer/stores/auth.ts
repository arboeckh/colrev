import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AuthSession, DeviceFlowStatus } from '@/types/window';

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession | null>(null);
  const isLocalMode = ref(false);
  const deviceFlowStatus = ref<DeviceFlowStatus | null>(null);
  const isLoading = ref(true);

  const isAuthenticated = computed(() => session.value !== null);
  const user = computed(() => session.value?.user ?? null);
  const hasAccess = computed(() => isAuthenticated.value || isLocalMode.value);

  let unsubAuthUpdate: (() => void) | null = null;
  let unsubDeviceFlow: (() => void) | null = null;

  async function initialize() {
    isLoading.value = true;
    try {
      // Check for existing session
      const existing = await window.auth.getSession();
      if (existing) {
        session.value = existing;
      }

      // Subscribe to auth events
      unsubAuthUpdate = window.auth.onAuthUpdate((updatedSession) => {
        session.value = updatedSession;
        if (updatedSession) {
          isLocalMode.value = false;
        }
      });

      unsubDeviceFlow = window.auth.onDeviceFlowStatus((status) => {
        deviceFlowStatus.value = status;
      });
    } catch (err) {
      console.error('Failed to initialize auth:', err);
    } finally {
      isLoading.value = false;
    }
  }

  async function login() {
    deviceFlowStatus.value = { status: 'awaiting_code' };
    await window.auth.login();
  }

  async function logout() {
    await window.auth.logout();
    session.value = null;
    isLocalMode.value = false;
  }

  function continueWithoutLogin() {
    isLocalMode.value = true;
  }

  function dispose() {
    unsubAuthUpdate?.();
    unsubDeviceFlow?.();
  }

  return {
    session,
    isLocalMode,
    deviceFlowStatus,
    isLoading,
    isAuthenticated,
    user,
    hasAccess,
    initialize,
    login,
    logout,
    continueWithoutLogin,
    dispose,
  };
});
