/**
 * AppLayout owns opening a review: the load, the git initialisation, and what
 * the user sees when either does not happen. None of these may end on a blank
 * shell, a spinner, or an error with no way forward.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import {
  branchDeltaResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useProjectsStore } from '@/stores/projects';
import AppLayout from './AppLayout.vue';

const route = reactive<{ params: Record<string, string> }>({ params: {} });
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./Header.vue', () => ({ default: { template: '<header />' } }));
vi.mock('./Sidebar.vue', () => ({ default: { template: '<nav data-testid="sidebar" />' } }));
vi.mock('@/components/common/SyncStatusBanner.vue', () => ({ default: { template: '<i />' } }));
vi.mock('@/components/common/ReviewerBranchBanner.vue', () => ({ default: { template: '<i />' } }));

let ctx: RendererTestContext;

function stubReads(): void {
  ctx.mock.rpc
    .on('get_status', statusResponse())
    .on('get_settings', settingsResponse())
    .on('get_branch_delta', branchDeltaResponse())
    .on('list_managed_review_tasks', (p) => tasksResponse(p.kind));
}

async function mountLayout(): Promise<VueWrapper> {
  const wrapper = mount(AppLayout, { slots: { default: '<div data-testid="page" />' } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  ctx = setupRendererTest();
  route.params = { id: TEST_PROJECT_ID };
  stubReads();
  ctx.setGitState({ branch: 'dev' });
});

describe('opening a review', () => {
  it('loads it and initialises git', async () => {
    useBackendStore().status = 'running';
    const init = vi.spyOn(useGitStore(), 'initialize');

    const wrapper = await mountLayout();

    // The first open imports modules lazily, so wait for the whole sequence.
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    expect(useProjectsStore().currentProject?.id).toBe(TEST_PROJECT_ID);
    expect(wrapper.find('[data-testid="page"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('loads it again after leaving the project layout and coming back (sign-out, sign-in)', async () => {
    useBackendStore().status = 'running';
    const init = vi.spyOn(useGitStore(), 'initialize');

    (await mountLayout()).unmount();
    // The id must not survive the layout, or reopening it looks "already loaded".
    expect(useProjectsStore().currentProjectId).toBeNull();

    const wrapper = await mountLayout();
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(2));
    expect(useProjectsStore().currentProject?.id).toBe(TEST_PROJECT_ID);
    wrapper.unmount();
  });

  it('loads it once the backend is running when it was down at mount', async () => {
    const backend = useBackendStore();
    backend.status = 'restarting';

    const wrapper = await mountLayout();
    expect(useProjectsStore().currentProject).toBeNull();

    backend.status = 'running';
    await flushPromises();

    expect(useProjectsStore().currentProject?.id).toBe(TEST_PROJECT_ID);
    expect(wrapper.find('[data-testid="sidebar"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="page"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('a failed load', () => {
  it('offers Retry, which opens the review once the backend answers', async () => {
    useBackendStore().status = 'running';
    ctx.mock.rpc.on('get_status', () => {
      throw new Error('backend crashed');
    });

    const wrapper = await mountLayout();
    expect(wrapper.text()).toContain('Failed to load review');
    expect(wrapper.find('[data-testid="page"]').exists()).toBe(false);

    stubReads();
    await wrapper.get('[data-testid="project-load-retry"]').trigger('click');
    await flushPromises();

    expect(useProjectsStore().currentProject?.id).toBe(TEST_PROJECT_ID);
    expect(useProjectsStore().projectError).toBeNull();
    expect(wrapper.find('[data-testid="page"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('retries by itself when the backend comes back', async () => {
    const backend = useBackendStore();
    backend.status = 'running';
    ctx.mock.rpc.on('get_status', () => {
      throw new Error('backend crashed');
    });
    const wrapper = await mountLayout();
    expect(useProjectsStore().projectError).toBeTruthy();

    stubReads();
    backend.status = 'restarting';
    await flushPromises();
    backend.status = 'running';
    await flushPromises();

    expect(useProjectsStore().currentProject?.id).toBe(TEST_PROJECT_ID);
    wrapper.unmount();
  });

  it('is retried by the header Refresh through a reload request', async () => {
    useBackendStore().status = 'running';
    ctx.mock.rpc.on('get_status', () => {
      throw new Error('backend crashed');
    });
    const wrapper = await mountLayout();

    stubReads();
    useProjectsStore().requestReload();
    await flushPromises();

    expect(useProjectsStore().currentProject?.id).toBe(TEST_PROJECT_ID);
    wrapper.unmount();
  });
});
