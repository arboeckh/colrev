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
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectionStore } from './connection';
import { useGitStore } from './git';
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
