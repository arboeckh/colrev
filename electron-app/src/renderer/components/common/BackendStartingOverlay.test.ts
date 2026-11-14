/**
 * The overlay is the only sign that the backend is coming up (or coming back):
 * it must show for starting and restarting, and must not sit over a backend
 * that failed — that state has a Retry.
 */
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import BackendStartingOverlay from './BackendStartingOverlay.vue';
import { useBackendStore } from '@/stores/backend';
import { setupRendererTest } from '@/test/harness';

beforeEach(() => {
  setupRendererTest();
});

describe('BackendStartingOverlay', () => {
  it('shows while starting', () => {
    useBackendStore().status = 'starting';
    const wrapper = mount(BackendStartingOverlay);
    expect(wrapper.find('[data-testid="backend-starting-overlay"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="backend-overlay-title"]').text()).toBe('Starting CoLRev');
  });

  it('shows while restarting, with its own wording', () => {
    useBackendStore().status = 'restarting';
    const wrapper = mount(BackendStartingOverlay);
    expect(wrapper.find('[data-testid="backend-starting-overlay"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="backend-overlay-title"]').text()).toContain('Restarting');
  });

  it.each(['stopped', 'error', 'running'] as const)('is absent when %s', (status) => {
    useBackendStore().status = status;
    const wrapper = mount(BackendStartingOverlay);
    expect(wrapper.find('[data-testid="backend-starting-overlay"]').exists()).toBe(false);
  });
});
