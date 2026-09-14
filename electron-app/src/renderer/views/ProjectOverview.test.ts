/**
 * The Overview of a review with no records offers a get-started checklist:
 * define the review, then add a search source. The header CTA follows it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import {
  setupRendererTest,
  reviewDefinitionResponse,
  makeProjectStatus,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { useProjectsStore } from '@/stores/projects';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import ProjectOverview from './ProjectOverview.vue';

const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: {
    name: 'StepPageShell',
    props: ['nextOverride', 'nextLabel'],
    template:
      '<div><span data-testid="cta" :data-route="nextOverride">{{ nextLabel }}</span><slot /></div>',
  },
}));

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(ProjectOverview);
  await flushPromises();
  return wrapper;
}

describe('ProjectOverview — get started', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    push.mockReset();
    ctx = setupRendererTest();
    ctx.openProject();
    ctx.setGitState({ branch: 'dev' });
  });

  it('leads with the definition while it is still blank', async () => {
    ctx.mock.rpc.on('get_review_definition', reviewDefinitionResponse());
    const wrapper = await mountPage();

    const step = wrapper.get('[data-testid="overview-step-definition"]');
    expect(step.attributes('data-state')).toBe('empty');
    expect(wrapper.get('[data-testid="cta"]').text()).toBe('Start with Definition');
    expect(wrapper.get('[data-testid="cta"]').attributes('data-route')).toBe(
      `/project/${TEST_PROJECT_ID}/review-definition`,
    );

    await wrapper.get('[data-testid="overview-define-review"]').trigger('click');
    expect(push).toHaveBeenCalledWith(`/project/${TEST_PROJECT_ID}/review-definition`);
  });

  it('keeps search reachable before the definition is written', async () => {
    ctx.mock.rpc.on('get_review_definition', reviewDefinitionResponse());
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="overview-add-first-source"]').trigger('click');
    expect(push).toHaveBeenCalledWith(`/project/${TEST_PROJECT_ID}/search`);
  });

  it('moves on to search once the definition has content', async () => {
    ctx.mock.rpc.on(
      'get_review_definition',
      reviewDefinitionResponse({ objectives: '<p>Does X improve Y?</p>' }),
    );
    const wrapper = await mountPage();

    expect(
      wrapper.get('[data-testid="overview-step-definition"]').attributes('data-state'),
    ).toBe('defined');
    expect(wrapper.get('[data-testid="cta"]').text()).toBe('Start with Search');
  });

  it("does not show another project's definition as this one's", async () => {
    // Left over from the previously opened project; this project's load never
    // lands.
    const store = useReviewDefinitionStore();
    store.definition = reviewDefinitionResponse({ objectives: '<p>Old review</p>' });
    store.loadedProjectId = 'another-review';
    ctx.mock.rpc.on('get_review_definition', () => new Promise(() => {}) as never);

    const wrapper = await mountPage();

    expect(
      wrapper.get('[data-testid="overview-step-definition"]').attributes('data-state'),
    ).toBe('unknown');
    expect(wrapper.get('[data-testid="cta"]').text()).toBe('');
  });

  it('hides the checklist once the review has records', async () => {
    ctx.mock.rpc.on('get_review_definition', reviewDefinitionResponse());
    useProjectsStore().currentProject!.status = makeProjectStatus({ total_records: 12 });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="overview-get-started"]').exists()).toBe(false);
  });
});
