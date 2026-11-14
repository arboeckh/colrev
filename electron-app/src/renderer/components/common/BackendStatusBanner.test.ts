import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackendStatusBanner from './BackendStatusBanner.vue';
import { useBackendStore } from '@/stores/backend';
import { setupRendererTest, type RendererTestContext } from '@/test/harness';

let ctx: RendererTestContext;

beforeEach(() => {
  ctx = setupRendererTest();
});

describe('BackendStatusBanner', () => {
  it('stays hidden before the first start attempt', () => {
    const wrapper = mount(BackendStatusBanner);
    expect(wrapper.find('[data-testid="backend-status-banner"]').exists()).toBe(false);
  });

  it('stays hidden while the backend runs', async () => {
    await useBackendStore().start();
    const wrapper = mount(BackendStatusBanner);
    expect(wrapper.find('[data-testid="backend-status-banner"]').exists()).toBe(false);
  });

  it('shows the failure and a Retry that starts the backend again', async () => {
    const backend = useBackendStore();
    ctx.mock.colrev.start = vi.fn(async () => ({ success: false, error: 'python missing' }));
    await backend.start();
    const wrapper = mount(BackendStatusBanner);

    expect(wrapper.get('[data-testid="backend-status-banner-error"]').text()).toContain(
      'python missing',
    );

    ctx.mock.colrev.start = vi.fn(async () => ({ success: true }));
    await wrapper.get('[data-testid="backend-retry-button"]').trigger('click');
    await flushPromises();

    expect(ctx.mock.colrev.start).toHaveBeenCalledTimes(1);
    expect(backend.isRunning).toBe(true);
    expect(wrapper.find('[data-testid="backend-status-banner"]').exists()).toBe(false);
  });

  it('shows when the backend exited and was not restarted', async () => {
    await useBackendStore().start();
    ctx.mock.emitClose(1);
    const wrapper = mount(BackendStatusBanner);
    expect(wrapper.find('[data-testid="backend-status-banner"]').exists()).toBe(true);
  });
});
