import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  ensureWorkingBranch,
  isReviewerBranch,
  leaveReviewerBranch,
  retireReviewerBranches,
  WORKING_BRANCH,
} from './useManagedTaskAccess';
import { useGitStore } from '@/stores/git';
import { useProjectsStore } from '@/stores/projects';
import type { GitStateSnapshot } from '@/types/window';

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
    setActivePinia(createPinia());
    const projects = useProjectsStore();
    projects.currentProjectId = 'lit-review';
    projects.currentProject = {
      id: 'lit-review',
      path: '/projects/lit-review',
      status: null,
      settings: null,
    };
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

  it('creates the working branch when the project has never had one', async () => {
    const git = standOn('main', { hasDev: false });
    const ensureDev = vi.spyOn(git, 'ensureDevBranch').mockResolvedValue(true);
    const switchBranch = vi.spyOn(git, 'switchBranch');
    expect(await ensureWorkingBranch()).toBe(true);
    expect(ensureDev).toHaveBeenCalled();
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
  let deleteRemoteBranch: ReturnType<typeof vi.fn>;
  let deleteLocalBranch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    const projects = useProjectsStore();
    projects.currentProjectId = 'lit-review';
    projects.currentProject = {
      id: 'lit-review',
      path: '/projects/lit-review',
      status: null,
      settings: null,
    };

    deleteRemoteBranch = vi.fn(async () => ({ success: true }));
    deleteLocalBranch = vi.fn(async () => ({ success: true }));
    // Minimal preload bridge: the git store also registers online/offline
    // listeners when it is created.
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      git: { deleteRemoteBranch, deleteLocalBranch, listBranches: async () => ({ success: false }) },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
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
    deleteRemoteBranch.mockImplementation(async (_p: string, name: string) =>
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
