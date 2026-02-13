import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import type { GitBranchInfo, GitLogEntry } from '@/types/window';

export const useGitStore = defineStore('git', () => {
  const projects = useProjectsStore();
  const notifications = useNotificationsStore();

  // State
  const currentBranch = ref('main');
  const branches = ref<GitBranchInfo[]>([]);
  const ahead = ref(0);
  const behind = ref(0);
  const isClean = ref(true);
  const remoteUrl = ref<string | null>(null);
  const isFetching = ref(false);
  const isPulling = ref(false);
  const isPushing = ref(false);
  const isOperationRunning = ref(false);
  const autoSave = ref(loadAutoSave());
  const lastFetchTime = ref<number | null>(null);
  const recentCommits = ref<GitLogEntry[]>([]);
  const hasMergeConflict = ref(false);
  const isOffline = ref(false);

  let fetchIntervalId: ReturnType<typeof setInterval> | null = null;

  // Computed
  const hasRemote = computed(() => remoteUrl.value !== null);
  const isDiverged = computed(() => ahead.value > 0 && behind.value > 0);
  const hasUnsavedChanges = computed(() => ahead.value > 0);
  const canPush = computed(() => ahead.value > 0 && !isDiverged.value && !isPushing.value);
  const canPull = computed(() => behind.value > 0 && ahead.value === 0 && !isPulling.value);

  const versionBranches = computed(() =>
    branches.value
      .filter((b) => /^v\d+$/.test(b.name))
      .sort((a, b) => {
        const numA = parseInt(a.name.slice(1), 10);
        const numB = parseInt(b.name.slice(1), 10);
        return numA - numB;
      }),
  );

  const nextVersionName = computed(() => {
    const existing = versionBranches.value.map((b) => parseInt(b.name.slice(1), 10));
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    return `v${max + 1}`;
  });

  // Helpers
  function getProjectPath(): string | null {
    return projects.currentProject?.path ?? null;
  }

  function loadAutoSave(): boolean {
    try {
      return localStorage.getItem('colrev-auto-save') === 'true';
    } catch {
      return false;
    }
  }

  function setAutoSave(value: boolean) {
    autoSave.value = value;
    try {
      localStorage.setItem('colrev-auto-save', String(value));
    } catch {
      // Ignore storage errors
    }
  }

  // Actions
  async function fetch(): Promise<boolean> {
    const path = getProjectPath();
    if (!path || isFetching.value) return false;

    isFetching.value = true;
    try {
      const result = await window.git.fetch(path);
      if (result.success) {
        lastFetchTime.value = Date.now();
        isOffline.value = false;
        await refreshStatus();
        return true;
      } else {
        // Network error → offline
        if (result.error?.includes('Could not resolve') || result.error?.includes('unable to access')) {
          isOffline.value = true;
        }
        return false;
      }
    } catch {
      isOffline.value = true;
      return false;
    } finally {
      isFetching.value = false;
    }
  }

  async function pull(): Promise<boolean> {
    const path = getProjectPath();
    if (!path || isPulling.value) return false;

    isPulling.value = true;
    try {
      const result = await window.git.pull(path, true);
      if (result.success) {
        await refreshStatus();
        return true;
      } else if (result.error === 'DIVERGED') {
        notifications.error(
          'Cannot sync',
          'Remote has changes that conflict with your local changes. Consider creating a Pull Request.',
        );
        return false;
      } else {
        notifications.error('Pull failed', result.error || 'Unknown error');
        return false;
      }
    } finally {
      isPulling.value = false;
    }
  }

  async function push(): Promise<boolean> {
    const path = getProjectPath();
    if (!path || isPushing.value) return false;

    isPushing.value = true;
    try {
      const result = await window.git.push(path);
      if (result.success) {
        await refreshStatus();
        notifications.success('Changes saved to remote');
        return true;
      } else {
        notifications.error('Push failed', result.error || 'Unknown error');
        return false;
      }
    } finally {
      isPushing.value = false;
    }
  }

  async function refreshStatus(): Promise<void> {
    const path = getProjectPath();
    if (!path) return;

    // Use existing JSON-RPC get_git_status to update ahead/behind/branch
    await projects.refreshGitStatus();

    const gitStatus = projects.currentGitStatus;
    if (gitStatus) {
      currentBranch.value = gitStatus.branch;
      ahead.value = gitStatus.ahead;
      behind.value = gitStatus.behind;
      isClean.value = gitStatus.is_clean;
      remoteUrl.value = gitStatus.remote_url;
    }

    // Check for merge conflicts
    try {
      hasMergeConflict.value = await window.git.hasMergeConflict(path);
    } catch {
      hasMergeConflict.value = false;
    }
  }

  async function refreshBranches(): Promise<void> {
    const path = getProjectPath();
    if (!path) return;

    const result = await window.git.listBranches(path);
    if (result.success) {
      branches.value = result.branches;
      currentBranch.value = result.currentBranch;
    }
  }

  async function switchBranch(branchName: string): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    // Check dirty state
    const dirty = await window.git.dirtyState(path);
    if (dirty.isDirty) {
      notifications.error(
        'Cannot switch branch',
        'There are uncommitted changes. Please commit or discard them first.',
      );
      return false;
    }

    const result = await window.git.checkout(path, branchName);
    if (!result.success) {
      notifications.error('Branch switch failed', result.error || 'Unknown error');
      return false;
    }

    currentBranch.value = branchName;

    // Reload all project data since branch content differs
    if (projects.currentProjectId) {
      await projects.loadProject(projects.currentProjectId);
    }

    await refreshBranches();
    return true;
  }

  async function createVersion(baseBranch?: string): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    const name = nextVersionName.value;
    const base = baseBranch || (versionBranches.value.length > 0 ? currentBranch.value : 'main');

    const result = await window.git.createBranch(path, name, base);
    if (!result.success) {
      notifications.error('Failed to create version', result.error || 'Unknown error');
      return false;
    }

    currentBranch.value = name;

    // Push new branch to remote if available
    if (hasRemote.value) {
      await window.git.push(path);
    }

    // Reload project data + branches
    if (projects.currentProjectId) {
      await projects.loadProject(projects.currentProjectId);
    }
    await refreshBranches();

    notifications.success(`Created ${name}`, `Now working on version ${name}`);
    return true;
  }

  async function mergeIntoMain(sourceBranch: string): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    // Switch to main first
    const checkoutResult = await window.git.checkout(path, 'main');
    if (!checkoutResult.success) {
      notifications.error('Failed to switch to main', checkoutResult.error);
      return false;
    }

    const mergeResult = await window.git.merge(path, sourceBranch, true);
    if (!mergeResult.success) {
      // Switch back to source branch
      await window.git.checkout(path, sourceBranch);
      notifications.error('Merge failed', mergeResult.error || 'Cannot fast-forward merge. Consider creating a Pull Request.');
      return false;
    }

    // Push main
    if (hasRemote.value) {
      await window.git.push(path);
    }

    // Switch back to source branch
    await window.git.checkout(path, sourceBranch);
    await refreshBranches();

    notifications.success('Published to main', `${sourceBranch} has been merged into main`);
    return true;
  }

  async function loadRecentCommits(count = 10): Promise<void> {
    const path = getProjectPath();
    if (!path) return;

    const result = await window.git.log(path, count);
    if (result.success) {
      recentCommits.value = result.commits;
    }
  }

  async function abortMerge(): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    const result = await window.git.abortMerge(path);
    if (result.success) {
      hasMergeConflict.value = false;
      await refreshStatus();
      notifications.success('Merge aborted');
      return true;
    }
    notifications.error('Failed to abort merge', result.error);
    return false;
  }

  /**
   * Auto-sync: if safe to pull (behind > 0, ahead == 0, clean), do it.
   */
  async function autoSyncIfSafe(): Promise<void> {
    if (isOperationRunning.value) return;
    if (behind.value > 0 && ahead.value === 0 && isClean.value) {
      await pull();
    }
  }

  function startBackgroundFetch(interval = 60000): void {
    stopBackgroundFetch();
    fetchIntervalId = setInterval(async () => {
      if (!isOperationRunning.value && hasRemote.value) {
        await fetch();
        await autoSyncIfSafe();
      }
    }, interval);
  }

  function stopBackgroundFetch(): void {
    if (fetchIntervalId !== null) {
      clearInterval(fetchIntervalId);
      fetchIntervalId = null;
    }
  }

  /**
   * Initialize git state for the current project.
   */
  async function initialize(): Promise<void> {
    await refreshStatus();
    if (hasRemote.value) {
      await refreshBranches();
      await fetch();
      startBackgroundFetch();
    }
  }

  function cleanup(): void {
    stopBackgroundFetch();
    branches.value = [];
    recentCommits.value = [];
    ahead.value = 0;
    behind.value = 0;
    isClean.value = true;
    hasMergeConflict.value = false;
    isOffline.value = false;
  }

  return {
    // State
    currentBranch,
    branches,
    ahead,
    behind,
    isClean,
    remoteUrl,
    isFetching,
    isPulling,
    isPushing,
    isOperationRunning,
    autoSave,
    lastFetchTime,
    recentCommits,
    hasMergeConflict,
    isOffline,
    // Computed
    hasRemote,
    isDiverged,
    hasUnsavedChanges,
    canPush,
    canPull,
    versionBranches,
    nextVersionName,
    // Actions
    setAutoSave,
    fetch,
    pull,
    push,
    refreshStatus,
    refreshBranches,
    switchBranch,
    createVersion,
    mergeIntoMain,
    loadRecentCommits,
    abortMerge,
    autoSyncIfSafe,
    startBackgroundFetch,
    stopBackgroundFetch,
    initialize,
    cleanup,
  };
});
