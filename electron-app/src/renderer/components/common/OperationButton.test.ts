/**
 * OperationButton is the single trigger for every long-running write, so its
 * guards are the app's last line of defence against firing an operation twice
 * or firing one on a read-only branch (WP-08 §1).
 *
 * Logic only — no pixel assertions.
 */
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import OperationButton from './OperationButton.vue';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import {
  operationResponse,
  setupRendererTest,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';

let ctx: RendererTestContext;

function mountButton(props: Record<string, unknown> = {}) {
  return mount(OperationButton, {
    props: { operation: 'prep', projectId: TEST_PROJECT_ID, ...props },
  });
}

beforeEach(() => {
  ctx = setupRendererTest();
  ctx.openProject();
  ctx.setGitState({ branch: 'dev' });
});

describe('triggering', () => {
  it('calls the operation with the project id and extra params', async () => {
    ctx.mock.rpc.on('prep', operationResponse('prep'));
    const wrapper = mountButton({ params: { force: true } });

    await wrapper.get('button').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(ctx.mock.rpc.callsTo('prep')[0].params).toMatchObject({
      project_id: TEST_PROJECT_ID,
      force: true,
    });
  });

  it('emits success with the result', async () => {
    ctx.mock.rpc.on('prep', operationResponse('prep'));
    const wrapper = mountButton();

    await wrapper.get('button').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.emitted('success')).toHaveLength(1);
    expect(wrapper.emitted('error')).toBeUndefined();
  });

  it('emits error and notifies when the operation fails', async () => {
    ctx.mock.rpc.onError('prep', { message: 'prep blew up' });
    const notifications = useNotificationsStore();
    const wrapper = mountButton({ label: 'Prepare' });

    await wrapper.get('button').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.emitted('error')).toHaveLength(1);
    expect(notifications.history[notifications.history.length - 1]).toMatchObject({
      type: 'error',
      title: 'Prepare failed',
    });
  });
});

describe('double-fire guards', () => {
  it('sends exactly one RPC for a double click', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.mock.rpc.on('prep', async () => {
      await gate;
      return operationResponse('prep');
    });

    const wrapper = mountButton();
    await wrapper.get('button').trigger('click');
    await wrapper.get('button').trigger('click');

    expect(ctx.mock.rpc.countOf('prep')).toBe(1);
    release();
  });

  it('is disabled while another surface has a writer in flight', async () => {
    const backend = useBackendStore();
    backend.runningOperation = { method: 'search', startedAt: 1 };
    const wrapper = mountButton();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('button').attributes('disabled')).toBeDefined();

    await wrapper.get('button').trigger('click');
    expect(ctx.mock.rpc.countOf('prep')).toBe(0);
  });

  it('is disabled while the backend is not running', async () => {
    useBackendStore().status = 'stopped';
    const wrapper = mountButton();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});

describe('read-only branch', () => {
  beforeEach(() => {
    ctx.setGitState({ branch: 'main' });
  });

  it('renders a locked, disabled button on main and refuses to call', async () => {
    const wrapper = mountButton();
    await wrapper.vm.$nextTick();

    const button = wrapper.get('button');
    expect(button.attributes('disabled')).toBeDefined();

    await button.trigger('click');
    expect(ctx.mock.rpc.countOf('prep')).toBe(0);
  });
});

describe('labels', () => {
  it('falls back to the operation name and swaps to runningLabel in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.mock.rpc.on('prep', async () => {
      await gate;
      return operationResponse('prep');
    });

    const wrapper = mountButton({ runningLabel: 'Preparing…' });
    expect(wrapper.text()).toContain('prep');

    await wrapper.get('button').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Preparing…');

    release();
  });

  it('uses a stable default test id derived from the operation', () => {
    expect(mountButton().get('button').attributes('data-testid')).toBe('run-prep-button');
  });
});
