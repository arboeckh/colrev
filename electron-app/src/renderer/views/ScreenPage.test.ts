/**
 * ScreenPage's window-level keydown listener, the completion hand-off, and the
 * criteria checklist on decided records.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setupRendererTest, tasksResponse, type RendererTestContext } from '@/test/harness';
import { useProjectDataStore } from '@/stores/projectData';
import { useSyncStore } from '@/stores/sync';
import ScreenPage from './ScreenPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));
// The PDF pane loads files through the main process; it is not under test.
vi.mock('@/components/screen/PdfViewerPanel.vue', () => ({
  default: { name: 'PdfViewerPanel', template: '<div />' },
}));

let mounted: VueWrapper[] = [];

afterEach(() => {
  mounted.forEach((w) => w.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

function stubScreen(ctx: RendererTestContext, ids: string[] = ['r1']) {
  ctx.mock.rpc.onError('get_current_managed_review_task', { message: 'not managed' });
  ctx.mock.rpc.on('list_managed_review_tasks', () => tasksResponse('screen'));
  ctx.mock.rpc.on('get_review_definition', () => {
    throw new Error('not needed');
  });
  ctx.mock.rpc.on('get_screen_queue', () => ({
    success: true,
    project_id: 'lit-review',
    total_count: ids.length,
    criteria: { Relevant: { criterion_type: 'inclusion_criterion' } },
    records: ids.map((id) => ({ id, title: `Title ${id}`, author: 'A', year: '2024' })),
  }));
  ctx.mock.rpc.on('screen_record', (params) => ({
    success: true,
    project_id: 'lit-review',
    record: {
      id: params.record_id as string,
      decision: params.decision as 'include' | 'exclude',
      criteria_decisions: {},
      new_status: 'rev_included',
    },
    remaining_count: 0,
    already_decided: false,
  }));
}

function keydownCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter(([type]) => type === 'keydown');
}

describe('ScreenPage', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject();
    ctx.setGitState({ branch: 'dev' });
  });

  it('leaves no window keydown listener when unmounted while still loading', async () => {
    stubScreen(ctx);
    // The queue never loads, so onMounted is still awaiting when we leave.
    ctx.mock.rpc.on('get_screen_queue', () => new Promise(() => {}));
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');

    const wrapper = mount(ScreenPage);
    await flushPromises();
    wrapper.unmount();
    await flushPromises();

    const addedHandlers = keydownCalls(added).map(([, handler]) => handler);
    const removedHandlers = keydownCalls(removed).map(([, handler]) => handler);
    expect(addedHandlers.length).toBeGreaterThan(0);
    for (const handler of addedHandlers) expect(removedHandlers).toContain(handler);

    // And it no longer swallows the arrow keys app-wide.
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('holds auto-sync off while mounted and releases it on unmount', async () => {
    stubScreen(ctx);
    const sync = useSyncStore();
    const wrapper = mount(ScreenPage);
    await flushPromises();
    expect(sync.suspensions.length).toBeGreaterThan(0);

    wrapper.unmount();
    expect(sync.suspensions).toHaveLength(0);
  });

  it('shows the completion screen, not "No PDFs ready", while the final refresh runs', async () => {
    stubScreen(ctx);
    // The refresh that reads the final counts never settles.
    vi.spyOn(useProjectDataStore(), 'refreshNow').mockReturnValue(new Promise(() => {}));

    const wrapper = mount(ScreenPage);
    mounted.push(wrapper);
    await flushPromises();

    await wrapper.get('[data-testid="criterion-check-Relevant"]').trigger('click');
    await wrapper.get('[data-testid="screen-btn-include"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('No PDFs ready to screen');
    expect(wrapper.text()).toContain('complete');
  });

  it('lets a decision already made be changed after jumping back to it', async () => {
    stubScreen(ctx, ['r1', 'r2']);
    ctx.mock.rpc.on('update_screen_decisions', () => ({
      success: true,
      project_id: 'lit-review',
      changes_count: 1,
      message: 'ok',
      updated_records: ['r1'],
      skipped: [],
    }));

    const wrapper = mount(ScreenPage);
    mounted.push(wrapper);
    await flushPromises();

    await wrapper.get('[data-testid="criterion-check-Relevant"]').trigger('click');
    await wrapper.get('[data-testid="screen-btn-include"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="screen-record-id"]').text()).toBe('r2');

    // Back to the decided record: both buttons are live, the decision marked.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    await flushPromises();
    expect(wrapper.get('[data-testid="screen-record-id"]').text()).toBe('r1');
    expect(wrapper.get('[data-testid="screen-btn-include"]').attributes('aria-pressed')).toBe('true');

    // Un-tick the criterion and exclude: a change, written as a revision.
    await wrapper.get('[data-testid="criterion-check-Relevant"]').trigger('click');
    await wrapper.get('[data-testid="screen-btn-exclude"]').trigger('click');
    await flushPromises();

    expect(ctx.mock.rpc.countOf('update_screen_decisions')).toBe(1);
    expect(ctx.mock.rpc.countOf('screen_record')).toBe(1);
    expect(wrapper.get('[data-testid="screen-record-id"]').text()).toBe('r2');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    await flushPromises();
    expect(wrapper.get('[data-testid="screen-btn-exclude"]').attributes('aria-pressed')).toBe('true');
  });
});
