import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import type { GitBranchInfo, GitLogEntry, GitHubRelease } from '@/types/window';
import type { BranchDelta } from '@/types/project';
import type { GetBranchDeltaResponse } from '@/types/api';
import { useBackendStore } from './backend';

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

  // New state for dev/release model
  const releases = ref<GitHubRelease[]>([]);
  const isLoadingReleases = ref(false);
  const releasesLoaded = ref(false);
  const devAheadOfMain = ref(0);
  const mainAheadOfDev = ref(0);

  // Branch delta (record-level diff between dev and main)
  const branchDelta = ref<BranchDelta | null>(null);
  const isLoadingDelta = ref(false);

  let fetchIntervalId: ReturnType<typeof setInterval> | null = null;

  // Computed
  const hasRemote = computed(() => remoteUrl.value !== null);
  const isGitHubRemote = computed(() => remoteUrl.value?.includes('github.com') ?? false);
  const isDiverged = computed(() => ahead.value > 0 && behind.value > 0);
  const hasUnsavedChanges = computed(() => ahead.value > 0);
  const canPush = computed(() => ahead.value > 0 && !isDiverged.value && !isPushing.value);
  const canPull = computed(() => behind.value > 0 && ahead.value === 0 && !isPulling.value);

  const hasDevBranch = computed(() => branches.value.some((b) => b.name === 'dev'));
  const isOnMain = computed(() => currentBranch.value === 'main');
  const isOnDev = computed(() => currentBranch.value === 'dev');

  const latestRelease = computed(() => releases.value.length > 0 ? releases.value[0] : null);

  function nextReleaseVersion(bump: 'minor' | 'major' = 'minor'): string {
    const latest = latestRelease.value;
    if (!latest) return 'v1.0';

    const match = latest.tagName.match(/^v?(\d+)\.(\d+)/);
    if (!match) return 'v1.0';

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);

    if (bump === 'major') return `v${major + 1}.0`;
    return `v${major}.${minor + 1}`;
  }

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
        // Network error -> offline
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
    refreshBranchDelta(); // Fire and forget
    return true;
  }

  /**
   * Ensure the dev branch exists. Creates from main if it doesn't, pushes to remote.
   */
  async function ensureDevBranch(): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    if (hasDevBranch.value) return true;

    const result = await window.git.createBranch(path, 'dev', 'main');
    if (!result.success) {
      notifications.error('Failed to create dev branch', result.error || 'Unknown error');
      return false;
    }

    currentBranch.value = 'dev';

    // Push new branch to remote if available
    if (hasRemote.value) {
      await window.git.push(path);
    }

    await refreshBranches();
    notifications.success('Created dev branch', 'Development branch created from main');
    return true;
  }

  /**
   * Merge dev into main: checkout main -> merge dev --ff-only -> push -> stay on main.
   */
  async function mergeDevIntoMain(): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    // Switch to main first
    const checkoutResult = await window.git.checkout(path, 'main');
    if (!checkoutResult.success) {
      notifications.error('Failed to switch to main', checkoutResult.error);
      return false;
    }

    const mergeResult = await window.git.merge(path, 'dev', true);
    if (!mergeResult.success) {
      // Switch back to where we were
      await window.git.checkout(path, 'dev');
      notifications.error(
        'Merge failed',
        mergeResult.error || 'Cannot fast-forward merge. Try rebasing dev onto main first.',
      );
      return false;
    }

    // Push main
    if (hasRemote.value) {
      await window.git.push(path);
    }

    currentBranch.value = 'main';

    // Reload project data + branches
    if (projects.currentProjectId) {
      await projects.loadProject(projects.currentProjectId);
    }
    await refreshBranches();
    await refreshBranchDiff();

    notifications.success('Merged into main', 'dev has been merged into main');
    return true;
  }

  /**
   * Refresh the commit difference between dev and main.
   */
  async function refreshBranchDiff(): Promise<void> {
    const path = getProjectPath();
    if (!path || !hasDevBranch.value) {
      devAheadOfMain.value = 0;
      mainAheadOfDev.value = 0;
      return;
    }

    try {
      const [devAhead, mainAhead] = await Promise.all([
        window.git.revListCount(path, 'main', 'dev'),
        window.git.revListCount(path, 'dev', 'main'),
      ]);
      devAheadOfMain.value = devAhead.success ? devAhead.count : 0;
      mainAheadOfDev.value = mainAhead.success ? mainAhead.count : 0;
    } catch {
      devAheadOfMain.value = 0;
      mainAheadOfDev.value = 0;
    }
  }

  /**
   * Refresh the record-level delta between current branch and main.
   */
  async function refreshBranchDelta(): Promise<void> {
    if (!isOnDev.value || !projects.currentProjectId) {
      branchDelta.value = null;
      return;
    }

    const backend = useBackendStore();
    isLoadingDelta.value = true;
    try {
      const response = await backend.call<GetBranchDeltaResponse>('get_branch_delta', {
        project_id: projects.currentProjectId,
      });
      if (response.success) {
        branchDelta.value = response;
      }
    } catch {
      branchDelta.value = null;
    } finally {
      isLoadingDelta.value = false;
    }
  }

  /**
   * Load GitHub releases for the current project.
   */
  async function loadReleases(): Promise<void> {
    const remote = remoteUrl.value || projects.currentGitStatus?.remote_url || null;
    if (!remote || !remote.includes('github.com')) {
      releases.value = [];
      return;
    }

    isLoadingReleases.value = true;
    try {
      const result = await window.github.listReleases({ remoteUrl: remote });
      if (result.success) {
        releases.value = result.releases;
      }
    } catch {
      // Silently fail — releases are non-critical
    } finally {
      isLoadingReleases.value = false;
      releasesLoaded.value = true;
    }
  }

  /**
   * Create a GitHub release (tag + push + release).
   */
  async function createRelease(params: { tagName: string; name: string; body: string }): Promise<boolean> {
    const path = getProjectPath();
    if (!path) {
      notifications.error('Release failed', 'No project selected');
      return false;
    }
    const remote = remoteUrl.value || projects.currentGitStatus?.remote_url || null;
    if (!remote) {
      notifications.error('Release failed', 'No remote repository configured. Push to GitHub first.');
      return false;
    }

    try {
      const result = await window.github.createRelease({
        remoteUrl: remote,
        tagName: params.tagName,
        name: params.name,
        body: params.body,
        projectPath: path,
      });

      if (result.success) {
        // Optimistically prepend the new release so it appears instantly
        if (result.release) {
          releases.value = [result.release, ...releases.value];
        } else {
          // Fallback: reload from GitHub if response didn't include release data
          await loadReleases();
        }
        notifications.success('Release created', `${params.tagName} published on GitHub`);
        return true;
      } else {
        notifications.error('Release failed', result.error || 'Unknown error');
        return false;
      }
    } catch (err) {
      notifications.error('Release failed', err instanceof Error ? err.message : 'Unexpected error');
      return false;
    }
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
    await refreshBranches();
    await refreshBranchDiff();
    refreshBranchDelta(); // Fire and forget
    if (hasRemote.value) {
      await fetch();
      if (isGitHubRemote.value) {
        loadReleases(); // Fire and forget
      }
      startBackgroundFetch();
    }
  }

  function cleanup(): void {
    stopBackgroundFetch();
    branches.value = [];
    recentCommits.value = [];
    releases.value = [];
    releasesLoaded.value = false;
    ahead.value = 0;
    behind.value = 0;
    isClean.value = true;
    hasMergeConflict.value = false;
    isOffline.value = false;
    devAheadOfMain.value = 0;
    mainAheadOfDev.value = 0;
    branchDelta.value = null;
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
    releases,
    isLoadingReleases,
    releasesLoaded,
    devAheadOfMain,
    mainAheadOfDev,
    branchDelta,
    isLoadingDelta,
    // Computed
    hasRemote,
    isGitHubRemote,
    isDiverged,
    hasUnsavedChanges,
    canPush,
    canPull,
    hasDevBranch,
    isOnMain,
    isOnDev,
    latestRelease,
    // Actions
    nextReleaseVersion,
    setAutoSave,
    fetch,
    pull,
    push,
    refreshStatus,
    refreshBranches,
    switchBranch,
    ensureDevBranch,
    mergeDevIntoMain,
    refreshBranchDiff,
    refreshBranchDelta,
    loadReleases,
    createRelease,
    loadRecentCommits,
    abortMerge,
    autoSyncIfSafe,
    startBackgroundFetch,
    stopBackgroundFetch,
    initialize,
    cleanup,
  };
});
