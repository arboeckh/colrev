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

// -- every record reachable, uploads retryable, concurrent uploads ----------

function pagedResponse(ids: string[], offset: number, hasMore: boolean) {
  return {
    ...recordsResponse(ids),
    offset,
    limit: 500,
    pagination: { offset, limit: 500, has_more: hasMore },
  };
}

async function pickFile(wrapper: VueWrapper, recordId: string, name = 'paper.pdf') {
  await wrapper.get(`[data-testid="pdf-upload-btn-${recordId}"]`).trigger('click');
  await choosePickedFile(wrapper, name);
}

async function choosePickedFile(wrapper: VueWrapper, name = 'paper.pdf') {
  const input = wrapper.get('[data-testid="pdf-file-input"]');
  Object.defineProperty(input.element, 'files', {
    value: [new File(['%PDF-1.4'], name, { type: 'application/pdf' })],
    configurable: true,
  });
  await input.trigger('change');
}

/** The file is read with a FileReader (a macrotask), so `flushPromises` alone is not enough. */
async function untilUploadCalls(ctx: RendererTestContext, count: number) {
  await vi.waitFor(() => expect(ctx.mock.rpc.countOf('upload_pdf')).toBe(count));
  await flushPromises();
}

describe('PdfsPage — loading, retry and concurrent uploads', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc
      .on('get_status', statusResponse(pdfStatus()))
      .on('get_settings', settingsResponse())
      .on('list_managed_review_tasks', (params) => tasksResponse(params.kind))
      .on('get_records', recordsResponse(NEEDS_UPLOAD) as never);
  });

  async function mountPage(): Promise<VueWrapper> {
    ctx.openProject();
    useProjectsStore().currentProject!.status = pdfStatus();
    ctx.setGitState({ branch: 'dev' });
    const wrapper = mount(PdfsPage);
    await flushPromises();
    return wrapper;
  }

  it('pages through get_records until has_more is false', async () => {
    const first = Array.from({ length: 500 }, (_, i) => `First${i}`);
    ctx.mock.rpc.on('get_records', ((params: { pagination: { offset: number } }) =>
      params.pagination.offset === 0
        ? pagedResponse(first, 0, true)
        : pagedResponse(['Beyond500'], 500, false)) as never);

    const wrapper = await mountPage();

    const offsets = ctx.mock.rpc
      .callsTo('get_records')
      .map((c) => (c.params as { pagination: { offset: number; limit: number } }).pagination);
    expect(offsets).toEqual([
      { offset: 0, limit: 500 },
      { offset: 500, limit: 500 },
    ]);
    expect(rowIds(wrapper)).toContain('Beyond500');
  }, 30_000);

  it('turns a failed upload into a Retry button that can be used again', async () => {
    ctx.mock.rpc.onError('upload_pdf', { message: 'disk full' });
    const wrapper = await mountPage();

    await pickFile(wrapper, NEEDS_UPLOAD[0]);
    await untilUploadCalls(ctx, 1);

    const retry = wrapper.get(`[data-testid="pdf-upload-btn-${NEEDS_UPLOAD[0]}"]`);
    expect(retry.attributes('disabled')).toBeUndefined();
    expect(retry.text()).toContain('Retry');

    ctx.mock.rpc.on('upload_pdf', {
      success: true,
      project_id: TEST_PROJECT_ID,
      record_id: NEEDS_UPLOAD[0],
      file_path: 'data/pdfs/RecordA2024.pdf',
      new_status: 'pdf_imported',
      prep_status: 'pdf_prepared',
    } as never);
    await pickFile(wrapper, NEEDS_UPLOAD[0]);
    await untilUploadCalls(ctx, 2);

    expect(ctx.mock.rpc.countOf('upload_pdf')).toBe(2);
    // The retry went through: the record left the needs-upload list.
    expect(rowIds(wrapper)).toEqual([NEEDS_UPLOAD[1]]);
  });

  it('uploads for B even while A is still in flight', async () => {
    const resolvers: Record<string, () => void> = {};
    ctx.mock.rpc.on('upload_pdf', ((params: { record_id: string }) =>
      new Promise((resolve) => {
        resolvers[params.record_id] = () =>
          resolve({
            success: true,
            project_id: TEST_PROJECT_ID,
            record_id: params.record_id,
            file_path: `data/pdfs/${params.record_id}.pdf`,
            new_status: 'pdf_imported',
            prep_status: 'pdf_prepared',
          } as never);
      })) as never);
    const wrapper = await mountPage();
    const [a, b] = NEEDS_UPLOAD;

    await pickFile(wrapper, a);
    await untilUploadCalls(ctx, 1);
    // A is in flight; B's Upload click arrives before A finishes.
    await wrapper.get(`[data-testid="pdf-upload-btn-${b}"]`).trigger('click');
    resolvers[a]();
    await flushPromises();
    // A's completion must not swallow B's file selection or B's spinner.
    await choosePickedFile(wrapper, 'b.pdf');
    await untilUploadCalls(ctx, 2);

    expect(ctx.mock.rpc.callsTo('upload_pdf').map((c) => c.params.record_id)).toEqual([a, b]);
    expect(wrapper.get(`[data-testid="pdf-upload-btn-${b}"]`).text()).toContain('Uploading');
    resolvers[b]();
    await flushPromises();
    expect(rowIds(wrapper)).toEqual([]);
  });

  it("keeps A's spinner and B's when both uploads overlap", async () => {
    const resolvers: Record<string, () => void> = {};
    ctx.mock.rpc.on('upload_pdf', ((params: { record_id: string }) =>
      new Promise((resolve) => {
        resolvers[params.record_id] = () =>
          resolve({
            success: true,
            project_id: TEST_PROJECT_ID,
            record_id: params.record_id,
            file_path: 'x',
            new_status: 'pdf_imported',
            prep_status: 'pdf_prepared',
          } as never);
      })) as never);
    const wrapper = await mountPage();
    const [a, b] = NEEDS_UPLOAD;

    await pickFile(wrapper, a);
    await untilUploadCalls(ctx, 1);
    await pickFile(wrapper, b);
    await untilUploadCalls(ctx, 2);
    resolvers[a]();
    await flushPromises();

    // A is done and gone; B's spinner is still there.
    expect(rowIds(wrapper)).toEqual([b]);
    expect(wrapper.get(`[data-testid="pdf-upload-btn-${b}"]`).text()).toContain('Uploading');
  });
});
