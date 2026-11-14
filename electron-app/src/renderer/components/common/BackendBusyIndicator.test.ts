/**
 * The busy indicator makes the serial backend queue visible and is the way out
 * of a hung call. Fake timers drive the "waiting more than a couple of seconds"
 * threshold.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackendBusyIndicator from './BackendBusyIndicator.vue';
import { useBackendStore } from '@/stores/backend';
import { setupRendererTest, type RendererTestContext } from '@/test/harness';

let ctx: RendererTestContext;

beforeEach(async () => {
  vi.useFakeTimers();
  ctx = setupRendererTest();
  await useBackendStore().start();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('BackendBusyIndicator', () => {
  it('stays quiet for a fast call, then names the slow one and the queue', async () => {
    const wrapper = mount(BackendBusyIndicator);
    ctx.mock.emitRpcQueue({
      inFlight: { method: 'search', startedAt: 1 },
      queued: ['get_status', 'get_git_status'],
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.find('[data-testid="backend-busy-indicator"]').exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.get('[data-testid="backend-busy-working-on"]').text()).toContain(
      'Waiting on: search',
    );
    expect(wrapper.get('[data-testid="backend-busy-queued"]').text()).toContain('2 calls');
  });

  it('disappears when the call finishes', async () => {
    const wrapper = mount(BackendBusyIndicator);
    ctx.mock.emitRpcQueue({ inFlight: { method: 'search', startedAt: 1 }, queued: [] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find('[data-testid="backend-busy-indicator"]').exists()).toBe(true);

    ctx.mock.emitRpcQueue({ inFlight: null, queued: [] });
    await flushPromises();
    expect(wrapper.find('[data-testid="backend-busy-indicator"]').exists()).toBe(false);
  });

  it('asks for confirmation before restarting, then restarts', async () => {
    const backend = useBackendStore();
    const restart = vi.spyOn(backend, 'restart').mockResolvedValue(true);
    const wrapper = mount(BackendBusyIndicator, { attachTo: document.body });
    ctx.mock.emitRpcQueue({ inFlight: { method: 'search', startedAt: 1 }, queued: [] });
    await vi.advanceTimersByTimeAsync(3000);

    await wrapper.get('[data-testid="backend-restart-button"]').trigger('click');
    await flushPromises();
    expect(restart).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[data-testid="backend-restart-dialog"]');
    expect(dialog?.textContent).toContain('will be interrupted');

    document.body
      .querySelector<HTMLButtonElement>('[data-testid="backend-restart-confirm"]')!
      .click();
    await flushPromises();
    expect(restart).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('does not restart when the confirmation is cancelled', async () => {
    const backend = useBackendStore();
    const restart = vi.spyOn(backend, 'restart').mockResolvedValue(true);
    const wrapper = mount(BackendBusyIndicator, { attachTo: document.body });
    ctx.mock.emitRpcQueue({ inFlight: { method: 'search', startedAt: 1 }, queued: [] });
    await vi.advanceTimersByTimeAsync(3000);

    await wrapper.get('[data-testid="backend-restart-button"]').trigger('click');
    await flushPromises();
    const cancel = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!;
    cancel.click();
    await flushPromises();
    expect(restart).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
