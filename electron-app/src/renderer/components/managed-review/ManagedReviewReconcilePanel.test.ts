/**
 * What the reconcile panel offers once a reconciliation has been applied.
 *
 * Applying completes the task on dev, then the panel retires the reviewer
 * branches (a `git push --delete` per branch against GitHub — seconds, not
 * milliseconds). The panel used to reload its task list only *after* that
 * retirement, so for its whole duration it kept rendering the pre-apply task:
 * still `active`, every reviewer finished, "Start Reconciliation" enabled.
 * Clicking it opened a preview against branches that were already gone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import {
  setupRendererTest,
  tasksResponse,
  type RendererTestContext,
} from '@/test/harness';
import ManagedReviewReconcilePanel from './ManagedReviewReconcilePanel.vue';
import type {
  ApplyReconciliationResponse,
  ManagedReviewTask,
} from '@/types/generated/rpc';

const { WalkthroughStub } = vi.hoisted(() => ({
  WalkthroughStub: {
    name: 'ScreenReconcileWalkthrough',
    emits: ['close', 'applied'],
    template: '<div data-testid="screen-reconcile-walkthrough" />',
  },
}));

vi.mock('./ScreenReconcileWalkthrough.vue', () => ({ default: WalkthroughStub }));
vi.mock('./ReconcileWalkthrough.vue', () => ({
  default: defineComponent({ name: 'ReconcileWalkthrough', template: '<div />' }),
}));

const BRANCHES = ['review/screen/t1/alice', 'review/screen/t1/bob'];

function task(state: ManagedReviewTask['state']): ManagedReviewTask {
  return {
    id: 't1',
    kind: 'screen',
    state,
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'alice',
    base_branch: 'dev',
    base_commit: 'abc',
    eligible_state: 'pdf_prepared',
    mode: 'paired',
    record_ids: ['r1', 'r2'],
    record_count: 2,
    reviewers: [],
    reviewer_progress: BRANCHES.map((branch_name, i) => ({
      role: i === 0 ? 'reviewer_a' : 'reviewer_b',
      github_login: i === 0 ? 'alice' : 'bob',
      branch_name,
      available: state === 'active',
      completed_count: 2,
      pending_count: 0,
    })),
  } as ManagedReviewTask;
}

const APPLIED: ApplyReconciliationResponse = {
  success: true,
  project_id: 'lit-review',
  task_id: 't1',
  commit_sha: 'deadbeefcafe',
  resolved_count: 2,
  retired_branches: BRANCHES,
} as ApplyReconciliationResponse;

describe('ManagedReviewReconcilePanel after apply', () => {
  let ctx: RendererTestContext;
  let taskState: ManagedReviewTask['state'];

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject();
    ctx.setGitState({ branch: 'dev' });
    taskState = 'active';
    ctx.mock.rpc.on('list_managed_review_tasks', (p) =>
      tasksResponse(p.kind, [task(taskState)]),
    );
  });

  async function mountAndApply() {
    const wrapper = mount(ManagedReviewReconcilePanel, { props: { kind: 'screen' } });
    await flushPromises();
    await wrapper.get('[data-testid="reconcile-start-btn"]').trigger('click');
    await flushPromises();

    // The backend has committed the reconciliation: the task is completed.
    taskState = 'completed';
    wrapper.findComponent(WalkthroughStub).vm.$emit('applied', APPLIED);
    await flushPromises();
    return wrapper;
  }

  it('stops offering reconciliation while the reviewer branches are still being retired', async () => {
    // Retirement is a network round trip per branch; hold it open.
    ctx.mock.git.deleteRemoteBranch.mockImplementation(() => new Promise(() => {}));

    const wrapper = await mountAndApply();

    expect(ctx.mock.git.deleteRemoteBranch).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="reconcile-start-btn"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('completed');
  });

  it('stops offering reconciliation even when retiring the branches throws', async () => {
    ctx.mock.git.deleteRemoteBranch.mockRejectedValue(new Error('IPC channel closed'));

    const wrapper = await mountAndApply();

    expect(wrapper.find('[data-testid="reconcile-start-btn"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('completed');
  });
});
