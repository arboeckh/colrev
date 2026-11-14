/**
 * Editing a source offers the same controls that created it.
 *
 * The edit dialog used to expose only a plain text box, so every OpenAlex
 * filter became unreachable the moment the source existed — and because the
 * update only carried the search string, the stored URL (which is what the
 * search actually runs) never moved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    ctx.mock.rpc.on('get_connector_api_key_status', { openalex: true } as never);
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

  describe('API key', () => {
    const updateOk = {
      project_id: TEST_PROJECT_ID,
      success: true,
      operation: 'update_source',
      message: 'ok',
      details: { source: {}, message: 'ok' },
    } as never;

    it('asks for the key of an existing source when the backend has none', async () => {
      ctx.mock.rpc.on('get_connector_api_key_status', { openalex: false } as never);
      ctx.mock.rpc.on('set_connector_api_key', { connector: 'openalex', configured: true } as never);
      ctx.mock.rpc.on('update_source', updateOk);

      const wrapper = await mountCard(openAlexSource());
      const el = await openEditDialog(wrapper);

      const save = () => el.querySelector('[data-testid="confirm-edit-source"]') as HTMLButtonElement;
      expect(save().disabled).toBe(true);

      const key = el.querySelector('[data-testid="edit-api-key-input"]') as HTMLInputElement;
      key.value = 'my-key';
      key.dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
      expect(save().disabled).toBe(false);

      save().click();
      await flushPromises();

      expect(ctx.mock.rpc.callsTo('set_connector_api_key')[0].params).toMatchObject({
        connector: 'openalex',
        api_key: 'my-key',
      });
      expect(ctx.mock.rpc.callsTo('update_source')).toHaveLength(1);
    });

    it('does not ask again when the key is already configured', async () => {
      ctx.mock.rpc.on('get_connector_api_key_status', { openalex: true } as never);

      const wrapper = await mountCard(openAlexSource());
      const el = await openEditDialog(wrapper);

      expect(
        (el.querySelector('[data-testid="confirm-edit-source"]') as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(ctx.mock.rpc.callsTo('set_connector_api_key')).toHaveLength(0);
    });
  });

  describe('replacing the file of an upload source', () => {
    const scopus = {
      endpoint: 'colrev.unknown_source',
      platform: 'colrev.unknown_source',
      search_type: 'DB',
      filename: 'data/search/scopus.ris',
      search_results_path: 'data/search/scopus.ris',
      search_string: 'TITLE(x)',
      record_count: 3,
      is_stale: false,
      last_run_timestamp: '2025-01-01T00:00:00Z',
    } as SearchSource;

    it('sends the file bytes unchanged, as base64', async () => {
      ctx.mock.rpc.on('upload_search_file', {
        project_id: TEST_PROJECT_ID,
        success: true,
        path: 'data/search/scopus.ris',
        detected_format: 'ris',
        message: 'ok',
      } as never);
      ctx.mock.rpc.on('update_source', {
        project_id: TEST_PROJECT_ID,
        success: true,
        operation: 'update_source',
        message: 'ok',
        details: { source: {}, message: 'ok' },
      } as never);

      const wrapper = await mountCard(scopus);
      await wrapper.get('[data-testid="update-source-scopus"]').trigger('click');
      await flushPromises();

      const latin1 = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // "Müller" in Latin-1
      const input = dialog().querySelector('[data-testid="update-file-input"]') as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [new File([latin1], 'export.ris')],
        configurable: true,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flushPromises();

      (dialog().querySelector('[data-testid="confirm-update-file"]') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(ctx.mock.rpc.callsTo('upload_search_file')).toHaveLength(1));

      const { params } = ctx.mock.rpc.callsTo('upload_search_file')[0];
      expect(params.encoding).toBe('base64');
      expect(params.filename).toBe('scopus.ris');
      expect(Array.from(Buffer.from(String(params.content), 'base64'))).toEqual(Array.from(latin1));
    });
  });
});
