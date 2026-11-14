// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { baseName, fileToBase64, uniqueSearchFilename } from './files';

describe('baseName', () => {
  it('splits on / and on \\', () => {
    expect(baseName('data/search/scopus.ris')).toBe('scopus.ris');
    expect(baseName('data\\search\\scopus.ris')).toBe('scopus.ris');
    expect(baseName('scopus.ris')).toBe('scopus.ris');
  });
});

describe('fileToBase64', () => {
  it('keeps the bytes of a binary file', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0xe9]);
    const encoded = await fileToBase64(new File([bytes], 'x.xlsx'));
    expect(Array.from(Buffer.from(encoded, 'base64'))).toEqual(Array.from(bytes));
  });

  it('keeps a Latin-1 file as it is', async () => {
    const latin1 = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // "Müller" in Latin-1
    const encoded = await fileToBase64(new File([latin1], 'x.ris'));
    expect(Array.from(Buffer.from(encoded, 'base64'))).toEqual(Array.from(latin1));
  });

  it('encodes an empty file as an empty string', async () => {
    expect(await fileToBase64(new File([], 'x.bib'))).toBe('');
  });
});

describe('uniqueSearchFilename', () => {
  it('names the file after the connector and the original file', () => {
    expect(uniqueSearchFilename('scopus', 'Export (1).CSV', [])).toBe('scopus_export_1.csv');
  });

  it('does not reuse a stem a source already has', () => {
    const existing = ['data/search/scopus_export.bib'];
    expect(uniqueSearchFilename('scopus', 'export.ris', existing)).toBe('scopus_export_2.ris');
    expect(
      uniqueSearchFilename('scopus', 'export.ris', [...existing, 'data\\search\\scopus_export_2.ris']),
    ).toBe('scopus_export_3.ris');
  });
});
