/**
 * The PDFs page has to respond to a per-record action at the speed of the
 * click, not at the speed of a refresh cycle.
 *
 * Two things used to get in the way: every seam-driven reload swapped the
 * rendered table for a full-panel spinner, and the row only left the "needs
 * upload" list once `get_records` came back. Together that read as a flicker
 * followed by a pause on every single click.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import {
  setupRendererTest,
  makeProjectStatus,
  makeStatusStep,
  statusResponse,
  settingsResponse,
  tasksResponse,
  PIPELINE_OPERATIONS,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { useProjectDataStore } from '@/stores/projectData';
import { useProjectsStore } from '@/stores/projects';
import PdfsPage from './PdfsPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: {
    name: 'StepPageShell',
    template: '<div><slot /></div>',
  },
}));

const NEEDS_UPLOAD = ['RecordA2024', 'RecordB2024'];

function pdfStatus() {
  return makeProjectStatus({
    total_records: 2,
    steps: PIPELINE_OPERATIONS.map((operation) =>
      makeStatusStep(operation, {
        state_counts:
          operation === 'pdf_get'
            ? { rev_prescreen_included: 0, pdf_needs_manual_retrieval: 2 }
            : {},
      }),
    ),
  });
}

function recordsResponse(ids: string[]) {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    records: ids.map((id) => ({
      ID: id,
      title: `Title ${id}`,
      author: 'Author',
      year: '2024',
      colrev_status: 'pdf_needs_manual_retrieval',
    })),
    total: ids.length,
    offset: 0,
    limit: 2000,
  };
}

/** Rows in the upload table, one "not available" button each. */
function rowIds(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-testid^="pdf-not-available-btn-"]')
    .map((el) => el.attributes('data-testid')!.replace('pdf-not-available-btn-', ''));
}

function fullPanelSpinner(wrapper: VueWrapper) {
  return wrapper.findAll('.py-12 .animate-spin');
}

describe('PdfsPage — per-record actions', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc
      .on('get_status', statusResponse(pdfStatus()))
      .on('get_settings', settingsResponse())
      .on('list_managed_review_tasks', (params) => tasksResponse(params.kind))
      .on('get_records', recordsResponse(NEEDS_UPLOAD) as never)
      .on('mark_pdf_not_available', {
        success: true,
        project_id: TEST_PROJECT_ID,
        record_id: NEEDS_UPLOAD[0],
        new_status: 'pdf_not_available',
      } as never);
  });

  async function mountPage(): Promise<VueWrapper> {
    ctx.openProject();
    // The stage machine reads the status payload and nothing else; put the
    // page on the upload stage by giving it records that need uploading.
    useProjectsStore().currentProject!.status = pdfStatus();
    ctx.setGitState({ branch: 'dev' });
    const wrapper = mount(PdfsPage);
    await flushPromises();
    return wrapper;
  }

  it('drops the row as soon as the write succeeds, before the refresh lands', async () => {
    const wrapper = await mountPage();
    expect(rowIds(wrapper)).toEqual(NEEDS_UPLOAD);

    // `get_records` never answers: the row must still go, because the write
    // itself already told us the record's new state.
    ctx.mock.rpc.on('get_records', () => new Promise(() => {}) as never);

    await wrapper.get(`[data-testid="pdf-not-available-btn-${NEEDS_UPLOAD[0]}"]`).trigger('click');
    await flushPromises();

    expect(rowIds(wrapper)).toEqual([NEEDS_UPLOAD[1]]);
  });

  it('keeps the table on screen while a background reload is in flight', async () => {
    const wrapper = await mountPage();
    expect(fullPanelSpinner(wrapper)).toHaveLength(0);

    let release!: () => void;
    ctx.mock.rpc.on(
      'get_records',
      () =>
        new Promise((resolve) => {
          release = () => resolve(recordsResponse([NEEDS_UPLOAD[1]]) as never);
        }) as never,
    );

    // A seam refresh (any writer RPC, anywhere in the app) reloads the list.
    useProjectDataStore().notifyWriteCompleted('mark_pdf_not_available');
    await flushPromises();

    expect(fullPanelSpinner(wrapper)).toHaveLength(0);
    expect(rowIds(wrapper)).toEqual(NEEDS_UPLOAD);

    release();
    await flushPromises();
    expect(rowIds(wrapper)).toEqual([NEEDS_UPLOAD[1]]);
  });
});
