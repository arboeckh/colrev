/**
 * StepPageShell wraps every workflow page, so its header is where a wrong
 * step-status derivation becomes visible to the user (WP-08 §1).
 *
 * `lib/stepStatus` and `lib/stepPageShell` cover the pure derivations; this
 * covers the wiring — that the circle reflects the *store's* status for this
 * step and that Next routes where the derivation says.
 */
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import StepPageShell from './StepPageShell.vue';
import { useProjectsStore } from '@/stores/projects';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';

let ctx: RendererTestContext;
const push = vi.fn();

const PageHelp = defineComponent({ render: () => h('p', 'help text') });

// `watch(route, ...)` needs a reactive source, so mirror what vue-router
// actually hands the component.
const route = reactive({ meta: { title: 'Prescreen' } });

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}));

function mountShell(props: Record<string, unknown> = {}) {
  return mount(StepPageShell, {
    props: { step: 'prescreen', subtitle: 'Decide what to read', pageHelp: PageHelp, ...props },
    global: { stubs: { Sheet: true, SheetContent: true } },
  });
}

beforeEach(() => {
  ctx = setupRendererTest();
  ctx.openProject();
  push.mockClear();
});

describe('status circle', () => {
  it('renders the status the projects store derives for this step', async () => {
    const projects = useProjectsStore();
    vi.spyOn(projects, 'getStepStatus').mockReturnValue('complete');

    const wrapper = mountShell();

    const circle = wrapper.get('[data-testid="step-status-circle"]');
    expect(circle.attributes('data-step-status')).toBe('complete');
  });

  it('omits the circle entirely for a page that owns no workflow step', () => {
    const wrapper = mountShell({ step: null });
    expect(wrapper.find('[data-testid="step-status-circle"]').exists()).toBe(false);
  });
});

describe('next navigation', () => {
  it('routes to the next workflow step for the open project', async () => {
    const wrapper = mountShell();
    await wrapper.get('[data-testid="next-button"]').trigger('click');
    expect(push).toHaveBeenCalledWith(`/project/${TEST_PROJECT_ID}/pdfs`);
  });

  it('honours an explicit override', async () => {
    const wrapper = mountShell({ nextOverride: 'screen', nextLabel: 'To screening' });
    expect(wrapper.get('[data-testid="next-button"]').text()).toContain('To screening');

    await wrapper.get('[data-testid="next-button"]').trigger('click');
    expect(push).toHaveBeenCalledWith(`/project/${TEST_PROJECT_ID}/screen`);
  });

  it('hides Next when there is nowhere to go', () => {
    const wrapper = mountShell({ step: null });
    expect(wrapper.find('[data-testid="next-button"]').exists()).toBe(false);
  });
});

describe('header copy', () => {
  it('takes the title from the route and the subtitle from the prop', () => {
    const wrapper = mountShell({ subtitle: 'Decide what to read' });
    expect(wrapper.get('[data-testid="page-title"]').text()).toBe('Prescreen');
    expect(wrapper.get('[data-testid="page-subtitle"]').text()).toBe('Decide what to read');
  });
});
