/**
 * The viewer's iframe loads `colrev-pdf://pdf/<project>/<path>`, and the
 * protocol handler decodes each path segment. A file name with `#`, `?` or `%`
 * only survives if every segment is encoded. The panel is also reused from
 * record to record, so the previous record's existence check must not
 * outlive the record.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';
import PdfViewerPanel from './PdfViewerPanel.vue';

describe('PdfViewerPanel', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject();
  });

  it('encodes every path segment of the PDF URL', async () => {
    const wrapper = mount(PdfViewerPanel, {
      props: { pdfPath: 'data/pdfs/50% off #1 what?.pdf' },
    });
    await flushPromises();

    const src = wrapper.get('[data-testid="pdf-iframe"]').attributes('src');
    expect(src).toBe(
      `colrev-pdf://pdf/${TEST_PROJECT_ID}/data/pdfs/50%25%20off%20%231%20what%3F.pdf`,
    );
    // What the protocol handler does with it.
    const url = new URL(src!);
    const decoded = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
    expect(decoded.join('/')).toBe('data/pdfs/50% off #1 what?.pdf');
  });

  it("does not show the previous record's missing-file state while checking the next", async () => {
    ctx.mock.pdfFiles.exists.mockResolvedValueOnce({ exists: false });
    const wrapper = mount(PdfViewerPanel, { props: { pdfPath: 'data/pdfs/gone.pdf' } });
    await flushPromises();
    expect(wrapper.find('[data-testid="pdf-iframe"]').exists()).toBe(false);

    // The next record's check never answers.
    ctx.mock.pdfFiles.exists.mockReturnValueOnce(new Promise(() => {}));
    await wrapper.setProps({ pdfPath: 'data/pdfs/other.pdf' });
    await flushPromises();

    expect(wrapper.text()).not.toContain('No PDF available');
  });
});
