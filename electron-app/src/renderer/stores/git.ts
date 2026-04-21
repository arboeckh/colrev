import { defineStore } from 'pinia';
import { ref, computed, toRaw } from 'vue';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import type { GitBranchInfo, GitLogEntry, GitHubRelease, MergeAnalysis, MergeConflictResolution } from '@/types/window';
import type { BranchDelta } from '@/types/project';
import type { GetBranchDeltaResponse } from '@/types/api';
import type { ResetToRemoteResponse } from '@/types/generated/rpc';
import { useBackendStore } from './backend';

// No interval polling. Remote state refreshes on: (a) window focus,
// (b) explicit user action (Refresh / Fetch buttons), (c) after a write
// operation's success hook. See `AppLayout.vue` and `Header.vue`.

export const useGitStore = defineStore('git', () => {
  const projects = useProjectsStore();
  const notifications = useNotificationsStore();

  // State
  const currentBranch = ref('main');
  const branches = ref<GitBranchInfo[]>([]);
  const ahead = ref(0);
  const behind = ref(0);
  // main-vs-origin/main counts — independent of current branch so the
  // "collaborator pushed" banner can appear while on dev.
  const mainAhead = ref(0);
  const mainBehind = ref(0);
  const isClean = ref(true);
  const remoteUrl = ref<string | null>(null);
  const isFetching = ref(false);
  const isPulling = ref(false);
  const isPushing = ref(false);
  const isOperationRunning = ref(false);
  const isSwitchingBranch = ref(false);
  const autoSave = ref(loadAutoSave());
  const lastFetchTime = ref<number | null>(null);
  const recentCommits = ref<GitLogEntry[]>([]);
  const hasMergeConflict = ref(false);
  const isOffline = ref(false);

  // Conflict resolution state
  const isResolving = ref(false);
  const mergeAnalysis = ref<MergeAnalysis | null>(null);
  const showConflictDialog = ref(false);

  // Pull blocked by dirty working tree (uncommitted local changes). When this
  // is true, the UI shows PullBlockedDialog so the user can save-then-pull,
  // discard-then-pull, or reset to remote — without touching the terminal.
  const showPullBlockedDialog = ref(false);

  // Reset-to-remote (nuclear) recovery dialog. Opened from Recover menu or
  // from PullBlockedDialog as a last-resort escape hatch.
  const showResetToRemoteDialog = ref(false);
  const isResettingToRemote = ref(false);

  // New state for dev/release model
  const releases = ref<GitHubRelease[]>([]);
  const isLoadingReleases = ref(false);
  const releasesLoaded = ref(false);
  const devAheadOfMain = ref(0);
  const mainAheadOfDev = ref(0);

  // Branch delta (record-level diff between dev and main)
  const branchDelta = ref<BranchDelta | null>(null);
  const isLoadingDelta = ref(false);
  // Per-state record counts on dev (mirrored from branch delta's source).
  // Set whenever we have visibility into dev's state — i.e. when on dev itself
  // or on a review/* branch. Used by the sidebar to render dev's badges even
  // when the user is checked out on a temporary reviewer branch.
  const devRecordCounts = ref<Record<string, number> | null>(null);

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

  // Actions — serialization against concurrent git ops is handled by the
  // main-process git mutex (see `electron-app/src/main/gitMutex.ts`).
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
        await refreshMergeConflictState();
        await projects.refreshCurrentProject();
        window.location.reload();
        return true;
      } else if (result.error === 'DIVERGED') {
        // Trigger semantic conflict resolution instead of dead-end message
        await startDivergenceResolution();
        return false;
      } else if (result.error === 'DIRTY_WORKTREE') {
        // Local changes block the merge. Offer recovery options in a dialog
        // instead of a dead-end toast — the user never needs the terminal.
        showPullBlockedDialog.value = true;
        return false;
      } else {
        notifications.error('Pull failed', result.error || 'Unknown error');
        return false;
      }
    } finally {
      isPulling.value = false;
    }
  }

  /**
   * Last-resort recovery: hard-reset the current branch to its remote
   * tracking branch. Wipes uncommitted local changes AND unpushed commits.
   * Callers must have confirmed with the user before invoking this.
   */
  async function resetToRemote(): Promise<boolean> {
    if (!projects.currentProjectId || isResettingToRemote.value) return false;
    const backend = useBackendStore();

    isResettingToRemote.value = true;
    try {
      const response = await backend.call<ResetToRemoteResponse>('reset_to_remote', {
        project_id: projects.currentProjectId,
        confirm: true,
      });
      notifications.success(
        'Reset to remote',
        `Project now matches ${response.target_ref}.`,
      );
      showResetToRemoteDialog.value = false;
      showPullBlockedDialog.value = false;
      await refreshStatus();
      await refreshMergeConflictState();
      // Reload so any in-memory record / settings state matches the new tree.
      window.location.reload();
      return true;
    } catch (err) {
      notifications.error(
        'Reset failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    } finally {
      isResettingToRemote.value = false;
    }
  }

  /**
   * Fast-forward local ``main`` to ``origin/main`` without requiring a checkout.
   * Used by the "collaborator pushed" banner when the user is off-main (e.g.
   * on ``dev``). If on main, reuses the normal pull path so the working tree
   * updates too.
   */
  async function fastForwardMain(): Promise<boolean> {
    const path = getProjectPath();
    if (!path || isPulling.value) return false;

    if (isOnMain.value) {
      return pull();
    }

    isPulling.value = true;
    try {
      const result = await window.git.fastForwardMain(path);
      if (result.success) {
        await refreshStatus();
        await refreshBranchDiff();
        notifications.success('Main updated', 'Local main is now up to date with the remote.');
        return true;
      } else if (result.error === 'DIVERGED') {
        notifications.error(
          'Cannot fast-forward main',
          'Local main has diverged from the remote. Switch to main to resolve.',
        );
        return false;
      } else {
        notifications.error('Update failed', result.error || 'Unknown error');
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

    // Pure read — mutex-bypassing on the main side. No auto-commit, no
    // hasMergeConflict roundtrip. Callers that mutate repo state call
    // refreshMergeConflictState() explicitly.
    await projects.refreshGitStatus();

    const status = projects.currentGitStatus;
    if (status) {
      currentBranch.value = status.branch;
      ahead.value = status.ahead;
      behind.value = status.behind;
      mainAhead.value = status.main_ahead ?? 0;
      mainBehind.value = status.main_behind ?? 0;
      isClean.value = status.is_clean;
      remoteUrl.value = status.remote_url;
    }
  }

  async function refreshMergeConflictState(): Promise<void> {
    const path = getProjectPath();
    if (!path) return;
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
    // Skip if already on the target branch
    if (currentBranch.value === branchName) return true;

    isSwitchingBranch.value = true;
    try {
      await refreshStatus();

      const result = await window.git.checkout(path, branchName);
      if (!result.success) {
        notifications.error('Branch switch failed', result.error || 'Unknown error');
        return false;
      }

      if (result.recovered) {
        notifications.info(
          'Switched with auto-recovery',
          result.recoveryMessage ?? 'Local changes were stashed so the switch could complete.',
        );
      }

      currentBranch.value = branchName;

      // Reload all project data since branch content differs
      if (projects.currentProjectId) {
        await projects.loadProject(projects.currentProjectId);
      }

      await refreshBranches();
      refreshBranchDelta(); // Fire and forget
      return true;
    } finally {
      isSwitchingBranch.value = false;
    }
  }

  /**
   * Ensure the dev branch exists. Creates from main if it doesn't, pushes to remote.
   */
  async function ensureDevBranch(): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    // Refresh branch list to avoid stale state (e.g. after project switch)
    if (!hasDevBranch.value) {
      await refreshBranches();
    }
    if (hasDevBranch.value) return true;

    const result = await window.git.createBranch(path, 'dev', 'main');
    if (!result.success) {
      // Branch may already exist on disk even if not in our list
      if (result.error?.includes('already exists')) {
        await refreshBranches();
        return true;
      }
      notifications.error('Failed to create dev branch', result.error || 'Unknown error');
      return false;
    }

    currentBranch.value = 'dev';

    // Push new branch to remote if available
    if (hasRemote.value) {
      await window.git.push(path);
    }

    await refreshBranches();
    // Silent — dev branch creation is automatic and transparent to user
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

    notifications.success('Version published', 'Your changes have been published as a stable version.');
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
   * Refresh the record-level delta between dev and main.
   *
   * The reviewer branch is temporary — its working-tree counts diverge from
   * dev as the user screens records. For sidebar progress we always want
   * dev's view, so when checked out on a review/* branch we explicitly ask
   * the backend to read records from dev's tree (no checkout needed).
   */
  async function refreshBranchDelta(): Promise<void> {
    if (!projects.currentProjectId) {
      branchDelta.value = null;
      devRecordCounts.value = null;
      return;
    }

    const branch = currentBranch.value;
    let sourceBranch: string | undefined;
    if (branch === 'dev') {
      sourceBranch = undefined; // backend defaults to active branch
    } else if (branch.startsWith('review/')) {
      sourceBranch = 'dev';
    } else {
      // main or any other branch — nothing meaningful to show
      branchDelta.value = null;
      devRecordCounts.value = null;
      return;
    }

    const backend = useBackendStore();
    isLoadingDelta.value = true;
    try {
      const response = await backend.call<GetBranchDeltaResponse>('get_branch_delta', {
        project_id: projects.currentProjectId,
        ...(sourceBranch ? { source_branch: sourceBranch } : {}),
      });
      if (response.success) {
        branchDelta.value = response;
        devRecordCounts.value = response.source_branch_counts ?? null;
      }
    } catch {
      branchDelta.value = null;
      devRecordCounts.value = null;
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

  /**
   * Analyze divergence and either auto-merge or show conflict resolution dialog.
   */
  async function startDivergenceResolution(): Promise<void> {
    const path = getProjectPath();
    if (!path || isResolving.value) return;

    isResolving.value = true;
    try {
      const result = await window.git.analyzeDivergence(path);
      if (!result.success || !result.analysis) {
        notifications.error('Sync failed', result.error || 'Could not analyze changes. Please try again.');
        return;
      }

      mergeAnalysis.value = result.analysis;

      if (!result.analysis.hasConflicts) {
        // No conflicts — auto-merge silently
        await applyMergeResolutions([]);
      } else {
        // Has conflicts — show dialog
        showConflictDialog.value = true;
      }
    } catch {
      notifications.error('Sync failed', 'An unexpected error occurred.');
    } finally {
      if (!showConflictDialog.value) {
        isResolving.value = false;
      }
    }
  }

  /**
   * Apply user's conflict resolutions and complete the merge.
   */
  async function applyMergeResolutions(resolutions: MergeConflictResolution[]): Promise<boolean> {
    const path = getProjectPath();
    if (!path || !mergeAnalysis.value) {
      console.error('[git] applyMergeResolutions: no path or analysis', { path, hasAnalysis: !!mergeAnalysis.value });
      return false;
    }

    isResolving.value = true;
    try {
      // Deep-clone to strip Vue reactive proxies — IPC requires plain objects
      const rawAnalysis = JSON.parse(JSON.stringify(toRaw(mergeAnalysis.value)));
      console.log('[git] Calling applyMerge with', resolutions.length, 'resolutions');
      const result = await window.git.applyMerge(path, resolutions, rawAnalysis);
      console.log('[git] applyMerge result:', result);
      if (result.success) {
        const msg = result.pushFailed
          ? 'Changes merged locally. Push will retry on next sync.'
          : 'Your changes and your collaborator\'s changes have been combined.';
        notifications.success('Synced successfully', msg);
        showConflictDialog.value = false;
        mergeAnalysis.value = null;
        await refreshStatus();
        await refreshMergeConflictState();
        // Reload project to pick up merged settings
        if (projects.currentProjectId) {
          await projects.loadProject(projects.currentProjectId);
        }
        return true;
      } else {
        notifications.error('Sync failed', result.error || 'Could not apply changes.');
        return false;
      }
    } finally {
      isResolving.value = false;
    }
  }

  /**
   * Cancel conflict resolution — preserve local state.
   */
  function cancelMerge(): void {
    showConflictDialog.value = false;
    mergeAnalysis.value = null;
    isResolving.value = false;
    notifications.info(
      'Sync canceled',
      'Your local changes are preserved. You can resolve this later.',
    );
  }

  async function abortMerge(): Promise<boolean> {
    const path = getProjectPath();
    if (!path) return false;

    const result = await window.git.abortMerge(path);
    if (result.success) {
      hasMergeConflict.value = false;
      await refreshStatus();
      await refreshMergeConflictState();
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

  /**
   * Initialize git state for the current project.
   *
   * Performs a one-shot sync. After this, freshness is driven by window-focus
   * refresh, explicit user actions (Refresh / Fetch buttons), and post-write
   * hooks — no intervals.
   */
  async function initialize(): Promise<void> {
    await refreshStatus();
    await refreshMergeConflictState();
    await refreshBranches();
    await refreshBranchDiff();
    refreshBranchDelta(); // Fire and forget
    if (hasRemote.value) {
      await fetch();
      if (isGitHubRemote.value) {
        loadReleases(); // Fire and forget
      }
    }
  }

  function cleanup(): void {
    branches.value = [];
    recentCommits.value = [];
    releases.value = [];
    releasesLoaded.value = false;
    ahead.value = 0;
    behind.value = 0;
    mainAhead.value = 0;
    mainBehind.value = 0;
    isClean.value = true;
    hasMergeConflict.value = false;
    isOffline.value = false;
    isResolving.value = false;
    mergeAnalysis.value = null;
    showConflictDialog.value = false;
    showPullBlockedDialog.value = false;
    showResetToRemoteDialog.value = false;
    isResettingToRemote.value = false;
    devAheadOfMain.value = 0;
    mainAheadOfDev.value = 0;
    branchDelta.value = null;
    devRecordCounts.value = null;
  }

  return {
    // State
    currentBranch,
    branches,
    ahead,
    behind,
    mainAhead,
    mainBehind,
    isClean,
    remoteUrl,
    isFetching,
    isPulling,
    isPushing,
    isOperationRunning,
    isSwitchingBranch,
    autoSave,
    lastFetchTime,
    recentCommits,
    hasMergeConflict,
    isOffline,
    isResolving,
    mergeAnalysis,
    showConflictDialog,
    showPullBlockedDialog,
    showResetToRemoteDialog,
    isResettingToRemote,
    releases,
    isLoadingReleases,
    releasesLoaded,
    devAheadOfMain,
    mainAheadOfDev,
    branchDelta,
    isLoadingDelta,
    devRecordCounts,
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
    fastForwardMain,
    push,
    refreshStatus,
    refreshMergeConflictState,
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
    startDivergenceResolution,
    applyMergeResolutions,
    cancelMerge,
    autoSyncIfSafe,
    initialize,
    cleanup,
    resetToRemote,
  };
});
