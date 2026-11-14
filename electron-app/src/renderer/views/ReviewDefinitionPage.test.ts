/**
 * The Definition page must only show and save the definition of the project
 * that is open, and must not report criteria edits (which the backend commits
 * as they are made) as unsaved changes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import {
  setupRendererTest,
  reviewDefinitionResponse,
  type RendererTestContext,
} from '@/test/harness';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import ReviewDefinitionPage from './ReviewDefinitionPage.vue';
import InlineCriterionEditor from '@/components/review-definition/InlineCriterionEditor.vue';

type LeaveGuard = (to: unknown, from: unknown, next: (ok?: boolean) => void) => void;
let leaveGuard: LeaveGuard | null = null;

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: LeaveGuard) => {
    leaveGuard = guard;
  },
}));

vi.mock('@/components/layout', () => ({
  StepPageShell: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));

vi.mock('@/components/review-definition', () => ({
  CriteriaList: {
    name: 'CriteriaList',
    props: ['criteria'],
    emits: ['add-criterion'],
    template: '<div data-testid="criteria">{{ Object.keys(criteria).join(",") }}</div>',
  },
}));

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: {
    name: 'RichTextEditor',
    props: ['modelValue', 'disabled'],
    template: '<div data-testid="objectives-textarea">{{ modelValue }}</div>',
  },
}));

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(ReviewDefinitionPage);
  await flushPromises();
  return wrapper;
}

function wouldLeave(): boolean {
  let allowed: boolean | undefined;
  vi.stubGlobal('confirm', vi.fn(() => false));
  leaveGuard!({}, {}, (ok) => {
    allowed = ok ?? true;
  });
  return allowed === true;
}

describe('ReviewDefinitionPage', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    leaveGuard = null;
    ctx = setupRendererTest();
    ctx.openProject();
    ctx.setGitState({ branch: 'dev' });
  });

  it("does not show another project's definition while this one loads", async () => {
    const store = useReviewDefinitionStore();
    store.definition = reviewDefinitionResponse({
      title: 'Project A',
      criteria: { from_a: { explanation: 'A', criterion_type: 'inclusion_criterion' } },
    });
    store.loadedProjectId = 'project-a';
    ctx.mock.rpc.on('get_review_definition', () => new Promise(() => {}) as never);

    const wrapper = await mountPage();

    expect(wrapper.text()).not.toContain('Project A');
    expect(wrapper.get('[data-testid="criteria"]').text()).toBe('');
    expect(wrapper.get('[data-testid="save-definition-btn"]').attributes('disabled')).toBeDefined();
  });

  it("does not seed the form with another project's text when the load fails", async () => {
    const store = useReviewDefinitionStore();
    store.definition = reviewDefinitionResponse({
      title: 'Project A',
      protocol_url: 'https://a.example/protocol',
      objectives: 'A objectives',
    });
    store.loadedProjectId = 'project-a';
    ctx.mock.rpc.on('get_review_definition', () => {
      throw new Error('backend down');
    });

    const wrapper = await mountPage();

    const url = wrapper.get<HTMLInputElement>('[data-testid="protocol-url-input"]');
    expect(url.element.value).toBe('');
    expect(wrapper.get('[data-testid="objectives-textarea"]').text()).toBe('');
    expect(wrapper.get('[data-testid="save-definition-btn"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="definition-load-error"]').text()).toContain('backend down');
    expect(store.definition).toBeNull();
  });

  it('shows this project’s definition once it has loaded', async () => {
    ctx.mock.rpc.on(
      'get_review_definition',
      reviewDefinitionResponse({ title: 'Project B', protocol_url: 'https://b.example' }),
    );
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Project B');
    expect(wrapper.get<HTMLInputElement>('[data-testid="protocol-url-input"]').element.value).toBe(
      'https://b.example',
    );
  });

  it('does not warn about unsaved changes after a criterion was added', async () => {
    ctx.mock.rpc.on('get_review_definition', reviewDefinitionResponse());
    ctx.mock.rpc.on('add_screening_criterion', {
      success: true,
      project_id: 'lit-review',
      operation: 'add_screening_criterion',
      details: {},
    } as never);
    const wrapper = await mountPage();

    wrapper
      .findComponent({ name: 'CriteriaList' })
      .vm.$emit('add-criterion', {
        name: 'adults',
        explanation: 'Adults only',
        criterion_type: 'inclusion_criterion',
      });
    await flushPromises();

    expect(useReviewDefinitionStore().definition?.criteria).toHaveProperty('adults');
    expect(wrapper.text()).not.toContain('Unsaved changes');
    expect(wouldLeave()).toBe(true);
  });

  it('still warns about edited text that was not saved', async () => {
    ctx.mock.rpc.on('get_review_definition', reviewDefinitionResponse());
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="protocol-url-input"]').setValue('https://new.example');

    expect(wrapper.text()).toContain('Unsaved changes');
    expect(wouldLeave()).toBe(false);
  });
});

describe('InlineCriterionEditor — criterion names', () => {
  beforeEach(() => {
    setupRendererTest();
  });

  async function typeName(name: string) {
    const wrapper = mount(InlineCriterionEditor, { props: { mode: 'add' } });
    await wrapper.get('[data-testid="criterion-name-input"]').setValue(name);
    await wrapper
      .get('[data-testid="criterion-explanation-input"]')
      .setValue('Some explanation');
    return wrapper;
  }

  it.each(['age >= 18; adults', 'a;b', 'a=b'])(
    'refuses %j before sending it',
    async (name) => {
      const wrapper = await typeName(name);

      expect(wrapper.get('[data-testid="criterion-name-error"]').text()).toContain("';'");
      expect(wrapper.get('[data-testid="criterion-save-btn"]').attributes('disabled')).toBeDefined();
      await wrapper.get('[data-testid="criterion-save-btn"]').trigger('click');
      expect(wrapper.emitted('save')).toBeUndefined();
    },
  );

  it('accepts a name with spaces and ordinary punctuation', async () => {
    const wrapper = await typeName('Adults (18+), humans only');

    expect(wrapper.find('[data-testid="criterion-name-error"]').exists()).toBe(false);
    await wrapper.get('[data-testid="criterion-save-btn"]').trigger('click');
    expect(wrapper.emitted('save')).toHaveLength(1);
  });
});
