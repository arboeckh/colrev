import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ensureWorkingBranch,
  isReviewerBranch,
  leaveReviewerBranch,
  retireReviewerBranches,
  useManagedTaskAccess,
  WORKING_BRANCH,
} from './useManagedTaskAccess';
import { useAuthStore } from '@/stores/auth';
import { useGitStore } from '@/stores/git';
import type { ManagedReviewReviewer, ManagedReviewTask } from '@/types/generated/rpc';
import type { AuthSession, GitStateSnapshot } from '@/types/window';
import {
  branchDeltaResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_ID,
  TEST_PROJECT_PATH,
  type RendererTestContext,
} from '@/test/harness';
import type { WindowMock } from '@/test/window-mock';

let ctx: RendererTestContext;

function snapshot(branch: string): GitStateSnapshot {
  return {
    projectId: 'lit-review',
    branch,
    ahead: 0,
    behind: 0,
    mainAhead: 0,
    mainBehind: 0,
    isClean: true,
    remoteUrl: 'https://github.com/acme/lit-review.git',
    hasMergeConflict: false,
    uncommittedChanges: 0,
    modifiedFiles: [],
    stagedFiles: [],
    untrackedFiles: [],
    stagedRecordChanges: [],
    lastCommit: null,
    refreshedAt: 1,
  };
}

/** Put the store on `branch` with `dev` present in the branch list. */
function standOn(branch: string, opts: { hasDev?: boolean } = {}) {
  const git = useGitStore();
  git.applySnapshot(snapshot(branch));
  git.branches = opts.hasDev === false ? [] : [{ name: 'dev' } as never];
  return git;
}

describe('reviewer-branch invariant (WP-07 §6)', () => {
  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject({ path: '/projects/lit-review' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognises reviewer branches', () => {
    expect(isReviewerBranch('review/prescreen/t1/alice')).toBe(true);
    expect(isReviewerBranch('dev')).toBe(false);
    expect(isReviewerBranch('reviewers')).toBe(false);
  });

  it('does nothing when already on the working branch', async () => {
    const git = standOn(WORKING_BRANCH);
    const switchBranch = vi.spyOn(git, 'switchBranch');
    expect(await ensureWorkingBranch()).toBe(true);
    expect(switchBranch).not.toHaveBeenCalled();
  });

  it('switches to the working branch from anywhere else', async () => {
    const git = standOn('main');
    const switchBranch = vi.spyOn(git, 'switchBranch').mockResolvedValue(true);
    expect(await ensureWorkingBranch()).toBe(true);
    expect(switchBranch).toHaveBeenCalledWith(WORKING_BRANCH);
  });

  it('creates the working branch and checks it out when the project has never had one', async () => {
    const git = standOn('main', { hasDev: false });
    const ensureDev = vi.spyOn(git, 'ensureDevBranch').mockResolvedValue(true);
    const switchBranch = vi.spyOn(git, 'switchBranch').mockResolvedValue(true);
    expect(await ensureWorkingBranch()).toBe(true);
    expect(ensureDev).toHaveBeenCalled();
    // ensureDevBranch may satisfy hasDevBranch via the remote (collaborator's
    // fresh clone) — the checkout must still happen or the user stays on main.
    expect(switchBranch).toHaveBeenCalledWith(WORKING_BRANCH);
  });

  it('reports failure when the working branch cannot be created', async () => {
    const git = standOn('main', { hasDev: false });
    vi.spyOn(git, 'ensureDevBranch').mockResolvedValue(false);
    const switchBranch = vi.spyOn(git, 'switchBranch');
    expect(await ensureWorkingBranch()).toBe(false);
    expect(switchBranch).not.toHaveBeenCalled();
  });

  it('reports failure when the switch is declined (dirty tree)', async () => {
    const git = standOn('review/prescreen/t1/alice');
    vi.spyOn(git, 'switchBranch').mockResolvedValue(false);
    expect(await leaveReviewerBranch()).toBe(false);
  });

  it('leaves a non-reviewer branch alone', async () => {
    const git = standOn('main');
    const switchBranch = vi.spyOn(git, 'switchBranch');
    expect(await leaveReviewerBranch()).toBe(true);
    expect(switchBranch).not.toHaveBeenCalled();
  });
});

describe('retireReviewerBranches', () => {
  let deleteRemoteBranch: WindowMock['git']['deleteRemoteBranch'];
  let deleteLocalBranch: WindowMock['git']['deleteLocalBranch'];

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject({ path: '/projects/lit-review' });
    deleteRemoteBranch = ctx.mock.git.deleteRemoteBranch;
    deleteLocalBranch = ctx.mock.git.deleteLocalBranch;
  });

  it('deletes both copies of every retired branch', async () => {
    standOn('dev');
    const result = await retireReviewerBranches([
      'review/prescreen/t1/alice',
      'review/prescreen/t1/bob',
    ]);

    expect(result.deleted).toEqual(['review/prescreen/t1/alice', 'review/prescreen/t1/bob']);
    expect(result.failed).toEqual([]);
    expect(deleteRemoteBranch).toHaveBeenCalledTimes(2);
    expect(deleteLocalBranch).toHaveBeenCalledTimes(2);
  });

  it('never deletes the branch currently checked out', async () => {
    standOn('review/prescreen/t1/alice');
    const result = await retireReviewerBranches([
      'review/prescreen/t1/alice',
      'review/prescreen/t1/bob',
    ]);

    expect(result.deleted).toEqual(['review/prescreen/t1/bob']);
    expect(deleteLocalBranch).toHaveBeenCalledTimes(1);
  });

  it('refuses to touch anything that is not a reviewer branch', async () => {
    standOn('dev');
    const result = await retireReviewerBranches(['main', 'dev', 'feature/x']);
    expect(result).toEqual({ deleted: [], failed: [] });
    expect(deleteRemoteBranch).not.toHaveBeenCalled();
    expect(deleteLocalBranch).not.toHaveBeenCalled();
  });

  it('reports the branches it could not delete without failing the rest', async () => {
    standOn('dev');
    deleteRemoteBranch.mockImplementation(async (_p, name) =>
      name.endsWith('bob') ? { success: false, error: 'AUTH_FAILED' } : { success: true },
    );

    const result = await retireReviewerBranches([
      'review/prescreen/t1/alice',
      'review/prescreen/t1/bob',
    ]);
    expect(result.deleted).toEqual(['review/prescreen/t1/alice']);
    expect(result.failed).toEqual(['review/prescreen/t1/bob']);
  });
});

// --- the access gate itself -------------------------------------------------

function reviewer(login: string, branch: string): ManagedReviewReviewer {
  return { github_login: login, branch_name: branch, role: 'reviewer_a' };
}

function activeTask(overrides: Partial<ManagedReviewTask> = {}): ManagedReviewTask {
  return {
    id: 't1',
    base_branch: 'dev',
    base_commit: 'abc1234',
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'alice',
    eligible_state: 'md_processed',
    kind: 'prescreen',
    mode: 'independent',
    record_count: 10,
    record_ids: [],
    reviewer_progress: [],
    reviewers: [
      reviewer('alice', 'review/prescreen/t1/alice'),
      reviewer('bob', 'review/prescreen/t1/bob'),
    ],
    state: 'active',
    ...overrides,
  };
}

function signInAs(login: string): void {
  const session: AuthSession = {
    user: { login, name: null, avatarUrl: `https://avatars.example/${login}`, email: null },
    authenticatedAt: '2026-01-01T00:00:00Z',
  };
  useAuthStore().session = session;
}

describe('useManagedTaskAccess', () => {
  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject();
    ctx.setGitState({ branch: 'dev' });
  });

  /**
   * `get_current_managed_review_task` answers per call from `sequence`,
   * sticking on the last entry — the composable asks once before arranging
   * the branch and once after.
   */
  function stubCurrentTask(sequence: Array<ManagedReviewTask | null>): void {
    let call = 0;
    ctx.mock.rpc.on('get_current_managed_review_task', () => ({
      success: true,
      project_id: TEST_PROJECT_ID,
      kind: 'prescreen' as const,
      current_branch: 'dev',
      task: sequence[Math.min(call++, sequence.length - 1)],
    }));
  }

  /** Everything a successful branch switch reloads. */
  function stubProjectReload(task: ManagedReviewTask | null): void {
    ctx.mock.rpc
      .on('get_status', statusResponse())
      .on('get_settings', settingsResponse())
      .on('list_managed_review_tasks', (p) => tasksResponse(p.kind, task && p.kind === task.kind ? [task] : []))
      .on('get_branch_delta', branchDeltaResponse());
  }

  it('fetches, switches to the reviewer branch, and goes ready for an assigned reviewer', async () => {
    // Login case differs from the manifest's — matching must be case-insensitive.
    signInAs('Alice');
    const task = activeTask();
    stubProjectReload(task);
    stubCurrentTask([null, task]);

    const access = useManagedTaskAccess('prescreen');
    expect(access.accessState.value).toBe('loading');

    await expect(access.ensureAccess()).resolves.toBe(true);

    expect(ctx.mock.git.fetch).toHaveBeenCalled();
    expect(ctx.mock.git.checkout).toHaveBeenCalledWith(
      TEST_PROJECT_PATH,
      'review/prescreen/t1/alice',
    );
    expect(access.accessState.value).toBe('ready');
    expect(access.isManagedAccessBlocked.value).toBe(false);
    expect(access.assignedReviewer.value?.github_login).toBe('alice');
    expect(access.assignedReviewerBranch.value).toBe('review/prescreen/t1/alice');
    expect(access.activeManagedTask.value?.id).toBe('t1');
    expect(access.managedTask.value?.id).toBe('t1');
  });

  it('blocks when the signed-in user is not a listed reviewer', async () => {
    signInAs('carol');
    stubProjectReload(activeTask());
    stubCurrentTask([null]);

    const access = useManagedTaskAccess('prescreen');
    await expect(access.ensureAccess()).resolves.toBe(false);

    expect(access.accessState.value).toBe('blocked');
    expect(access.isManagedAccessBlocked.value).toBe(true);
    expect(access.assignedReviewer.value).toBeNull();
    expect(access.assignedReviewerBranch.value).toBeNull();
    // The task stays visible for the read-only banner...
    expect(access.activeManagedTask.value?.id).toBe('t1');
    // ...but nothing rearranges the user's branch.
    expect(ctx.mock.git.checkout).not.toHaveBeenCalled();
  });

  it('blocks when nobody is signed in and a task is active', async () => {
    stubProjectReload(activeTask());
    stubCurrentTask([null]);

    const access = useManagedTaskAccess('prescreen');
    await expect(access.ensureAccess()).resolves.toBe(false);

    expect(access.accessState.value).toBe('blocked');
    expect(ctx.mock.git.checkout).not.toHaveBeenCalled();
  });

  it('blocks when the reviewer declines the branch switch (dirty tree)', async () => {
    signInAs('alice');
    stubProjectReload(activeTask());
    stubCurrentTask([null]);
    ctx.mock.git.checkout.mockResolvedValue({
      success: false,
      error: 'DIRTY_WORKTREE',
      dirty: { uncommittedCount: 2, untrackedCount: 0 },
    });

    const access = useManagedTaskAccess('prescreen');
    await expect(access.ensureAccess()).resolves.toBe(false);

    expect(access.accessState.value).toBe('blocked');
    expect(access.isManagedAccessBlocked.value).toBe(true);
    // The decline goes through the standard save-or-discard dialog, not a toast.
    expect(useGitStore().showBranchSwitchBlockedDialog).toBe(true);
    expect(access.assignedReviewerBranch.value).toBe('review/prescreen/t1/alice');
  });

  it('goes ready without arranging anything when already on a task branch', async () => {
    signInAs('alice');
    const task = activeTask();
    stubCurrentTask([task]);

    const access = useManagedTaskAccess('prescreen');
    await expect(access.ensureAccess()).resolves.toBe(true);

    expect(access.accessState.value).toBe('ready');
    expect(access.activeManagedTask.value?.id).toBe('t1');
    expect(ctx.mock.rpc.countOf('list_managed_review_tasks')).toBe(0);
    expect(ctx.mock.git.checkout).not.toHaveBeenCalled();
    expect(ctx.mock.git.fetch).not.toHaveBeenCalled();
  });

  it('grants unmanaged access when no task is active', async () => {
    signInAs('alice');
    stubProjectReload(null);
    stubCurrentTask([null]);

    const access = useManagedTaskAccess('prescreen');
    await expect(access.ensureAccess()).resolves.toBe(true);

    expect(access.accessState.value).toBe('ready');
    expect(access.activeManagedTask.value).toBeNull();
    expect(ctx.mock.git.checkout).not.toHaveBeenCalled();
  });

  it('falls back to unmanaged access when managed-review info is unavailable', async () => {
    signInAs('alice');
    stubCurrentTask([null]);
    ctx.mock.rpc.onError('list_managed_review_tasks', { message: 'backend down' });

    const access = useManagedTaskAccess('prescreen');
    await expect(access.ensureAccess()).resolves.toBe(true);

    expect(access.accessState.value).toBe('ready');
    expect(access.isManagedAccessBlocked.value).toBe(false);
  });
});
