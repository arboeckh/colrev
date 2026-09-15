/**
 * The launch → review → reconcile stepper, across more than one round.
 *
 * Reported against a real review: after a first prescreen round was
 * reconciled, a second search source brought in 28 new records. The stepper
 * kept Reconcile ticked (and clickable) throughout the second round, because
 * "a task was ever completed" stood in for "this round is reconciled". Heading
 * there with unsaved decisions opened the save-or-discard dialog — twice — and
 * each reviewer ended up seeing themselves at 28/28 and the other at 0/28.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import {
  makeProjectStatus,
  makeStatusStep,
  PIPELINE_OPERATIONS,
  setupRendererTest,
  tasksResponse,
  TEST_PROJECT_PATH,
  type RendererTestContext,
} from '@/test/harness';
import { useAuthStore } from '@/stores/auth';
import { useGitStore } from '@/stores/git';
import { useProjectsStore } from '@/stores/projects';
import type { ManagedReviewTask } from '@/types/generated/rpc';
import ManagedReviewWorkflowPage from './ManagedReviewWorkflowPage.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { managedReviewKind: 'prescreen' } }),
}));

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));

const { panelRefreshes } = vi.hoisted(() => ({ panelRefreshes: { count: 0 } }));

vi.mock('@/components/managed-review', async () => {
  const { defineComponent, h } = await import('vue');
  const panel = (testId: string) =>
    defineComponent({
      name: testId,
      props: { kind: { type: String, default: 'prescreen' } },
      setup(_props, { expose }) {
        expose({
          refreshData: async () => {
            panelRefreshes.count += 1;
          },
          tryAutoStart: async () => undefined,
        });
        return () => h('div', { 'data-testid': testId });
      },
    });
  return {
    ManagedReviewLaunchPanel: panel('stub-launch-panel'),
    ManagedReviewReconcilePanel: panel('stub-reconcile-panel'),
  };
});

vi.mock('@/views/PrescreenPage.vue', () => ({
  default: { name: 'PrescreenPage', template: '<div data-testid="stub-review-panel" />' },
}));
vi.mock('@/views/ScreenPage.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/views/PrescreenPageHelp.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/views/ScreenPageHelp.vue', () => ({ default: { template: '<div />' } }));

const ALICE_BRANCH = 'review/prescreen/round2/alice';

function task(
  id: string,
  state: ManagedReviewTask['state'],
  progress: { alice: number; bob: number; aliceUnpublished?: number },
  recordCount = 28,
): ManagedReviewTask {
  return {
    id,
    kind: 'prescreen',
    state,
    mode: 'double_screen_same_set',
    base_branch: 'dev',
    base_commit: 'abc',
    eligible_state: 'md_processed',
    created_by: 'alice',
    created_at: `2026-09-1${id === 'round1' ? 0 : 4}T00:00:00Z`,
    record_ids: [],
    record_count: recordCount,
    reviewers: [
      { role: 'reviewer_a', github_login: 'alice', branch_name: `review/prescreen/${id}/alice` },
      { role: 'reviewer_b', github_login: 'bob', branch_name: `review/prescreen/${id}/bob` },
    ],
    reviewer_progress: [
      {
        role: 'reviewer_a',
        github_login: 'alice',
        branch_name: `review/prescreen/${id}/alice`,
        available: state === 'active',
        completed_count: progress.alice,
        pending_count: recordCount - progress.alice,
        unpublished_count: progress.aliceUnpublished ?? 0,
      },
      {
        role: 'reviewer_b',
        github_login: 'bob',
        branch_name: `review/prescreen/${id}/bob`,
        available: state === 'active',
        completed_count: progress.bob,
        pending_count: recordCount - progress.bob,
      },
    ],
  } as ManagedReviewTask;
}

const ROUND_ONE = task('round1', 'completed', { alice: 10, bob: 10 }, 10);

let ctx: RendererTestContext;

function withEligible(count: number) {
  const projects = useProjectsStore();
  projects.currentProject = {
    ...projects.currentProject!,
    status: makeProjectStatus({
      total_records: 38,
      steps: PIPELINE_OPERATIONS.map((operation) =>
        operation === 'prescreen'
          ? makeStatusStep('prescreen', {
            state: count > 0 ? 'in_progress' : 'complete',
            pending_records: count,
          })
          : makeStatusStep(operation),
      ),
    }),
  };
}

function withTasks(tasks: ManagedReviewTask[]) {
  ctx.mock.rpc.on('list_managed_review_tasks', (p) =>
    tasksResponse(p.kind, p.kind === 'prescreen' ? tasks : []),
  );
}

async function mountPage() {
  const wrapper = mount(ManagedReviewWorkflowPage, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

function phase(wrapper: ReturnType<typeof mount>, id: 'launch' | 'review' | 'reconcile') {
  const button = wrapper.get(`[data-testid="workflow-phase-${id}"]`);
  return {
    status: button.attributes('data-phase-status'),
    disabled: button.attributes('disabled') !== undefined,
    click: () => button.trigger('click'),
  };
}

beforeEach(() => {
  panelRefreshes.count = 0;
  ctx = setupRendererTest();
  ctx.openProject({ path: TEST_PROJECT_PATH });
  ctx.setGitState({ branch: 'dev' });
  useGitStore().branches = [{ name: 'dev' } as never];
  useAuthStore().session = {
    user: { login: 'alice', name: null, avatarUrl: '', email: null },
    authenticatedAt: '2026-01-01T00:00:00Z',
  } as never;
});

describe('ManagedReviewWorkflowPage stepper', () => {
  it('starts a second round at launch instead of showing the first round finished', async () => {
    withEligible(28);
    withTasks([ROUND_ONE]);

    const wrapper = await mountPage();

    expect(phase(wrapper, 'launch').status).toBe('active');
    expect(phase(wrapper, 'review').status).toBe('pending');
    expect(phase(wrapper, 'reconcile').status).toBe('pending');
    // Nothing of this round exists to review or reconcile yet.
    expect(phase(wrapper, 'review').disabled).toBe(true);
    expect(phase(wrapper, 'reconcile').disabled).toBe(true);
  });

  it('does not tick reconcile for a launched round because an earlier one was reconciled', async () => {
    withEligible(28);
    withTasks([task('round2', 'active', { alice: 0, bob: 0 }), ROUND_ONE]);

    const wrapper = await mountPage();

    expect(phase(wrapper, 'launch').status).toBe('complete');
    expect(phase(wrapper, 'review').status).toBe('pending');
    expect(phase(wrapper, 'reconcile').status).toBe('pending');
  });

  it('keeps reconcile closed while the current user has unsaved decisions', async () => {
    withEligible(28);
    withTasks([task('round2', 'active', { alice: 28, bob: 28 }), ROUND_ONE]);
    ctx.setGitState({ branch: ALICE_BRANCH, isClean: false, uncommittedChanges: 1 });

    const wrapper = await mountPage();

    expect(phase(wrapper, 'reconcile').disabled).toBe(true);
  });

  it('shows every phase finished once the latest round is reconciled and nothing is new', async () => {
    withEligible(0);
    withTasks([task('round2', 'completed', { alice: 28, bob: 28 }), ROUND_ONE]);

    const wrapper = await mountPage();

    expect(phase(wrapper, 'launch').status).toBe('complete');
    expect(phase(wrapper, 'review').status).toBe('complete');
    expect(phase(wrapper, 'reconcile').status).toBe('complete');
    expect(phase(wrapper, 'reconcile').disabled).toBe(false);
  });

  it('stays in the review when leaving it is refused, then continues once the dialog is resolved', async () => {
    withEligible(28);
    withTasks([task('round2', 'active', { alice: 28, bob: 0 }), ROUND_ONE]);

    const wrapper = await mountPage();
    await phase(wrapper, 'review').click();
    await flushPromises();
    expect(wrapper.find('[data-testid="stub-review-panel"]').exists()).toBe(true);

    // The reviewer's decisions are not saved yet: checkout refuses.
    ctx.setGitState({ branch: ALICE_BRANCH, isClean: false, uncommittedChanges: 1 });
    ctx.mock.git.checkout.mockResolvedValueOnce({
      success: false,
      error: 'DIRTY_WORKTREE',
      dirty: { uncommittedCount: 1, untrackedCount: 0 },
    });

    await phase(wrapper, 'launch').click();
    await flushPromises();

    const git = useGitStore();
    expect(git.showBranchSwitchBlockedDialog).toBe(true);
    // Still reviewing — the launch panel did not mount on the reviewer branch
    // (where it used to ask to switch, and open the dialog, a second time).
    expect(wrapper.find('[data-testid="stub-review-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="stub-launch-panel"]').exists()).toBe(false);

    // The dialog saved and switched; it hands control back to the stepper.
    ctx.setGitState({ branch: 'dev' });
    await git.blockedSwitchResume?.();
    await flushPromises();
    expect(wrapper.find('[data-testid="stub-launch-panel"]').exists()).toBe(true);
  });
});

describe('ManagedReviewWorkflowPage on arrival', () => {
  it('shares decisions the user saved on a reviewer branch but never pushed', async () => {
    withEligible(28);
    withTasks([task('round2', 'active', { alice: 28, bob: 28, aliceUnpublished: 1 }), ROUND_ONE]);

    await mountPage();

    expect(ctx.mock.git.pushBranch).toHaveBeenCalledWith(
      TEST_PROJECT_PATH,
      'review/prescreen/round2/alice',
    );
    // The panel on screen reloads so the progress it shows is current.
    expect(panelRefreshes.count).toBe(1);
  });

  it('pushes nothing when everything is already shared', async () => {
    withEligible(28);
    withTasks([task('round2', 'active', { alice: 28, bob: 28 }), ROUND_ONE]);

    await mountPage();

    expect(ctx.mock.git.pushBranch).not.toHaveBeenCalled();
  });
});
