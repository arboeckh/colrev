import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AuthSession, DeviceFlowStatus, AccountInfo } from '@/types/window';

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession | null>(null);
  const isLocalMode = ref(false);
  const deviceFlowStatus = ref<DeviceFlowStatus | null>(null);
  const isLoading = ref(true);
  const accounts = ref<AccountInfo[]>([]);

  const isAuthenticated = computed(() => session.value !== null);
  const user = computed(() => session.value?.user ?? null);
  const hasAccess = computed(() => isAuthenticated.value || isLocalMode.value);
  const hasMultipleAccounts = computed(() => accounts.value.length > 1);

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

      // Load account list
      await refreshAccounts();

      // Subscribe to auth events
      unsubAuthUpdate = window.auth.onAuthUpdate((updatedSession) => {
        session.value = updatedSession;
        if (updatedSession) {
          isLocalMode.value = false;
        }
        refreshAccounts();
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

  async function refreshAccounts() {
    try {
      accounts.value = await window.auth.listAccounts();
    } catch {
      accounts.value = [];
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
    await refreshAccounts();
  }

  async function switchAccount(login: string) {
    const result = await window.auth.switchAccount(login);
    if (result) {
      session.value = result;
      await refreshAccounts();
    }
    return result;
  }

  async function removeAccount(login: string) {
    await window.auth.removeAccount(login);
    await refreshAccounts();
    // If we removed the active account, session will be updated via onAuthUpdate callback
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
    accounts,
    isAuthenticated,
    user,
    hasAccess,
    hasMultipleAccounts,
    initialize,
    login,
    logout,
    switchAccount,
    removeAccount,
    refreshAccounts,
    continueWithoutLogin,
    dispose,
  };
});
