/**
 * Prescreen and Screen are two routes on the same page component. Moving
 * between them has to start the other step from scratch — the existing page
 * tests mock the route statically, so none of them ever changes it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  setupRendererTest,
  tasksResponse,
  TEST_PROJECT_PATH,
  type RendererTestContext,
} from '@/test/harness';
import { useAuthStore } from '@/stores/auth';
import { useGitStore } from '@/stores/git';
import type { ManagedReviewTask } from '@/types/generated/rpc';
import AppRouterView from '@/components/layout/AppRouterView.vue';
import ManagedReviewWorkflowPage from './ManagedReviewWorkflowPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));

const { panelMounts } = vi.hoisted(() => ({ panelMounts: [] as string[] }));

vi.mock('@/components/managed-review', async () => {
  const { defineComponent, h, onMounted } = await import('vue');
  const panel = (testId: string) =>
    defineComponent({
      name: testId,
      props: { kind: { type: String, default: 'prescreen' } },
      setup(props, { expose }) {
        onMounted(() => panelMounts.push(`${testId}:${props.kind}`));
        expose({ refreshData: async () => undefined, tryAutoStart: async () => undefined });
        return () => h('div', { 'data-testid': testId }, props.kind);
      },
    });
  return {
    ManagedReviewLaunchPanel: panel('launch-panel'),
    ManagedReviewReconcilePanel: panel('reconcile-panel'),
  };
});

vi.mock('@/views/PrescreenPage.vue', () => ({
  default: { name: 'PrescreenPage', template: '<div data-testid="prescreen-review" />' },
}));
vi.mock('@/views/ScreenPage.vue', () => ({
  default: { name: 'ScreenPage', template: '<div data-testid="screen-review" />' },
}));
vi.mock('@/views/PrescreenPageHelp.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/views/ScreenPageHelp.vue', () => ({ default: { template: '<div />' } }));

const PRESCREEN_TASK = {
  id: 'p1',
  kind: 'prescreen',
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
    { role: 'reviewer_a', github_login: 'alice', branch_name: 'review/prescreen/p1/alice' },
    { role: 'reviewer_b', github_login: 'bob', branch_name: 'review/prescreen/p1/bob' },
  ],
  reviewer_progress: [
    {
      role: 'reviewer_a',
      github_login: 'alice',
      branch_name: 'review/prescreen/p1/alice',
      available: true,
      completed_count: 3,
      pending_count: 7,
    },
    {
      role: 'reviewer_b',
      github_login: 'bob',
      branch_name: 'review/prescreen/p1/bob',
      available: true,
      completed_count: 3,
      pending_count: 7,
    },
  ],
} as ManagedReviewTask;

let ctx: RendererTestContext;

function makeRouter() {
  const Page = ManagedReviewWorkflowPage;
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/prescreen', component: Page, meta: { managedReviewKind: 'prescreen' } },
      { path: '/screen', component: Page, meta: { managedReviewKind: 'screen' } },
    ],
  });
}

beforeEach(() => {
  panelMounts.length = 0;
  ctx = setupRendererTest();
  ctx.openProject({ path: TEST_PROJECT_PATH });
  ctx.setGitState({ branch: 'dev' });
  useGitStore().branches = [{ name: 'dev' } as never];
  useAuthStore().session = {
    user: { login: 'alice', name: null, avatarUrl: '', email: null },
    authenticatedAt: '2026-01-01T00:00:00Z',
  } as never;
  // Only prescreen has a task in flight.
  ctx.mock.rpc.on('list_managed_review_tasks', (p) =>
    tasksResponse(p.kind, p.kind === 'prescreen' ? [PRESCREEN_TASK] : []),
  );
});

describe('switching between Prescreen and Screen', () => {
  async function mountAt(path: string) {
    const router = makeRouter();
    await router.push(path);
    await router.isReady();
    const wrapper = mount(AppRouterView, {
      global: { plugins: [router] },
      attachTo: document.body,
    });
    await flushPromises();
    return { router, wrapper };
  }

  it('starts Screen at launch instead of keeping the Prescreen review open', async () => {
    const { router, wrapper } = await mountAt('/prescreen');

    await wrapper.get('[data-testid="workflow-phase-review"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="prescreen-review"]').exists()).toBe(true);

    await router.push('/screen');
    await flushPromises();

    // Screen has no task: it must not inherit the review phase (which would
    // mount ScreenPage past the canEnterReviewPhase gate).
    expect(wrapper.find('[data-testid="screen-review"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="prescreen-review"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="launch-panel"]').text()).toBe('screen');
    expect(wrapper.get('[data-testid="workflow-phase-launch"]').attributes('data-phase-status')).toBe(
      'active',
    );
    expect(wrapper.get('[data-testid="workflow-phase-review"]').attributes('disabled')).toBeDefined();
  });

  it('remounts the launch panel for the other kind rather than reusing it', async () => {
    const { router } = await mountAt('/prescreen');
    expect(panelMounts).toEqual(['launch-panel:prescreen']);

    await router.push('/screen');
    await flushPromises();

    expect(panelMounts).toEqual(['launch-panel:prescreen', 'launch-panel:screen']);
  });
});
