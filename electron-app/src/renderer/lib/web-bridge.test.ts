import { afterEach, describe, expect, it } from 'vitest';
import { pdfFileUrl } from './web-bridge';

const g = globalThis as { window?: unknown };

afterEach(() => {
  delete g.window;
});

describe('pdfFileUrl', () => {
  it('uses the colrev-pdf protocol inside Electron', () => {
    expect(pdfFileUrl('my review', 'data/pdfs/a b#1.pdf', '?v=1')).toBe(
      'colrev-pdf://pdf/my%20review/data/pdfs/a%20b%231.pdf?v=1',
    );
  });

  it('uses the bridge route in a browser on the web bridge', () => {
    g.window = { __colrevWebBridge: true };
    expect(pdfFileUrl('p1', 'data/pdfs/x%.pdf')).toBe('/__bridge/pdf/p1/data/pdfs/x%25.pdf');
  });
});
