/**
 * The git store against the real `window.git` / `window.gitState` bridge
 * shapes (WP-08 §1).
 *
 * `git.test.ts` covers pure snapshot derivation with no bridge at all. This
 * file covers the parts that used to need Electron: the push subscription the
 * main process drives, and the branch of every sync action that depends on
 * how the main process classified a failure (`OFFLINE`, `DIVERGED`,
 * `DIRTY_WORKTREE`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';
import { useGitStore } from './git';
import { useNotificationsStore } from './notifications';
import { useProjectDataStore } from './projectData';
import { useProjectsStore } from './projects';
import {
  branchDeltaResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_PATH,
  type RendererTestContext,
} from '@/test/harness';
import { makeGitSnapshot } from '@/test/window-mock';

let ctx: RendererTestContext;

beforeEach(() => {
  ctx = setupRendererTest();
  ctx.openProject();
});

describe('snapshot subscription', () => {
  it('subscribes to the main-process snapshot channel on store creation', () => {
    expect(ctx.mock.gitStateSubscriberCount()).toBe(0);
    useGitStore();
    expect(ctx.mock.gitStateSubscriberCount()).toBe(1);
  });

  it('applies a snapshot pushed by main without any renderer-side read', () => {
    const git = useGitStore();
    ctx.mock.rpc.clearCalls();

    ctx.mock.pushGitSnapshot(
      makeGitSnapshot({
        projectId: 'lit-review',
        branch: 'review/screen/t9/bob',
        ahead: 4,
        isClean: false,
      }),
    );

    expect(git.currentBranch).toBe('review/screen/t9/bob');
    expect(git.ahead).toBe(4);
    expect(git.isClean).toBe(false);
    expect(ctx.mock.gitState.refresh).not.toHaveBeenCalled();
    expect(ctx.mock.rpc.calls).toHaveLength(0);
  });
});

describe('refreshStatus', () => {
  it('applies the returned snapshot and clears the error', async () => {
    const git = useGitStore();
    ctx.mock.setGitSnapshot(makeGitSnapshot({ projectId: 'lit-review', branch: 'main' }));

    await expect(git.refreshStatus()).resolves.toBe(true);

    expect(ctx.mock.gitState.refresh).toHaveBeenCalledWith('lit-review', TEST_PROJECT_PATH);
    expect(git.currentBranch).toBe('main');
    expect(git.lastRefreshError).toBeNull();
  });

  it('reports failure without throwing or blanking the previous snapshot', async () => {
    const git = useGitStore();
    ctx.setGitState({ branch: 'dev', ahead: 3 });
    ctx.mock.gitStateRefreshError = 'index.lock held';

    await expect(git.refreshStatus()).resolves.toBe(false);

    expect(git.lastRefreshError).toBe('index.lock held');
    expect(git.currentBranch).toBe('dev');
    expect(git.ahead).toBe(3);
  });

  it('is a no-op with no project open', async () => {
    const git = useGitStore();
    useProjectsStore().currentProjectId = null;
    await expect(git.refreshStatus()).resolves.toBe(false);
    expect(ctx.mock.gitState.refresh).not.toHaveBeenCalled();
  });
});

describe('fetch', () => {
  it('marks the connection online and re-reads the snapshot on success', async () => {
    const git = useGitStore();
    const connection = useConnectionStore();
    connection.markOffline();

    await expect(git.fetch()).resolves.toBe(true);

    expect(connection.isOnline).toBe(true);
    expect(ctx.mock.gitState.refresh).toHaveBeenCalled();
  });

  it('marks the connection offline when main classified the failure as OFFLINE', async () => {
    const git = useGitStore();
    const connection = useConnectionStore();
    ctx.mock.git.fetch.mockResolvedValue({ success: false, error: 'OFFLINE' });

    await expect(git.fetch()).resolves.toBe(false);
    expect(connection.isOnline).toBe(false);
  });
});

describe('pull', () => {
  it('runs a full invalidation on success', async () => {
    const git = useGitStore();
    const seam = useProjectDataStore();
    const guard = seam.snapshot();

    await expect(git.pull()).resolves.toBe(true);

    expect(ctx.mock.git.pull).toHaveBeenCalledWith(TEST_PROJECT_PATH, true);
    // The working tree was replaced: in-flight loads from before must not paint.
    expect(guard.isCurrent()).toBe(false);
  });

  it('opens semantic conflict resolution when the branches diverged', async () => {
    const git = useGitStore();
    ctx.mock.git.pull.mockResolvedValue({ success: false, error: 'DIVERGED' });
    ctx.mock.git.analyzeDivergence.mockResolvedValue({
      success: true,
      analysis: {
        hasConflicts: true,
        autoMergeable: false,
        conflicts: [
          {
            id: 'records:r1',
            file: 'data/records.bib',
            path: 'r1.colrev_status',
            label: 'r1',
            localValue: 'rev_included',
            remoteValue: 'rev_excluded',
          },
        ],
        blockers: [],
      },
    });

    await expect(git.pull()).resolves.toBe(false);

    expect(git.showConflictDialog).toBe(true);
    expect(git.mergeAnalysis?.conflicts).toHaveLength(1);
  });

  it('auto-merges without a dialog when divergence has no conflicts', async () => {
    const git = useGitStore();
    ctx.mock.git.pull.mockResolvedValue({ success: false, error: 'DIVERGED' });

    await git.pull();

    expect(git.showConflictDialog).toBe(false);
    expect(ctx.mock.git.applyMerge).toHaveBeenCalledWith(TEST_PROJECT_PATH, 'lit-review', []);
  });

  it('stops at the blocked dialog rather than a dead-end toast on a dirty tree', async () => {
    const git = useGitStore();
    ctx.mock.git.pull.mockResolvedValue({ success: false, error: 'DIRTY_WORKTREE' });

    await expect(git.pull()).resolves.toBe(false);

    expect(git.showPullBlockedDialog).toBe(true);
  });

  it('reports engine blockers and leaves local state alone', async () => {
    const git = useGitStore();
    ctx.mock.git.pull.mockResolvedValue({ success: false, error: 'DIVERGED' });
    ctx.mock.git.analyzeDivergence.mockResolvedValue({
      success: true,
      analysis: {
        hasConflicts: false,
        autoMergeable: false,
        conflicts: [],
        blockers: [{ reason: 'records.bib has non-status drift' }],
      },
    });

    await git.pull();

    expect(ctx.mock.git.applyMerge).not.toHaveBeenCalled();
    expect(git.showConflictDialog).toBe(false);
  });
});

describe('switchBranch', () => {
  it('surfaces a dirty tree as an explicit save-or-discard decision', async () => {
    const git = useGitStore();
    ctx.setGitState({ branch: 'dev' });
    ctx.mock.git.checkout.mockResolvedValue({
      success: false,
      error: 'DIRTY_WORKTREE',
      dirty: { uncommittedCount: 2, untrackedCount: 1 },
    });

    await expect(git.switchBranch('main')).resolves.toBe(false);

    expect(git.showBranchSwitchBlockedDialog).toBe(true);
    expect(git.blockedSwitchTarget).toBe('main');
    expect(git.blockedSwitchDirty).toEqual({ uncommittedCount: 2, untrackedCount: 1 });
  });

  it('lets a caller with its own recovery UI suppress the dialog', async () => {
    const git = useGitStore();
    ctx.setGitState({ branch: 'dev' });
    ctx.mock.git.checkout.mockResolvedValue({
      success: false,
      error: 'DIRTY_WORKTREE',
      dirty: { uncommittedCount: 1, untrackedCount: 0 },
    });

    await git.switchBranch('main', { promptOnDirty: false });

    expect(git.showBranchSwitchBlockedDialog).toBe(false);
    expect(git.blockedSwitchTarget).toBe('main');
  });

  it('invalidates everything after a successful switch', async () => {
    const git = useGitStore();
    const seam = useProjectDataStore();
    ctx.setGitState({ branch: 'dev' });
    ctx.mock.rpc
      .on('get_status', statusResponse())
      .on('get_settings', settingsResponse())
      .on('list_managed_review_tasks', (p) => tasksResponse(p.kind))
      .on('get_branch_delta', branchDeltaResponse());
    const guard = seam.snapshot();

    await expect(git.switchBranch('main')).resolves.toBe(true);

    expect(ctx.mock.git.checkout).toHaveBeenCalledWith(TEST_PROJECT_PATH, 'main');
    expect(guard.isCurrent()).toBe(false);
  });

  it('short-circuits when already on the target branch', async () => {
    const git = useGitStore();
    ctx.setGitState({ branch: 'dev' });

    await expect(git.switchBranch('dev')).resolves.toBe(true);
    expect(ctx.mock.git.checkout).not.toHaveBeenCalled();
  });
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('push', () => {
  it('pushes, re-reads the snapshot, and reports success', async () => {
    const git = useGitStore();
    const connection = useConnectionStore();
    const success = vi.spyOn(useNotificationsStore(), 'success');
    connection.markOffline();

    await expect(git.push()).resolves.toBe(true);

    expect(ctx.mock.git.push).toHaveBeenCalledWith(TEST_PROJECT_PATH);
    expect(connection.isOnline).toBe(true);
    expect(ctx.mock.gitState.refresh).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith('Changes saved to remote');
  });

  it('offers a working "Pull now" action on a non-fast-forward rejection', async () => {
    const git = useGitStore();
    const error = vi.spyOn(useNotificationsStore(), 'error');
    ctx.mock.git.push.mockResolvedValue({ success: false, error: 'REJECTED_FETCH_FIRST' });

    await expect(git.push()).resolves.toBe(false);

    expect(error).toHaveBeenCalledTimes(1);
    const [title, , action] = error.mock.calls[0];
    expect(title).toBe('Pull first');
    expect(action?.label).toBe('Pull now');

    // The toast action must actually pull, not just say so.
    action!.onClick();
    await flush();
    expect(ctx.mock.git.pull).toHaveBeenCalledWith(TEST_PROJECT_PATH, true);
  });

  it('offers a "Sign in" action on AUTH_FAILED that starts the device flow', async () => {
    const git = useGitStore();
    const error = vi.spyOn(useNotificationsStore(), 'error');
    ctx.mock.git.push.mockResolvedValue({ success: false, error: 'AUTH_FAILED' });

    await expect(git.push()).resolves.toBe(false);

    const [title, , action] = error.mock.calls[0];
    expect(title).toBe('Sign in again');
    expect(action?.label).toBe('Sign in');

    // The remedy dynamically imports the auth store and starts login.
    action!.onClick();
    await vi.waitFor(() => expect(ctx.mock.auth.login).toHaveBeenCalledTimes(1));
    expect(useAuthStore().deviceFlowStatus?.status).toBe('awaiting_code');
  });

  it('flips the connection badge when main classified the failure as OFFLINE', async () => {
    const git = useGitStore();
    const connection = useConnectionStore();
    const error = vi.spyOn(useNotificationsStore(), 'error');
    ctx.mock.git.push.mockResolvedValue({ success: false, error: 'OFFLINE' });

    await expect(git.push()).resolves.toBe(false);

    expect(connection.isOnline).toBe(false);
    expect(error.mock.calls[0][0]).toBe("You're offline");
  });
});

describe('fastForwardMain', () => {
  it('fast-forwards local main without a checkout when on another branch', async () => {
    const git = useGitStore();
    const success = vi.spyOn(useNotificationsStore(), 'success');
    ctx.setGitState({ branch: 'dev' });

    await expect(git.fastForwardMain()).resolves.toBe(true);

    expect(ctx.mock.git.fastForwardMain).toHaveBeenCalledWith(TEST_PROJECT_PATH);
    expect(ctx.mock.git.pull).not.toHaveBeenCalled();
    expect(ctx.mock.gitState.refresh).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(
      'Main updated',
      'Local main is now up to date with the remote.',
    );
  });

  it('delegates to pull when already on main, so the working tree updates too', async () => {
    const git = useGitStore();
    ctx.setGitState({ branch: 'main' });

    await expect(git.fastForwardMain()).resolves.toBe(true);

    expect(ctx.mock.git.pull).toHaveBeenCalledWith(TEST_PROJECT_PATH, true);
    expect(ctx.mock.git.fastForwardMain).not.toHaveBeenCalled();
  });

  it('explains a diverged local main instead of pretending to update it', async () => {
    const git = useGitStore();
    const error = vi.spyOn(useNotificationsStore(), 'error');
    ctx.setGitState({ branch: 'dev' });
    ctx.mock.git.fastForwardMain.mockResolvedValue({ success: false, error: 'DIVERGED' });

    await expect(git.fastForwardMain()).resolves.toBe(false);

    expect(error).toHaveBeenCalledWith(
      'Cannot fast-forward main',
      'Local main has diverged from the remote. Switch to main to resolve.',
    );
  });
});

describe('resetToRemote', () => {
  it('closes the recovery dialogs and invalidates everything on success', async () => {
    const git = useGitStore();
    const success = vi.spyOn(useNotificationsStore(), 'success');
    git.showResetToRemoteDialog = true;
    git.showPullBlockedDialog = true;
    ctx.mock.rpc.on('reset_to_remote', {
      success: true,
      project_id: 'lit-review',
      reset: true,
      discarded_commits: 2,
      message: 'reset',
      target_ref: 'origin/dev',
    });
    const guard = useProjectDataStore().snapshot();

    await expect(git.resetToRemote()).resolves.toBe(true);

    expect(ctx.mock.rpc.callsTo('reset_to_remote')[0].params).toMatchObject({
      project_id: 'lit-review',
      confirm: true,
    });
    expect(git.showResetToRemoteDialog).toBe(false);
    expect(git.showPullBlockedDialog).toBe(false);
    // The tree was hard-reset: in-flight loads from before must not paint.
    expect(guard.isCurrent()).toBe(false);
    expect(success).toHaveBeenCalledWith('Reset to remote', 'Project now matches origin/dev.');
  });

  it('surfaces the failure and keeps the recovery dialog open', async () => {
    const git = useGitStore();
    const error = vi.spyOn(useNotificationsStore(), 'error');
    git.showResetToRemoteDialog = true;
    ctx.mock.rpc.onError('reset_to_remote', { message: 'no upstream configured' });

    await expect(git.resetToRemote()).resolves.toBe(false);

    expect(error).toHaveBeenCalledWith('Reset failed', 'no upstream configured');
    expect(git.showResetToRemoteDialog).toBe(true);
    expect(git.isResettingToRemote).toBe(false);
  });
});

describe('applyMergeResolutions', () => {
  const analysis = {
    hasConflicts: false,
    autoMergeable: true,
    conflicts: [],
    blockers: [],
  };

  it('says the merge landed locally when only the upload failed', async () => {
    const git = useGitStore();
    const info = vi.spyOn(useNotificationsStore(), 'info');
    git.mergeAnalysis = analysis;
    ctx.mock.git.applyMerge.mockResolvedValue({ success: true, pushed: false });

    await expect(git.applyMergeResolutions([])).resolves.toBe(true);

    expect(info).toHaveBeenCalledWith(
      'Merged locally — upload pending',
      'Your changes were combined, but uploading to the remote failed. Use Sync to upload when you are back online.',
    );
    expect(git.showConflictDialog).toBe(false);
    expect(git.mergeAnalysis).toBeNull();
  });

  it('surfaces a failed merge and keeps the resolution state for a retry', async () => {
    const git = useGitStore();
    const error = vi.spyOn(useNotificationsStore(), 'error');
    git.mergeAnalysis = analysis;
    git.showConflictDialog = true;
    ctx.mock.git.applyMerge.mockResolvedValue({ success: false, error: 'engine refused merge' });

    await expect(git.applyMergeResolutions([])).resolves.toBe(false);

    expect(error).toHaveBeenCalledWith('Sync failed', 'engine refused merge');
    expect(git.showConflictDialog).toBe(true);
    expect(git.mergeAnalysis).not.toBeNull();
    expect(git.isResolving).toBe(false);
  });
});

describe('abortMerge', () => {
  it('reports success once main has aborted the merge', async () => {
    const git = useGitStore();
    const success = vi.spyOn(useNotificationsStore(), 'success');

    await expect(git.abortMerge()).resolves.toBe(true);

    expect(ctx.mock.git.abortMerge).toHaveBeenCalledWith(TEST_PROJECT_PATH);
    expect(success).toHaveBeenCalledWith('Merge aborted');
  });

  it('surfaces a failed abort', async () => {
    const git = useGitStore();
    const error = vi.spyOn(useNotificationsStore(), 'error');
    ctx.mock.git.abortMerge.mockResolvedValue({ success: false, error: 'no merge in progress' });

    await expect(git.abortMerge()).resolves.toBe(false);

    expect(error).toHaveBeenCalledWith('Failed to abort merge', 'no merge in progress');
  });
});
