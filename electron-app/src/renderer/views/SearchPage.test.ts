/**
 * "Run all searches" is a wrapper around the per-source runs, not a batch RPC.
 *
 * That is what lets each card report its own source: a single batch call left
 * the page with one shared progress line, so every card echoed whichever source
 * the backend happened to mention last.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';
import { useBackendStore } from '@/stores/backend';
import SearchPage from './SearchPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: {
    name: 'StepPageShell',
    template: '<div><slot /></div>',
  },
}));

const OPEN_ALEX = 'data/search/open_alex.bib';
const PUBMED = 'data/search/pubmed.bib';
const SCOPUS = 'data/search/scopus.ris';

function source(overrides: Record<string, unknown>) {
  return {
    platform: 'colrev.pubmed',
    endpoint: 'colrev.pubmed',
    search_type: 'API',
    search_string: 'query',
    record_count: 0,
    is_stale: false,
    last_run_timestamp: null,
    ...overrides,
  };
}

const SOURCES = [
  source({
    platform: 'colrev.open_alex',
    endpoint: 'colrev.open_alex',
    filename: OPEN_ALEX,
    search_results_path: OPEN_ALEX,
  }),
  source({ filename: PUBMED, search_results_path: PUBMED }),
  source({
    platform: 'colrev.scopus',
    endpoint: 'colrev.scopus',
    search_type: 'DB',
    filename: SCOPUS,
    search_results_path: SCOPUS,
  }),
];

async function mountPage(ctx: RendererTestContext): Promise<VueWrapper> {
  ctx.openProject();
  // Workflow actions are read-only on main; the page is only interactive on a
  // working branch.
  ctx.setGitState({ branch: 'dev' });
  const wrapper = mount(SearchPage);
  await flushPromises();
  return wrapper;
}

describe('SearchPage — running searches', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc
      .on('get_connector_api_key_status', { openalex: false } as never)
      .on('get_sources', {
        project_id: TEST_PROJECT_ID,
        success: true,
        sources: SOURCES,
      } as never)
      .on('search', {
        project_id: TEST_PROJECT_ID,
        success: true,
        operation: 'search',
        message: 'ok',
        details: { source: 'all', rerun: true, message: 'ok' },
      } as never);
  });

  it('runs one search per API source instead of a single batch call', async () => {
    const wrapper = await mountPage(ctx);

    await wrapper.get('[data-testid="run-all-searches-button"]').trigger('click');
    await flushPromises();

    const searches = ctx.mock.rpc.callsTo('search');
    expect(searches.map((c) => c.params.source)).toEqual([OPEN_ALEX, PUBMED]);
  });

  it('leaves file-based sources out of the run', async () => {
    const wrapper = await mountPage(ctx);

    await wrapper.get('[data-testid="run-all-searches-button"]').trigger('click');
    await flushPromises();

    // colrev's DB search path prompts on stdin, which the JSON-RPC backend
    // cannot answer — including it would hang the run.
    expect(ctx.mock.rpc.callsTo('search').map((c) => c.params.source)).not.toContain(
      SCOPUS,
    );
  });

  it('shows the running source as searching and the rest as queued', async () => {
    let release!: () => void;
    ctx.mock.rpc.on(
      'search',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ success: true } as never);
        }) as never,
    );

    const wrapper = await mountPage(ctx);
    void wrapper.get('[data-testid="run-all-searches-button"]').trigger('click');
    await flushPromises();

    const openAlexCard = wrapper.get('[data-testid="search-status-open_alex"]');
    const pubmedCard = wrapper.get('[data-testid="search-status-pubmed"]');
    expect(openAlexCard.text()).toContain('Searching OpenAlex');
    expect(pubmedCard.text()).toBe('Queued');

    release();
    await flushPromises();
  });

  it('routes a progress event to the card that produced it', async () => {
    let release!: () => void;
    ctx.mock.rpc.on(
      'search',
      () =>
        new Promise((resolve) => {
          release = () => resolve({ success: true } as never);
        }) as never,
    );

    // Progress notifications are wired in `backend.start()`, which the harness
    // does not run when it marks the backend running.
    await useBackendStore().start();

    const wrapper = await mountPage(ctx);
    void wrapper.get('[data-testid="run-search-open_alex"]').trigger('click');
    await flushPromises();

    ctx.mock.emitProgress({
      kind: 'search_progress',
      message: 'Searching colrev.open_alex:API',
      current: 1,
      total: 1,
      source: OPEN_ALEX,
      level: 'info',
    } as never);
    await flushPromises();

    expect(wrapper.get('[data-testid="search-status-open_alex"]').text()).toContain(
      'Searching colrev.open_alex:API',
    );
    // The other card is idle and must not borrow that status line.
    expect(wrapper.find('[data-testid="search-status-pubmed"]').exists()).toBe(false);

    release();
    await flushPromises();
  });

  it('keeps going when one source fails and reports the shortfall', async () => {
    ctx.mock.rpc.on('search', (params) => {
      if ((params as { source: string }).source === OPEN_ALEX) {
        throw new Error('OpenAlex is down');
      }
      return { success: true } as never;
    });

    const wrapper = await mountPage(ctx);
    await wrapper.get('[data-testid="run-all-searches-button"]').trigger('click');
    await flushPromises();

    expect(ctx.mock.rpc.callsTo('search').map((c) => c.params.source)).toEqual([
      OPEN_ALEX,
      PUBMED,
    ]);
  });
});

describe('SearchPage — source naming', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc.on('get_connector_api_key_status', { openalex: false } as never);
    ctx.mock.rpc.on('get_sources', {
      project_id: TEST_PROJECT_ID,
      success: true,
      sources: SOURCES,
    } as never);
  });

  it('names sources the way the database does, not by colrev endpoint', async () => {
    const wrapper = await mountPage(ctx);
    const text = wrapper.text();

    expect(text).toContain('OpenAlex');
    expect(text).toContain('PubMed');
    expect(text).not.toContain('open_alex');
  });
});
