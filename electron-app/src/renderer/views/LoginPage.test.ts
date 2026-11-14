/**
 * "Add account" opens the sign-in page on top of an authenticated session.
 * It must have a way back, and leaving must stop the device flow so a late
 * approval in the browser cannot add an account silently.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { setupRendererTest, type RendererTestContext } from '@/test/harness';
import { useAuthStore } from '@/stores/auth';
import LoginPage from './LoginPage.vue';

let ctx: RendererTestContext;

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div data-testid="home" />' } },
      { path: '/login', component: LoginPage },
    ],
  });
}

async function mountLogin(query = '') {
  const router = makeRouter();
  await router.push('/');
  await router.push(`/login${query}`);
  const wrapper = mount(LoginPage, { global: { plugins: [router] } });
  await flushPromises();
  return { router, wrapper };
}

beforeEach(() => {
  ctx = setupRendererTest();
});

describe('LoginPage — cancel', () => {
  it('Back cancels the device flow and returns to the previous page when adding an account', async () => {
    const { router, wrapper } = await mountLogin('?addAccount=1');
    expect(ctx.mock.auth.login).toHaveBeenCalledTimes(1); // auto-started

    const auth = useAuthStore();
    auth.deviceFlowStatus = { status: 'polling', userCode: 'ABCD-1234', verificationUri: 'x' };
    await flushPromises();

    await wrapper.get('[data-testid="login-cancel-button"]').trigger('click');
    await flushPromises();

    expect(ctx.mock.auth.cancelLogin).toHaveBeenCalledTimes(1);
    expect(auth.deviceFlowStatus).toBeNull();
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('offers Back on the expired screen when adding an account', async () => {
    const { router, wrapper } = await mountLogin('?addAccount=1');
    const auth = useAuthStore();
    auth.deviceFlowStatus = { status: 'expired' };
    await flushPromises();

    expect(wrapper.find('[data-testid="login-github-button"]').exists()).toBe(true);
    await wrapper.get('[data-testid="login-cancel-button"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/');
  });

  it('a fresh sign-in shows Cancel, which stops the flow and stays on the page', async () => {
    const { router, wrapper } = await mountLogin();
    const auth = useAuthStore();
    auth.deviceFlowStatus = { status: 'polling', userCode: 'ABCD-1234', verificationUri: 'x' };
    await flushPromises();

    await wrapper.get('[data-testid="login-cancel-button"]').trigger('click');
    await flushPromises();

    expect(ctx.mock.auth.cancelLogin).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/login');
    expect(wrapper.find('[data-testid="login-github-button"]').exists()).toBe(true);
  });

  it('leaving the page mid-flow cancels the device flow', async () => {
    const { wrapper } = await mountLogin('?addAccount=1');
    const auth = useAuthStore();
    auth.deviceFlowStatus = { status: 'polling', userCode: 'ABCD-1234', verificationUri: 'x' };
    await flushPromises();

    wrapper.unmount();
    await flushPromises();

    expect(ctx.mock.auth.cancelLogin).toHaveBeenCalledTimes(1);
  });

  it('leaving after the flow finished does not cancel anything', async () => {
    const { wrapper } = await mountLogin('?addAccount=1');
    const auth = useAuthStore();
    auth.deviceFlowStatus = { status: 'success' };
    await flushPromises();

    wrapper.unmount();
    expect(ctx.mock.auth.cancelLogin).not.toHaveBeenCalled();
  });
});
