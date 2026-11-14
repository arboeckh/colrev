/**
 * The reconciliation walkthroughs must never leave the user without a way
 * forward: a failed preview offers Retry and Back, a staged choice can be
 * changed, and every conflict can be resolved — including a record that was
 * blocked only by non-task metadata (overridable) with disagreeing reviewers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';
import ReconcileWalkthrough from './ReconcileWalkthrough.vue';
import ScreenReconcileWalkthrough from './ScreenReconcileWalkthrough.vue';
import type {
  GetRecordsResponse,
  GetReconciliationPreviewResponse,
  ReconciliationPreviewItem,
} from '@/types/generated/rpc';

vi.mock('@/components/screen/PdfViewerPanel.vue', () => ({
  default: { name: 'PdfViewerPanel', props: ['pdfPath'], template: '<div />' },
}));

type Kind = 'prescreen' | 'screen';

const STATUS = {
  prescreen: { include: 'rev_prescreen_included', exclude: 'rev_prescreen_excluded' },
  screen: { include: 'rev_included', exclude: 'rev_excluded' },
};

function item(
  id: string,
  kind: Kind,
  status: ReconciliationPreviewItem['status'],
  blocked_reasons: string[] = [],
): ReconciliationPreviewItem {
  return {
    id,
    title: `Title ${id}`,
    author: 'Doe, J.',
    year: '2020',
    status,
    blocked_reasons,
    reviewers: (['reviewer_a', 'reviewer_b'] as const).map((role, i) => ({
      role,
      github_login: i === 0 ? 'alice' : 'bob',
      branch_name: `review/${kind}/t1/${i === 0 ? 'alice' : 'bob'}`,
      status: i === 0 ? STATUS[kind].include : STATUS[kind].exclude,
      criteria: (kind === 'screen' ? { c1: i === 0 ? 'in' : 'out' } : {}) as Record<string, string>,
      criteria_string: kind === 'screen' ? `c1=${i === 0 ? 'in' : 'out'}` : '',
    })),
  };
}

function previewOf(items: ReconciliationPreviewItem[]): GetReconciliationPreviewResponse {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    items,
    summary: { auto_resolved_count: 0 },
    task: { id: 't1' },
  } as unknown as GetReconciliationPreviewResponse;
}

function recordsPage(
  ids: string[],
  extra: Record<string, unknown>,
  offset: number,
  hasMore: boolean,
): GetRecordsResponse {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    total_count: 0,
    records: ids.map((ID) => ({ ID, ...extra })),
    pagination: { offset, limit: 500, has_more: hasMore },
  } as GetRecordsResponse;
}

describe('reconciliation walkthroughs', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject();
    ctx.mock.rpc.on('get_records', recordsPage([], {}, 0, false));
    ctx.mock.rpc.on('get_screen_queue', {
      success: true,
      project_id: TEST_PROJECT_ID,
      criteria: { c1: { criterion_type: 'inclusion_criterion' } },
      records: [],
      total_count: 0,
    });
  });

  describe.each(['prescreen', 'screen'] as const)('%s: preview fails', (kind) => {
    const Walkthrough = kind === 'screen' ? ScreenReconcileWalkthrough : ReconcileWalkthrough;

    it('shows the error with Back, and Retry recovers', async () => {
      let calls = 0;
      ctx.mock.rpc.on('get_reconciliation_preview', () => {
        calls += 1;
        if (calls === 1) throw new Error('backend exploded');
        return previewOf([item('a', kind, 'conflict')]);
      });

      const wrapper = mount(Walkthrough, { props: { taskId: 't1', kind } });
      await flushPromises();

      const error = wrapper.get('[data-testid="reconcile-load-error"]');
      expect(error.text()).toContain('backend exploded');

      await wrapper.get('[data-testid="reconcile-back-btn"]').trigger('click');
      expect(wrapper.emitted('close')).toHaveLength(1);

      await wrapper.get('[data-testid="reconcile-retry-btn"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-testid="reconcile-load-error"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('Title a');
    });
  });

  it('screen: the hard-blocked view has a Back button', async () => {
    ctx.mock.rpc.on(
      'get_reconciliation_preview',
      previewOf([item('a', 'screen', 'blocked', ['Missing on reviewer branch'])]),
    );
    const wrapper = mount(ScreenReconcileWalkthrough, { props: { taskId: 't1' } });
    await flushPromises();

    await wrapper.get('[data-testid="reconcile-back-btn"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('screen: an overridable-blocked record with disagreeing reviewers can be resolved and applied', async () => {
    ctx.mock.rpc.on(
      'get_reconciliation_preview',
      previewOf([item('a', 'screen', 'blocked', ['Non-task metadata changed: title'])]),
    );
    ctx.mock.rpc.on('apply_reconciliation', {
      success: true,
      project_id: TEST_PROJECT_ID,
      task_id: 't1',
      commit_sha: 'deadbeefcafe',
      resolved_count: 1,
      retired_branches: [],
    } as never);

    const wrapper = mount(ScreenReconcileWalkthrough, { props: { taskId: 't1' } });
    await flushPromises();

    expect(wrapper.find('[data-testid="screen-reconcile-criteria-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="reconcile-apply-btn"]').exists()).toBe(false);

    // Enter confirms the derived decision (nothing ticked → exclude).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flushPromises();

    await wrapper.get('[data-testid="reconcile-apply-btn"]').trigger('click');
    await flushPromises();

    const call = ctx.mock.rpc.calls.find((c) => c.method === 'apply_reconciliation');
    expect(call?.params).toMatchObject({
      override_blocks: true,
      resolutions: [{ record_id: 'a', resolved_status: 'rev_excluded' }],
    });
    expect(wrapper.emitted('applied')).toHaveLength(1);
  });

  it('prescreen: a staged choice can be changed before applying', async () => {
    ctx.mock.rpc.on('get_reconciliation_preview', previewOf([item('a', 'prescreen', 'conflict')]));
    ctx.mock.rpc.on('apply_reconciliation', {
      success: true,
      project_id: TEST_PROJECT_ID,
      task_id: 't1',
      commit_sha: 'deadbeefcafe',
      resolved_count: 1,
      retired_branches: [],
    } as never);

    const wrapper = mount(ReconcileWalkthrough, {
      props: { taskId: 't1', kind: 'prescreen' },
    });
    await flushPromises();

    // Mis-click: exclude (reviewer_b's choice).
    await wrapper.get('[data-testid="reconcile-btn-exclude"]').trigger('click');
    expect(wrapper.get('[data-testid="reconcile-decision-indicator"]').text()).toContain('Excluded');

    await wrapper.get('[data-testid="reconcile-btn-change"]').trigger('click');
    await wrapper.get('[data-testid="reconcile-btn-include"]').trigger('click');
    expect(wrapper.get('[data-testid="reconcile-decision-indicator"]').text()).toContain('Included');

    await wrapper.get('[data-testid="reconcile-apply-btn"]').trigger('click');
    await flushPromises();
    const call = ctx.mock.rpc.calls.find((c) => c.method === 'apply_reconciliation');
    expect(call?.params).toMatchObject({
      resolutions: [{ record_id: 'a', selected_reviewer: 'reviewer_a' }],
    });
  });

  it('prescreen: loads details of a conflict record beyond the first 500 records', async () => {
    ctx.mock.rpc.on('get_reconciliation_preview', previewOf([item('late', 'prescreen', 'conflict')]));
    ctx.mock.rpc.on('get_records', (p) => {
      const offset = p.pagination?.offset ?? 0;
      return offset === 0
        ? recordsPage(Array.from({ length: 500 }, (_, i) => `r${i}`), {}, 0, true)
        : recordsPage(['late'], { abstract: 'The late abstract.' }, offset, false);
    });

    const wrapper = mount(ReconcileWalkthrough, {
      props: { taskId: 't1', kind: 'prescreen' },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('The late abstract.');
  });
});
