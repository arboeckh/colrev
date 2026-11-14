/**
 * Preprocessing page: a run outlives the page, a failed stage is not reported
 * as success, and a failure to load the sources is not "no sources".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import {
  setupRendererTest,
  operationResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { useNotificationsStore } from '@/stores/notifications';
import PreprocessingPage from './PreprocessingPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));
vi.mock('@/components/preprocessing/PreprocessingResultsModal.vue', () => ({
  default: { name: 'PreprocessingResultsModal', template: '<div />' },
}));

const SOURCES = [
  {
    platform: 'colrev.pubmed',
    endpoint: 'colrev.pubmed',
    search_type: 'API',
    filename: 'data/search/pubmed.bib',
    search_results_path: 'data/search/pubmed.bib',
    record_count: 3,
  },
];

async function mountPage(ctx: RendererTestContext): Promise<VueWrapper> {
  ctx.openProject();
  ctx.setGitState({ branch: 'dev' });
  const wrapper = mount(PreprocessingPage);
  await flushPromises();
  return wrapper;
}

describe('PreprocessingPage', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc
      .on('get_sources', { project_id: TEST_PROJECT_ID, success: true, sources: SOURCES } as never)
      .on('load', operationResponse('load'))
      .on('prep', operationResponse('prep'))
      .on('dedupe', operationResponse('dedupe'));
  });

  it('does not report completion when a stage failed', async () => {
    ctx.mock.rpc.on('prep', () => {
      throw new Error('prep exploded');
    });
    const notifications = useNotificationsStore();
    const success = vi.spyOn(notifications, 'success');
    const error = vi.spyOn(notifications, 'error');

    const wrapper = await mountPage(ctx);
    await wrapper.get('[data-testid="preprocessing-run-all-button"]').trigger('click');
    await flushPromises();

    expect(error).toHaveBeenCalledWith('prep failed', expect.stringContaining('prep exploded'));
    expect(success).not.toHaveBeenCalled();
    // The failed stage stops the run: dedupe never starts.
    expect(ctx.mock.rpc.callsTo('dedupe')).toHaveLength(0);
  });

  it('reports completion when every stage succeeded', async () => {
    const success = vi.spyOn(useNotificationsStore(), 'success');

    const wrapper = await mountPage(ctx);
    await wrapper.get('[data-testid="preprocessing-run-all-button"]').trigger('click');
    await flushPromises();

    expect(success).toHaveBeenCalledWith('Preprocessing completed');
  });

  it('keeps showing the run, and refuses a second one, after leaving and coming back', async () => {
    let release!: () => void;
    ctx.mock.rpc.on(
      'load',
      () =>
        new Promise((resolve) => {
          release = () => resolve(operationResponse('load') as never);
        }) as never,
    );

    const first = await mountPage(ctx);
    void first.get('[data-testid="preprocessing-run-all-button"]').trigger('click');
    await flushPromises();
    first.unmount();

    const second = mount(PreprocessingPage);
    await flushPromises();

    const button = second.get('[data-testid="preprocessing-run-all-button"]');
    expect(button.text()).toContain('Running');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    await flushPromises();
    expect(ctx.mock.rpc.callsTo('load')).toHaveLength(1);

    release();
    await flushPromises();
    second.unmount();
  });

  it('shows an error with Retry when the sources cannot be loaded', async () => {
    let fail = true;
    ctx.mock.rpc.on('get_sources', () => {
      if (fail) throw new Error('backend hiccup');
      return { project_id: TEST_PROJECT_ID, success: true, sources: SOURCES } as never;
    });

    const wrapper = await mountPage(ctx);

    expect(wrapper.find('[data-testid="preprocessing-sources-load-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('backend hiccup');
    expect(wrapper.text()).not.toContain('No search sources yet');

    fail = false;
    await wrapper.get('[data-testid="preprocessing-sources-load-error-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="preprocessing-sources-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="preprocessing-run-all-button"]').exists()).toBe(true);
  });
});
