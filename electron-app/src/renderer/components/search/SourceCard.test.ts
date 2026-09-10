/**
 * Editing a source offers the same controls that created it.
 *
 * The edit dialog used to expose only a plain text box, so every OpenAlex
 * filter became unreachable the moment the source existed — and because the
 * update only carried the search string, the stored URL (which is what the
 * search actually runs) never moved.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';
import SourceCard from './SourceCard.vue';
import type { SearchSource } from '@/types';

const OPEN_ALEX_PATH = 'data/search/open_alex.bib';

function openAlexSource(overrides: Partial<SearchSource> = {}): SearchSource {
  return {
    endpoint: 'colrev.open_alex',
    platform: 'colrev.open_alex',
    search_type: 'API',
    filename: OPEN_ALEX_PATH,
    search_results_path: OPEN_ALEX_PATH,
    search_string: 'sotatercept',
    search_parameters: {
      url: 'https://api.openalex.org/works?filter=...',
      query: {
        search: 'sotatercept',
        year_from: 2021,
        open_access_only: true,
        work_types: ['article'],
        sort: 'citations',
        min_citations: 5,
        language: 'en',
        has_abstract: true,
        search_exact: false,
        raw_url: null,
      },
    },
    record_count: 10,
    is_stale: false,
    last_run_timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  } as SearchSource;
}

async function mountCard(source: SearchSource): Promise<VueWrapper> {
  const wrapper = mount(SourceCard, {
    props: { source, projectId: TEST_PROJECT_ID },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** Dialogs teleport to body, so query the document rather than the wrapper. */
function dialog(): HTMLElement {
  const el = document.querySelector('[role="dialog"]');
  if (!el) throw new Error('no dialog rendered');
  return el as HTMLElement;
}

async function openEditDialog(wrapper: VueWrapper): Promise<HTMLElement> {
  await wrapper.get('[data-testid="edit-source-open_alex"]').trigger('click');
  await flushPromises();
  return dialog();
}

describe('SourceCard', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject();
    document.body.innerHTML = '';
  });

  it('names the source the way the database does', async () => {
    const wrapper = await mountCard(openAlexSource());
    expect(wrapper.text()).toContain('OpenAlex');
    expect(wrapper.text()).not.toContain('open_alex');
  });

  it('opens the edit dialog on every option the source carries', async () => {
    const wrapper = await mountCard(openAlexSource());
    const el = await openEditDialog(wrapper);

    const value = (testId: string) =>
      (el.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null)?.value;
    const checked = (testId: string) =>
      (el.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null)?.checked;

    expect(value('search-query-input')).toBe('sotatercept');
    expect(value('query-year-from')).toBe('2021');
    expect(value('query-work-types')).toBe('article');
    expect(value('query-sort-order')).toBe('citations');
    expect(checked('query-open-access')).toBe(true);
  });

  it('sends the filters alongside the query so the stored URL is rebuilt', async () => {
    ctx.mock.rpc.on('update_source', {
      project_id: TEST_PROJECT_ID,
      success: true,
      operation: 'update_source',
      message: 'ok',
      details: { source: {}, message: 'ok' },
    } as never);

    const wrapper = await mountCard(openAlexSource());
    const el = await openEditDialog(wrapper);

    const input = el.querySelector('[data-testid="search-query-input"]') as HTMLTextAreaElement;
    input.value = 'macitentan';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    (el.querySelector('[data-testid="confirm-edit-source"]') as HTMLButtonElement).click();
    await flushPromises();

    const [call] = ctx.mock.rpc.callsTo('update_source');
    expect(call.params.search_string).toBe('macitentan');
    expect(call.params.search_parameters).toMatchObject({
      query: {
        search: 'macitentan',
        // Untouched filters ride along; dropping them would silently widen
        // the search on every edit.
        year_from: 2021,
        open_access_only: true,
        work_types: ['article'],
        sort: 'citations',
      },
    });
  });

  it('reports its own run state rather than a shared one', async () => {
    const wrapper = mount(SourceCard, {
      props: {
        source: openAlexSource(),
        projectId: TEST_PROJECT_ID,
        runState: 'searching' as const,
      },
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="search-status-open_alex"]').text()).toContain(
      'Searching OpenAlex',
    );

    await wrapper.setProps({ runState: 'queued' as const });
    expect(wrapper.get('[data-testid="search-status-open_alex"]').text()).toBe('Queued');
  });

  it('prefers the backend status line for its own source when there is one', async () => {
    const wrapper = mount(SourceCard, {
      props: {
        source: openAlexSource(),
        projectId: TEST_PROJECT_ID,
        runState: 'searching' as const,
        progressMessage: 'Searching colrev.open_alex:API',
      },
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="search-status-open_alex"]').text()).toContain(
      'Searching colrev.open_alex:API',
    );
  });
});
