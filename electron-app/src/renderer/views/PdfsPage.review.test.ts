/**
 * Reviewing a flagged PDF: pdf-prep's defect checks are heuristics, so the
 * user opens the PDF next to what was flagged and either accepts it as-is or
 * sends it back. A run of false alarms should clear without reopening the
 * dialog for each one.
 *
 * The dialog teleports into `document.body` (reka-ui), so assertions on its
 * contents run against the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { useProjectsStore } from '@/stores/projects';
import PdfsPage from './PdfsPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: {
    name: 'StepPageShell',
    template: '<div><slot /></div>',
  },
}));

// The real viewer is an iframe on the Electron-only `colrev-pdf://` protocol;
// what matters here is which file the dialog hands it.
vi.mock('@/components/screen/PdfViewerPanel.vue', () => ({
  default: {
    name: 'PdfViewerPanel',
    props: ['pdfPath'],
    template: '<div data-testid="pdf-viewer" :data-pdf-path="pdfPath" />',
  },
}));

const FLAGGED = ['Smith2023', 'Brown2023'];

function fixStageStatus() {
  return makeProjectStatus({
    total_records: 2,
    steps: PIPELINE_OPERATIONS.map((operation) =>
      makeStatusStep(operation, {
        state_counts:
          operation === 'pdf_prep' ? { pdf_needs_manual_preparation: 2 } : {},
      }),
    ),
  });
}

function flaggedRecordsResponse() {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    records: FLAGGED.map((id) => ({
      ID: id,
      title: `Title ${id}`,
      author: `Author of ${id}`,
      year: '2023',
      colrev_status: 'pdf_needs_manual_preparation',
      file: `data/pdfs/${id}.pdf`,
      file_on_disk: true,
      colrev_data_provenance: {
        file: { source: 'pdf-get', note: 'author-not-in-pdf,IGNORE:title-not-in-pdf' },
      },
    })),
    total: FLAGGED.length,
    offset: 0,
    limit: 2000,
  };
}

function dialog(): HTMLElement | null {
  return document.body.querySelector('[data-testid="pdf-review-dialog"]');
}

function inDialog(testId: string): HTMLElement | null {
  return dialog()?.querySelector(`[data-testid="${testId}"]`) ?? null;
}

function viewedPdf(): string | null | undefined {
  return inDialog('pdf-viewer')?.getAttribute('data-pdf-path');
}

async function settle(): Promise<void> {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
}

describe('PdfsPage — reviewing a flagged PDF', () => {
  let ctx: RendererTestContext;
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc
      .on('get_status', statusResponse(fixStageStatus()))
      .on('get_settings', settingsResponse())
      .on('list_managed_review_tasks', (params) => tasksResponse(params.kind))
      .on('get_records', flaggedRecordsResponse() as never)
      .on('accept_pdf_as_is', (params) => ({
        success: true,
        project_id: TEST_PROJECT_ID,
        record_id: params.record_id,
        new_status: 'pdf_prepared',
        ignored_defects: ['author-not-in-pdf'],
      }) as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function mountPage(): Promise<VueWrapper> {
    ctx.openProject();
    useProjectsStore().currentProject!.status = fixStageStatus();
    ctx.setGitState({ branch: 'dev' });
    wrapper = mount(PdfsPage, { attachTo: document.body });
    await settle();
    return wrapper;
  }

  async function openReview(page: VueWrapper, recordId: string): Promise<void> {
    await page.get(`[data-testid="pdf-review-btn-${recordId}"]`).trigger('click');
    await settle();
  }

  it('shows the PDF next to the active flags, with what to check', async () => {
    const page = await mountPage();
    await openReview(page, FLAGGED[0]);

    expect(dialog()).not.toBeNull();
    expect(viewedPdf()).toBe(
      `data/pdfs/${FLAGGED[0]}.pdf`,
    );
    // The active flag, next to the metadata it says the PDF doesn't match.
    expect(inDialog('pdf-review-defect-author-not-in-pdf')).not.toBeNull();
    expect(inDialog('pdf-review-sidebar')?.textContent).toContain(`Author of ${FLAGGED[0]}`);
    // An already-overridden flag is not presented as a problem.
    expect(inDialog('pdf-review-defect-title-not-in-pdf')).toBeNull();
    expect(inDialog('pdf-review-ignored')?.textContent).toContain('title missing');
  });

  it('accepts the PDF, moves the row out of the queue, and advances to the next flagged PDF', async () => {
    const page = await mountPage();
    await openReview(page, FLAGGED[0]);

    inDialog('pdf-review-accept')!.click();
    await settle();

    expect(ctx.mock.rpc.callsTo('accept_pdf_as_is').map((c) => c.params)).toEqual([
      expect.objectContaining({ project_id: TEST_PROJECT_ID, record_id: FLAGGED[0] }),
    ]);
    // Row left the "Needs fixing" list without waiting for a refresh.
    expect(page.find(`[data-testid="pdf-review-btn-${FLAGGED[0]}"]`).exists()).toBe(false);
    // The dialog stayed open on the next flagged record.
    expect(viewedPdf()).toBe(
      `data/pdfs/${FLAGGED[1]}.pdf`,
    );

    inDialog('pdf-review-accept')!.click();
    await settle();

    // Nothing left to review: the dialog closes.
    expect(dialog()).toBeNull();
  });

  it('keeps the dialog on the record when accepting fails', async () => {
    ctx.mock.rpc.onError('accept_pdf_as_is', {
      message: 'The PDF is not on this machine',
    });
    const page = await mountPage();
    await openReview(page, FLAGGED[0]);

    inDialog('pdf-review-accept')!.click();
    await settle();

    expect(viewedPdf()).toBe(
      `data/pdfs/${FLAGGED[0]}.pdf`,
    );
    expect(page.find(`[data-testid="pdf-review-btn-${FLAGGED[0]}"]`).exists()).toBe(true);
  });
});
