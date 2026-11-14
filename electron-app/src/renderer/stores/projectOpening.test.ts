/**
 * Opening a project must always end somewhere: loaded, or an error with a way
 * out. And what the open project's stores show must be that project's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  branchDeltaResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { useBackendStore } from './backend';
import { useGitStore } from './git';
import { useManagedReviewStore } from './managedReview';
import { useProjectDataStore } from './projectData';
import { useProjectsStore } from './projects';

let ctx: RendererTestContext;

function stubReads(): void {
  ctx.mock.rpc
    .on('get_status', statusResponse())
    .on('get_settings', settingsResponse())
    .on('get_branch_delta', branchDeltaResponse())
    .on('list_managed_review_tasks', (p) => tasksResponse(p.kind));
}

beforeEach(() => {
  ctx = setupRendererTest();
  useBackendStore().status = 'running';
  stubReads();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadProject failure', () => {
  it('does not pair the new id with the previous project', async () => {
    const projects = useProjectsStore();
    ctx.openProject({ projectId: 'a' });
    ctx.mock.rpc.on('get_status', () => {
      throw new Error('backend crashed');
    });

    const ok = await projects.loadProject('b');

    expect(ok).toBe(false);
    expect(projects.currentProjectId).toBe('b');
    expect(projects.currentProject).toBeNull();
    expect(projects.projectError).toBeTruthy();
    expect(projects.isLoadingProject).toBe(false);
  });

  it('shows the spinner again when retried, and recovers', async () => {
    const projects = useProjectsStore();
    ctx.mock.rpc.on('get_status', () => {
      throw new Error('backend crashed');
    });
    expect(await projects.loadProject(TEST_PROJECT_ID)).toBe(false);

    ctx.mock.rpc.on('get_status', statusResponse());
    const retry = projects.loadProject(TEST_PROJECT_ID);
    expect(projects.isLoadingProject).toBe(true);
    expect(projects.projectError).toBeNull();
    expect(await retry).toBe(true);
    expect(projects.currentProject?.id).toBe(TEST_PROJECT_ID);
    expect(projects.isLoadingProject).toBe(false);
  });
});

describe('a load overtaken by a full invalidation', () => {
  it('settles instead of leaving the spinner on', async () => {
    const projects = useProjectsStore();
    const seam = useProjectDataStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    ctx.mock.rpc.on('get_status', async () => {
      calls += 1;
      // Only the first read is held up; the pull finishes meanwhile.
      if (calls === 1) await gate;
      return statusResponse();
    });

    const load = projects.loadProject(TEST_PROJECT_ID);
    await nextTick();
    seam.bumpEpoch(); // another flow's invalidateAll
    release();

    expect(await load).toBe(true);
    expect(projects.isLoadingProject).toBe(false);
    expect(projects.currentProject?.id).toBe(TEST_PROJECT_ID);
  });

  it('leaves the spinner to the newer load when one superseded it', async () => {
    const projects = useProjectsStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    ctx.mock.rpc.on('get_status', async () => {
      calls += 1;
      if (calls === 1) await gate;
      return statusResponse();
    });

    const first = projects.loadProject('a');
    await nextTick();
    const second = projects.loadProject('b');
    release();

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(projects.currentProjectId).toBe('b');
    expect(projects.isLoadingProject).toBe(false);
  });

  it('clears the spinner when the review was left meanwhile', async () => {
    const projects = useProjectsStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    ctx.mock.rpc.on('get_status', async () => {
      await gate;
      return statusResponse();
    });

    const load = projects.loadProject(TEST_PROJECT_ID);
    await nextTick();
    projects.clearCurrentProject();
    release();

    expect(await load).toBe(false);
    expect(projects.isLoadingProject).toBe(false);
  });
});

describe('Publish and Releases follow the repository', () => {
  beforeEach(() => {
    ctx.openProject();
    ctx.setGitState({ branch: 'dev', remoteUrl: null, lastCommit: null });
    useGitStore().branches = [{ name: 'main' }, { name: 'dev' }] as never;
  });

  it('refreshes unpublished changes when a commit lands in the session', async () => {
    const git = useGitStore();
    await git.refreshBranchDiff();
    expect(git.devAheadOfMain).toBe(0);

    ctx.mock.git.revListCount.mockImplementation(async (_p, from) => ({
      success: true,
      count: from === 'main' ? 2 : 0,
    }));
    // A commit moves dev's tip; the main process pushes the new snapshot.
    ctx.mock.pushGitSnapshot(
      ctx.setGitState({
        branch: 'dev',
        remoteUrl: null,
        lastCommit: {
          hash: 'abc',
          shortHash: 'abc',
          message: 'Save',
          author: 'a',
          timestamp: 't',
        },
      }),
    );
    await vi.waitFor(() => expect(git.devAheadOfMain).toBe(2));
  });

  it('loads releases when a remote appears after the review was opened', async () => {
    const git = useGitStore();
    await git.initialize(); // no remote: releases are not loaded
    expect(git.releasesLoaded).toBe(false);
    ctx.mock.github.listReleases.mockResolvedValue({
      success: true,
      releases: [{ tagName: 'v1.0' }] as never,
    });

    ctx.mock.pushGitSnapshot(
      ctx.setGitState({ branch: 'dev', remoteUrl: 'https://github.com/acme/x.git' }),
    );

    await vi.waitFor(() => expect(git.releasesLoaded).toBe(true));
    expect(ctx.mock.github.listReleases).toHaveBeenCalled();
    expect(git.releases).toHaveLength(1);
  });

  it('stops the Releases spinner once a release is created', async () => {
    ctx.setGitState({ branch: 'dev', remoteUrl: 'https://github.com/acme/x.git' });
    const git = useGitStore();
    await vi.waitFor(() => expect(git.releasesLoaded).toBe(true));
    // Back to the state of a panel whose list was never loaded.
    git.releasesLoaded = false;
    git.releases = [];
    ctx.mock.github.createRelease.mockResolvedValue({
      success: true,
      release: { tagName: 'v1.0', name: 'v1.0' } as never,
    });

    await git.createRelease({ tagName: 'v1.0', name: 'v1.0', body: '' });

    expect(git.releasesLoaded).toBe(true);
    expect(git.releases).toHaveLength(1);
  });
});

describe('responses for a review that is no longer open', () => {
  it('does not write one review’s branch delta into the next', async () => {
    ctx.openProject({ projectId: 'a' });
    ctx.setGitState({ branch: 'dev' });
    const git = useGitStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    ctx.mock.rpc.on('get_branch_delta', async () => {
      await gate;
      return branchDeltaResponse();
    });

    const pending = git.refreshBranchDelta();
    useProjectsStore().currentProjectId = 'b';
    release();
    await pending;

    expect(git.branchDelta).toBeNull();
  });

  it('does not write one review’s branches into the next', async () => {
    ctx.openProject({ projectId: 'a' });
    const git = useGitStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    ctx.mock.git.listBranches.mockImplementation(async () => {
      await gate;
      return { success: true, branches: [{ name: 'dev' }] as never, currentBranch: 'dev' };
    });

    const pending = git.refreshBranches();
    useProjectsStore().currentProjectId = 'b';
    release();
    await pending;

    expect(git.branches).toEqual([]);
  });

  it('drops another review’s tasks when this review’s refresh fails', async () => {
    ctx.openProject({ projectId: 'a' });
    const managed = useManagedReviewStore();
    await managed.refresh();
    managed.prescreenTasks = [{ id: 't1', state: 'active' } as never];
    managed.screenTasks = [];

    const projects = useProjectsStore();
    projects.currentProjectId = 'b';
    ctx.mock.rpc.on('list_managed_review_tasks', () => {
      throw new Error('boom');
    });
    // Tasks read for `a`: not b's "last known".
    await managed.refresh();

    expect(managed.lastRefreshError).toBeTruthy();
    expect(managed.prescreenTasks).toEqual([]);
  });

  it('keeps the same review’s last-known tasks when its refresh fails', async () => {
    ctx.openProject({ projectId: 'a' });
    ctx.mock.rpc.on('list_managed_review_tasks', (p) =>
      tasksResponse(p.kind, [{ id: 't1', state: 'active' } as never]),
    );
    const managed = useManagedReviewStore();
    await managed.refresh();
    expect(managed.prescreenTasks).toHaveLength(1);

    ctx.mock.rpc.on('list_managed_review_tasks', () => {
      throw new Error('boom');
    });
    await managed.refresh();

    expect(managed.lastRefreshError).toBeTruthy();
    expect(managed.prescreenTasks).toHaveLength(1);
  });
});

describe('deleting a project', () => {
  it('forgets its git snapshot in the renderer and the main process', async () => {
    ctx.openProject({ projectId: 'gone' });
    ctx.setGitState({ branch: 'dev' });
    const git = useGitStore();
    expect(git.snapshotFor('gone')).not.toBeNull();

    await git.forgetProject('gone');

    expect(git.snapshotFor('gone')).toBeNull();
    expect(ctx.mock.gitState.forget).toHaveBeenCalledWith('gone');
    expect(await ctx.mock.gitState.get('gone')).toBeNull();
  });
});
