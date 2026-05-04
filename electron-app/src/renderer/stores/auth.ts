import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AuthSession, DeviceFlowStatus, AccountInfo } from '@/types/window';

const KEYCHAIN_EXPLAINED_KEY = 'colrev:keychain-explained';

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession | null>(null);
  const isLocalMode = ref(false);
  const deviceFlowStatus = ref<DeviceFlowStatus | null>(null);
  const isLoading = ref(true);
  const accounts = ref<AccountInfo[]>([]);
  const keychainExplainerOpen = ref(false);

  const isAuthenticated = computed(() => session.value !== null);
  const user = computed(() => session.value?.user ?? null);
  const hasAccess = computed(() => isAuthenticated.value || isLocalMode.value);
  const hasMultipleAccounts = computed(() => accounts.value.length > 1);

  let unsubAuthUpdate: (() => void) | null = null;
  let unsubDeviceFlow: (() => void) | null = null;

  let pendingExplainerResolvers: Array<() => void> = [];

  function ensureKeychainExplained(): Promise<void> {
    if (!isMacPlatform()) return Promise.resolve();
    if (localStorage.getItem(KEYCHAIN_EXPLAINED_KEY) === '1') return Promise.resolve();
    return new Promise<void>((resolve) => {
      pendingExplainerResolvers.push(resolve);
      keychainExplainerOpen.value = true;
    });
  }

  function acknowledgeKeychainExplainer() {
    localStorage.setItem(KEYCHAIN_EXPLAINED_KEY, '1');
    keychainExplainerOpen.value = false;
    const resolvers = pendingExplainerResolvers;
    pendingExplainerResolvers = [];
    for (const r of resolvers) r();
  }

  async function initialize() {
    isLoading.value = true;
    try {
      // Subscribe to auth events first so we don't miss the update fired by getSession.
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

      // listAccounts only reads JSON metadata and does NOT touch safeStorage —
      // safe to call before the explainer.
      await refreshAccounts();

      if (accounts.value.length > 0) {
        await ensureKeychainExplained();
        const existing = await window.auth.getSession();
        if (existing) {
          session.value = existing;
        }
      }
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
    await ensureKeychainExplained();
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
    await ensureKeychainExplained();
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
    keychainExplainerOpen,
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
    acknowledgeKeychainExplainer,
    dispose,
  };
});
