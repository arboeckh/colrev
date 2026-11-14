/**
 * DataPage: a failed load is an error (with Retry), not "not configured";
 * failed saves are shown; "Edit extractions" survives a save; auto-sync is
 * held while the page is open.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setupRendererTest, type RendererTestContext } from '@/test/harness';
import { useSyncStore } from '@/stores/sync';
import { useNotificationsStore } from '@/stores/notifications';
import DataPage from './DataPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));
vi.mock('@/components/screen', () => ({
  PdfViewerPanel: { name: 'PdfViewerPanel', template: '<div />' },
  ScreenSplitPanel: {
    name: 'ScreenSplitPanel',
    template: '<div><slot name="left" /><slot name="right" /></div>',
  },
}));

const FIELDS = [{ name: 'sample_size', explanation: 'n', data_type: 'str' }];

function queue(values: Record<string, string>) {
  const ids = Object.keys(values);
  return {
    success: true as const,
    project_id: 'lit-review',
    configured: true,
    fields: FIELDS,
    records: ids.map((id) => ({
      id,
      title: `Title ${id}`,
      author: '',
      year: '',
      journal: '',
      booktitle: '',
      pdf_path: '',
      extraction_values: { sample_size: values[id] },
    })),
    total_count: ids.length,
    completed_count: ids.filter((id) => values[id] !== 'TODO').length,
  };
}

async function mountPage(ctx: RendererTestContext): Promise<VueWrapper> {
  ctx.openProject();
  ctx.setGitState({ branch: 'dev' });
  const wrapper = mount(DataPage);
  await flushPromises();
  return wrapper;
}

describe('DataPage', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
  });

  it('shows a load error with Retry instead of the setup prompt', async () => {
    ctx.mock.rpc.onError('get_data_extraction_queue', { message: 'boom' });

    const wrapper = await mountPage(ctx);

    expect(wrapper.find('[data-testid="data-load-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('boom');
    expect(wrapper.find('[data-testid="data-setup-btn"]').exists()).toBe(false);

    ctx.mock.rpc.on('get_data_extraction_queue', () => queue({ R1: 'TODO' }));
    await wrapper.find('[data-testid="data-load-error-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="data-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-extraction-panel"]').exists()).toBe(true);
  });

  it('reports a failed save and stays on the record', async () => {
    ctx.mock.rpc.on('get_data_extraction_queue', () => queue({ R1: 'TODO', R2: 'TODO' }));
    ctx.mock.rpc.onError('save_data_extraction', { message: 'disk full' });
    const errorSpy = vi.spyOn(useNotificationsStore(), 'error');

    const wrapper = await mountPage(ctx);
    await wrapper.find('[data-testid="data-field-input-sample_size"]').setValue('12');
    await wrapper.find('[data-testid="data-save-next-btn"]').trigger('click');
    await flushPromises();

    expect(errorSpy).toHaveBeenCalledWith('Could not save extraction', 'disk full');
    expect(wrapper.find('[data-testid="data-record-id"]').text()).toBe('R1');
    expect(
      wrapper.find('[data-testid="data-save-next-btn"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('keeps "Edit extractions" open after a save and exits with "Done editing"', async () => {
    ctx.mock.rpc.on('get_data_extraction_queue', () => queue({ R1: '10', R2: '20' }));
    ctx.mock.rpc.on('save_data_extraction', (params) => ({
      success: true,
      project_id: 'lit-review',
      record_id: params.record_id as string,
      remaining_count: 0,
      message: 'ok',
    }));

    const wrapper = await mountPage(ctx);
    expect(wrapper.find('[data-testid="data-complete"]').exists()).toBe(true);

    await wrapper.find('[data-testid="data-complete-edit-btn"]').trigger('click');
    expect(wrapper.find('[data-testid="data-record-id"]').text()).toBe('R1');

    await wrapper.find('[data-testid="data-field-input-sample_size"]').setValue('11');
    await wrapper.find('[data-testid="data-save-next-btn"]').trigger('click');
    await flushPromises();

    // Still editing, on the next record — not thrown back to the completion screen.
    expect(wrapper.find('[data-testid="data-complete"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-record-id"]').text()).toBe('R2');

    await wrapper.find('[data-testid="data-finish-editing-btn"]').trigger('click');
    expect(wrapper.find('[data-testid="data-complete"]').exists()).toBe(true);
  });

  it('holds auto-sync while mounted and releases it on unmount', async () => {
    ctx.mock.rpc.on('get_data_extraction_queue', () => queue({ R1: 'TODO' }));
    const sync = useSyncStore();
    expect(sync.isSuspended).toBe(false);

    const wrapper = await mountPage(ctx);
    expect(sync.isSuspended).toBe(true);

    wrapper.unmount();
    expect(sync.isSuspended).toBe(false);
  });
});
