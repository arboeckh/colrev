import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useConnectionStore } from './connection';
import type { AuthSession, DeviceFlowStatus, AccountInfo } from '@/types/window';

const KEYCHAIN_EXPLAINED_KEY = 'colrev:keychain-explained';

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
}

export const useAuthStore = defineStore('auth', () => {
  const connection = useConnectionStore();
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
        // Render immediately from the on-disk cached profile. No keychain access
        // and no network: works offline, doesn't block boot.
        const cached = await window.auth.getCachedSession();
        if (cached) {
          session.value = cached;
        }
      }
    } catch (err) {
      console.error('Failed to initialize auth:', err);
    } finally {
      // UI / router unblocked here — everything below runs in the background.
      isLoading.value = false;
    }

    // Background validation: refreshes the cached profile and removes the
    // account if GitHub explicitly rejects the token. Only runs when we have
    // a stored account and after the user has acknowledged the macOS keychain
    // explainer (since it triggers a safeStorage decrypt).
    if (accounts.value.length > 0) {
      void validateSessionInBackground();
    }
  }

  // Revalidate the session whenever the renderer comes back online, so a
  // token that was revoked while the user was offline gets cleared promptly.
  connection.onReconnect(() => {
    if (accounts.value.length > 0) {
      void validateSessionInBackground();
    }
  });

  async function validateSessionInBackground() {
    try {
      await ensureKeychainExplained();
      const validated = await window.auth.getSession();
      // null means the active account was removed (auth error); the
      // onAuthUpdate subscriber already nulled out session.value.
      if (validated) {
        session.value = validated;
      }
    } catch (err) {
      // Network failure or other transient error — keep the cached session.
      console.warn('Background session validation failed:', err);
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
