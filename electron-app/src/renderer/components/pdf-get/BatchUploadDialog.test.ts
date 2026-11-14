/**
 * Batch upload: the dialog must never trap the user or keep working after it
 * is closed, and two files must never be sent to one record.
 *
 * The dialog teleports into `document.body` (reka-ui), so assertions run
 * against the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';
import BatchUploadDialog from './BatchUploadDialog.vue';
import type { PdfRecord } from './PdfRecordTable.vue';

const RECORDS = ['R1', 'R2', 'R3'].map(
  (ID) =>
    ({
      ID,
      title: `Title ${ID}`,
      author: 'Author, A',
      year: '2024',
      colrev_status: 'pdf_needs_manual_retrieval',
    }) as unknown as PdfRecord,
);

function matchResponse(recordId: string | null) {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    filename: 'x.pdf',
    extraction_method: 'pdf_metadata',
    extracted_metadata: { title: 't', author: 'a', year: '2024', doi: '' },
    matches: recordId ? [{ record_id: recordId, similarity: 0.95 }] : [],
    best_match: recordId ? { record_id: recordId, similarity: 0.95 } : null,
  } as never;
}

function uploadResponse(recordId: string) {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    record_id: recordId,
    file_path: `data/pdfs/${recordId}.pdf`,
    new_status: 'pdf_imported',
  } as never;
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`);
}

function selectFiles(names: string[]) {
  const input = byTestId('pdfs-batch-upload-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    value: names.map((n) => new File(['%PDF-1.4'], n, { type: 'application/pdf' })),
    configurable: true,
  });
  input.dispatchEvent(new Event('change'));
}

async function until(check: () => boolean) {
  await vi.waitFor(() => expect(check()).toBe(true));
  await flushPromises();
}

describe('BatchUploadDialog', () => {
  let ctx: RendererTestContext;
  let wrapper: VueWrapper;

  beforeEach(async () => {
    ctx = setupRendererTest();
    ctx.openProject();
    wrapper = mount(BatchUploadDialog, {
      props: { open: false, records: RECORDS },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  it('auto-assigns a record to only one file', async () => {
    ctx.mock.rpc.on('match_pdf_to_records', matchResponse('R1'));

    selectFiles(['a.pdf', 'b.pdf']);
    await until(() => byTestId('batch-upload-submit') !== null);

    // Both files best-match R1; only the first may take it.
    expect(byTestId('batch-upload-submit')!.textContent).toContain('Upload 1 PDF(s)');
    const selects = [0, 1].map((i) => byTestId(`batch-upload-select-${i}`) as HTMLSelectElement);
    expect(selects.map((s) => s.value)).toEqual(['R1', '']);
  });

  it('ends in a state with Retry and Close when an upload fails', async () => {
    ctx.mock.rpc.on('match_pdf_to_records', ((params: { filename: string }) =>
      matchResponse(params.filename === 'a.pdf' ? 'R1' : 'R2')) as never);
    let failR2 = true;
    ctx.mock.rpc.on('upload_pdf', ((params: { record_id: string }) => {
      if (params.record_id === 'R2' && failR2) throw new Error('disk full');
      return uploadResponse(params.record_id);
    }) as never);

    selectFiles(['a.pdf', 'b.pdf']);
    await until(() => byTestId('batch-upload-submit') !== null);
    byTestId('batch-upload-submit')!.click();
    await until(() => byTestId('batch-upload-retry') !== null);

    const close = byTestId('batch-upload-close') as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    expect(close.textContent).toContain('Close');
    expect(wrapper.emitted('complete')).toBeUndefined();

    // Retry sends only the file that failed.
    failR2 = false;
    byTestId('batch-upload-retry')!.click();
    await until(() => wrapper.emitted('complete') !== undefined);
    expect(
      ctx.mock.rpc.callsTo('upload_pdf').map((c) => c.params.record_id),
    ).toEqual(['R1', 'R2', 'R2']);
  });

  it('stops analysing once the dialog is closed', async () => {
    const release: Array<() => void> = [];
    ctx.mock.rpc.on('match_pdf_to_records', (() =>
      new Promise((resolve) => {
        release.push(() => resolve(matchResponse('R1')));
      })) as never);

    selectFiles(['a.pdf', 'b.pdf', 'c.pdf']);
    await until(() => release.length === 1);

    await wrapper.setProps({ open: false });
    release[0]();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.mock.rpc.countOf('match_pdf_to_records')).toBe(1);
  });

  it('does not let an old analysis loop touch a newly opened dialog', async () => {
    const release: Array<() => void> = [];
    ctx.mock.rpc.on('match_pdf_to_records', (() =>
      new Promise((resolve) => {
        release.push(() => resolve(matchResponse('R1')));
      })) as never);

    selectFiles(['a.pdf', 'b.pdf']);
    await until(() => release.length === 1);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    release[0]();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));

    // Back at file selection: no phase flip, no further matching.
    expect(byTestId('batch-upload-select-files')).not.toBeNull();
    expect(byTestId('batch-upload-submit')).toBeNull();
    expect(ctx.mock.rpc.countOf('match_pdf_to_records')).toBe(1);
  });
});
