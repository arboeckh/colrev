/**
 * Managed-review task state (WP-08 §1).
 *
 * Task state gates access control — whether a reviewer may open the prescreen
 * or screen queue at all. So the one behaviour worth pinning hardest is that
 * a *failed* fetch is not silently indistinguishable from "no tasks": the
 * last-known lists survive and `lastRefreshError` is set.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useGitStore } from './git';
import { useManagedReviewStore } from './managedReview';
import { useProjectsStore } from './projects';
import type { ManagedReviewTask } from '@/types/generated/rpc';
import {
  setupRendererTest,
  tasksResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { makeGitSnapshot } from '@/test/window-mock';

function task(overrides: Partial<ManagedReviewTask> & { id: string }): ManagedReviewTask {
  return {
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
    reviewers: [],
    state: 'active',
    ...overrides,
  };
}

let ctx: RendererTestContext;

beforeEach(() => {
  ctx = setupRendererTest();
  ctx.openProject();
  ctx.setGitState({ remoteUrl: null });
});

describe('refresh', () => {
  it('splits the two kinds into their own lists', async () => {
    ctx.mock.rpc.on('list_managed_review_tasks', (params) =>
      tasksResponse(
        params.kind,
        params.kind === 'prescreen' ? [task({ id: 'p1' })] : [task({ id: 's1', kind: 'screen' })],
      ),
    );

    const managed = useManagedReviewStore();
    await managed.refresh();

    expect(managed.activePrescreenTask?.id).toBe('p1');
    expect(managed.activeScreenTask?.id).toBe('s1');
    expect(managed.lastRefreshError).toBeNull();
  });

  it('fetches remote refs first when the project has a remote', async () => {
    ctx.setGitState({ remoteUrl: 'https://github.com/acme/lit-review.git' });
    ctx.mock.rpc.on('list_managed_review_tasks', (p) => tasksResponse(p.kind));

    await useManagedReviewStore().refresh();

    // Without the fetch, another reviewer's completed branch is invisible.
    expect(ctx.mock.git.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips the fetch when there is no remote', async () => {
    ctx.mock.rpc.on('list_managed_review_tasks', (p) => tasksResponse(p.kind));
    await useManagedReviewStore().refresh();
    expect(ctx.mock.git.fetch).not.toHaveBeenCalled();
  });

  it('keeps the last-known tasks when the fetch fails, and says so', async () => {
    ctx.mock.rpc.on('list_managed_review_tasks', (p) =>
      tasksResponse(p.kind, p.kind === 'prescreen' ? [task({ id: 'p1' })] : []),
    );
    const managed = useManagedReviewStore();
    await managed.refresh();
    expect(managed.activePrescreenTask?.id).toBe('p1');

    ctx.mock.rpc.onError('list_managed_review_tasks', { message: 'backend down' });
    await managed.refresh();

    // Clearing here would read downstream as "no active task" and silently
    // change who is allowed to review.
    expect(managed.activePrescreenTask?.id).toBe('p1');
    expect(managed.lastRefreshError).toBe('backend down');
  });

  it('clears the error flag on the next successful refresh', async () => {
    const managed = useManagedReviewStore();
    ctx.mock.rpc.onError('list_managed_review_tasks', { message: 'backend down' });
    await managed.refresh();
    expect(managed.lastRefreshError).toBe('backend down');

    ctx.mock.rpc.on('list_managed_review_tasks', (p) => tasksResponse(p.kind));
    await managed.refresh();
    expect(managed.lastRefreshError).toBeNull();
  });

  it('does nothing when no project is open', async () => {
    useProjectsStore().currentProjectId = null;
    await useManagedReviewStore().refresh();
    expect(ctx.mock.rpc.countOf('list_managed_review_tasks')).toBe(0);
  });

  it('never leaves isLoading stuck after a failure', async () => {
    ctx.mock.rpc.onError('list_managed_review_tasks', {});
    const managed = useManagedReviewStore();
    await managed.refresh();
    expect(managed.isLoading).toBe(false);
  });
});

describe('derived task views', () => {
  beforeEach(() => {
    ctx.mock.rpc.on('list_managed_review_tasks', (params) =>
      tasksResponse(
        params.kind,
        params.kind === 'prescreen'
          ? [
              task({ id: 'p-old', state: 'completed' }),
              task({ id: 'p-active', state: 'active' }),
              task({ id: 'p-aborted', state: 'aborted' }),
            ]
          : [],
      ),
    );
  });

  it('picks the active task and, separately, the latest completed one', async () => {
    const managed = useManagedReviewStore();
    await managed.refresh();

    expect(managed.activePrescreenTask?.id).toBe('p-active');
    expect(managed.latestCompletedPrescreenTask?.id).toBe('p-old');
    expect(managed.activeScreenTask).toBeNull();
  });

  it('reads the reviewer-branch flag off the git snapshot', async () => {
    const managed = useManagedReviewStore();
    expect(managed.isOnReviewerBranch).toBe(false);

    useGitStore().applySnapshot(
      makeGitSnapshot({ projectId: TEST_PROJECT_ID, branch: 'review/prescreen/t1/alice' }),
    );
    expect(managed.isOnReviewerBranch).toBe(true);
  });
});
