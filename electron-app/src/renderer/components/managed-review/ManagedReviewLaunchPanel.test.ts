/**
 * The launch panel shows a task's reviewers and progress. It reads them from
 * the managed-review store rather than a copy loaded on mount, so a colleague's
 * progress — brought in by a background fetch — shows up without leaving and
 * re-entering the page, and a Prescreen panel never shows Screen's task.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import {
  setupRendererTest,
  tasksResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { useAuthStore } from '@/stores/auth';
import { useGitStore } from '@/stores/git';
import { useManagedReviewStore } from '@/stores/managedReview';
import { useSyncStore } from '@/stores/sync';
import type { ManagedReviewTask } from '@/types/generated/rpc';
import ManagedReviewLaunchPanel from './ManagedReviewLaunchPanel.vue';

vi.mock('@/components/review-definition', () => ({
  CriteriaList: { name: 'CriteriaList', template: '<div />' },
}));

function task(kind: 'prescreen' | 'screen', bobCompleted: number): ManagedReviewTask {
  return {
    id: `${kind}-1`,
    kind,
    state: 'active',
    mode: 'double_screen_same_set',
    base_branch: 'dev',
    base_commit: 'abc',
    eligible_state: 'md_processed',
    created_by: 'alice',
    created_at: '2026-09-10T00:00:00Z',
    record_ids: [],
    record_count: 10,
    reviewers: [
      { role: 'reviewer_a', github_login: 'alice', branch_name: `review/${kind}/1/alice` },
      { role: 'reviewer_b', github_login: 'bob', branch_name: `review/${kind}/1/bob` },
    ],
    reviewer_progress: [
      {
        role: 'reviewer_a',
        github_login: 'alice',
        branch_name: `review/${kind}/1/alice`,
        available: true,
        completed_count: 2,
        pending_count: 8,
      },
      {
        role: 'reviewer_b',
        github_login: 'bob',
        branch_name: `review/${kind}/1/bob`,
        available: true,
        completed_count: bobCompleted,
        pending_count: 10 - bobCompleted,
      },
    ],
  } as ManagedReviewTask;
}

let ctx: RendererTestContext;
let bobCompleted: number;

beforeEach(() => {
  bobCompleted = 0;
  ctx = setupRendererTest();
  ctx.openProject();
  ctx.setGitState({ branch: 'dev', remoteUrl: null });
  useGitStore().branches = [{ name: 'dev' } as never];
  useAuthStore().session = {
    user: { login: 'alice', name: null, avatarUrl: '', email: null },
    authenticatedAt: '2026-01-01T00:00:00Z',
  } as never;
  ctx.mock.rpc
    .on('list_managed_review_tasks', (p) => tasksResponse(p.kind, [task(p.kind, bobCompleted)]))
    .on('get_managed_review_task_readiness', (p) => ({
      success: true,
      project_id: TEST_PROJECT_ID,
      kind: p.kind,
      ready: false,
      current_branch: 'dev',
      eligible_count: 0,
      eligible_record_ids: [],
      eligible_state: 'md_processed',
      issues: [],
      tracking: {} as never,
    }))
    .on('get_current_managed_review_task', (p) => ({
      success: true,
      project_id: TEST_PROJECT_ID,
      kind: p.kind,
      current_branch: 'dev',
      task: null,
    }));
});

describe('ManagedReviewLaunchPanel', () => {
  it("shows a colleague's progress once a background fetch brings it in", async () => {
    ctx.setGitState({ branch: 'dev', remoteUrl: 'https://github.com/acme/lit-review.git' });
    const wrapper = mount(ManagedReviewLaunchPanel, { props: { kind: 'prescreen' } });
    await flushPromises();
    expect(wrapper.get('[data-testid="reviewer-progress-bob"]').text()).toBe('0 / 10');

    bobCompleted = 6;
    ctx.mock.git.fetch.mockResolvedValueOnce({ success: true, refsChanged: true });
    await useSyncStore().fetchNow();
    await flushPromises();

    expect(wrapper.get('[data-testid="reviewer-progress-bob"]').text()).toBe('6 / 10');
  });

  it('follows the store when the header refresh reloads the tasks', async () => {
    const wrapper = mount(ManagedReviewLaunchPanel, { props: { kind: 'prescreen' } });
    await flushPromises();

    bobCompleted = 3;
    await useManagedReviewStore().refresh();
    await flushPromises();

    expect(wrapper.get('[data-testid="reviewer-progress-bob"]').text()).toBe('3 / 10');
  });

  it('cancels the task of its own kind', async () => {
    ctx.mock.rpc.on('cancel_managed_review_task', () => ({
      success: true,
      project_id: TEST_PROJECT_ID,
      task: { ...task('screen', 0), state: 'aborted' },
    }));
    const wrapper = mount(ManagedReviewLaunchPanel, { props: { kind: 'screen' } });
    await flushPromises();

    const cancel = wrapper.findAll('button').find((b) => b.text() === 'Cancel Task')!;
    await cancel.trigger('click');
    await flushPromises();

    expect(ctx.mock.rpc.callsTo('cancel_managed_review_task')[0].params.task_id).toBe('screen-1');
  });
});
