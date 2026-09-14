export interface PdfRecord {
  ID: string;
  title: string;
  author: string;
  year: string;
  colrev_status: string;
  journal?: string;
  booktitle?: string;
  doi?: string;
  /** Project-relative path of the linked PDF, e.g. `data/pdfs/Smith2023.pdf`. */
  file?: string;
  pages?: string;
  colrev_data_provenance?: globalThis.Record<string, { source: string; note: string }>;
  /**
   * Backend-computed: true = PDF file present on this machine, false = metadata
   * references a PDF but the file is missing locally (gitignored — needs to be
   * pulled from a collaborator or re-uploaded), null = no PDF expected.
   */
  file_on_disk?: boolean | null;
}

export interface UploadResult {
  status: 'success' | 'prep-failed' | 'error';
  message?: string;
}

export interface StatusFilterPill {
  label: string;
  /** Null matches all records; array matches any listed colrev_status. */
  statuses: string[] | null;
  /** When true, filter further to records with file_on_disk === true. */
  requireOnDisk?: boolean;
  /** When true, filter further to records with file_on_disk === false. */
  requireMissing?: boolean;
}

export const RETRIEVED_STATUSES = [
  'pdf_imported',
  'pdf_prepared',
  'pdf_needs_manual_preparation',
  'rev_excluded',
  'rev_included',
  'rev_synthesized',
];

export const UPLOAD_STAGE_PILLS: StatusFilterPill[] = [
  { label: 'Needs upload', statuses: ['pdf_needs_manual_retrieval'] },
  { label: 'Retrieved', statuses: RETRIEVED_STATUSES },
  { label: 'Unavailable', statuses: ['pdf_not_available'] },
  { label: 'All', statuses: null },
];

export const PREPARE_STAGE_PILLS: StatusFilterPill[] = [
  { label: 'Ready to prepare', statuses: ['pdf_imported'] },
  { label: 'Prepared', statuses: ['pdf_prepared'] },
  { label: 'All', statuses: null },
];

export const FIX_STAGE_PILLS: StatusFilterPill[] = [
  { label: 'Needs fixing', statuses: ['pdf_needs_manual_preparation'] },
  { label: 'Prepared', statuses: ['pdf_prepared'] },
  { label: 'All', statuses: null },
];

// Summary is the last PDF stage, so its records have usually moved on to
// rev_included/rev_excluded. "Ready" therefore keys off the file being on disk,
// not off `pdf_prepared` — pinning it to that status made the pill read 0 for
// every record that had progressed past screening. With `file_on_disk` as the
// discriminator the three pills partition the set: on disk, expected but
// missing, and never available.
export const SUMMARY_STAGE_PILLS: StatusFilterPill[] = [
  { label: 'Missing on disk', statuses: null, requireMissing: true },
  { label: 'Ready', statuses: null, requireOnDisk: true },
  { label: 'Unavailable', statuses: ['pdf_not_available'] },
  { label: 'All', statuses: null },
];

interface DefectCopy {
  label: string;
  sentence: string;
  /**
   * What to look for in the PDF to decide whether the flag is a false alarm.
   * CoLRev's checks are text heuristics; the user looking at the file is the
   * authority, and this tells them what the heuristic couldn't confirm.
   */
  check: (record: PdfRecord) => string;
}

const PDF_DEFECT_LABELS: globalThis.Record<string, DefectCopy> = {
  'no-text-in-pdf': {
    label: 'no extractable text',
    sentence: 'The PDF appears to be scanned with no text layer — try a different source or OCR it first.',
    check: () =>
      'Try selecting text in the viewer. A scanned PDF is still fine to read for screening; only text extraction needs a text layer.',
  },
  'pdf-incomplete': {
    label: 'incomplete',
    sentence: 'The PDF looks incomplete — some pages may be missing.',
    check: (r) =>
      r.pages
        ? `Scroll through and check the article runs over its full page range (pp. ${formatPages(r.pages)}).`
        : 'Scroll through and check the article is complete from start to finish.',
  },
  'author-not-in-pdf': {
    label: 'author missing',
    sentence: "The author's name couldn't be found in the PDF — it may be the wrong file.",
    check: () =>
      'Check the first page names the authors listed above. Accents, initials, or a byline set as an image often trip this check.',
  },
  'title-not-in-pdf': {
    label: 'title missing',
    sentence: "The title couldn't be found in the PDF — it may be the wrong file.",
    check: () =>
      'Check the first page shows the title above. Subtitles, hyphenation, or special characters often trip this check.',
  },
  'coverpage-included': {
    label: 'cover page included',
    sentence: 'The PDF has a cover page that interferes with extraction — re-upload without it.',
    check: () =>
      'A publisher cover page does not affect reading. Accept if the article itself follows it.',
  },
  'last-page-appended': {
    label: 'extra last page',
    sentence: 'The PDF has extra pages at the end that interfere with extraction.',
    check: () =>
      'Extra trailing pages do not affect reading. Accept if the article itself is intact.',
  },
  'pdf-unreadable': {
    label: 'unreadable',
    sentence: "The PDF file couldn't be opened — it may be corrupt.",
    check: () =>
      "If the viewer shows the article, the file opens fine here. If it doesn't, re-upload a different copy.",
  },
  'pdf-hash-error': {
    label: 'fingerprint failed',
    sentence: "CoLRev couldn't fingerprint the PDF's first page.",
    check: () => 'Check the first page renders and belongs to this article.',
  },
};

/** Defects pdf-prep flagged and nobody has overridden yet. */
export function getDefects(record: PdfRecord): string[] {
  return fileNotes(record).filter((d) => !d.startsWith('IGNORE:'));
}

/** Defects a person accepted the PDF despite (stored as `IGNORE:<code>`). */
export function getIgnoredDefects(record: PdfRecord): string[] {
  return fileNotes(record)
    .filter((d) => d.startsWith('IGNORE:'))
    .map((d) => d.slice('IGNORE:'.length));
}

function fileNotes(record: PdfRecord): string[] {
  const note = record.colrev_data_provenance?.file?.note || '';
  return note
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

export function getDefectLabel(code: string): string {
  return PDF_DEFECT_LABELS[code]?.label || code;
}

export function getDefectSentence(code: string): string {
  return PDF_DEFECT_LABELS[code]?.sentence || code;
}

export function getDefectCheck(code: string, record: PdfRecord): string {
  return (
    PDF_DEFECT_LABELS[code]?.check(record) ||
    'Look through the PDF and decide whether it is the right, readable article.'
  );
}

/** BibTeX page ranges use `--`; show a proper en dash. */
export function formatPages(pages: string): string {
  return pages.replace(/\s*-{1,2}\s*/g, '–');
}

export function getVenue(record: PdfRecord): string {
  return record.journal || record.booktitle || '';
}

export function getMetaLine(record: PdfRecord): string {
  const parts: string[] = [];
  if (record.author) parts.push(record.author);
  if (record.year) parts.push(record.year);
  const venue = getVenue(record);
  if (venue) parts.push(venue);
  return parts.join(' · ');
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'pdf_prepared':
      return 'Prepared';
    case 'pdf_imported':
      return 'Retrieved';
    case 'pdf_not_available':
      return 'Unavailable';
    case 'pdf_needs_manual_retrieval':
      return 'Needs upload';
    case 'pdf_needs_manual_preparation':
      return 'Needs fixing';
    // Records that have moved past the PDF stage still show up in the summary
    // table. Without these the column mixed vocabularies — a raw
    // `rev_included` sitting next to a human-readable "Unavailable".
    case 'rev_prescreen_included':
      return 'Prescreen: included';
    case 'rev_prescreen_excluded':
      return 'Prescreen: excluded';
    case 'rev_included':
      return 'Included';
    case 'rev_excluded':
      return 'Excluded';
    case 'rev_synthesized':
      return 'Synthesized';
    default:
      // Last resort for a status we haven't mapped: never show raw snake_case.
      return status
        .replace(/^(md|pdf|rev)_/, '')
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());
  }
}

export function statusClass(status: string): string {
  switch (status) {
    case 'pdf_prepared':
      return 'text-green-600 dark:text-green-400';
    case 'pdf_imported':
      return 'text-muted-foreground';
    case 'pdf_not_available':
      return 'text-muted-foreground/70';
    case 'pdf_needs_manual_retrieval':
      return 'text-amber-600 dark:text-amber-400';
    case 'pdf_needs_manual_preparation':
      return 'text-amber-600 dark:text-amber-400';
    case 'rev_included':
    case 'rev_synthesized':
      return 'text-green-600 dark:text-green-400';
    case 'rev_excluded':
    case 'rev_prescreen_excluded':
      return 'text-muted-foreground/70';
    default:
      return 'text-muted-foreground';
  }
}

export function statusPillClass(status: string): string {
  const base =
    // min-w-0 + ellipsis: the pill sits next to the "missing on disk" marker in
    // a fixed-width column, and a long status label must clip itself rather
    // than push that marker out of the cell.
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-tight whitespace-nowrap min-w-0 overflow-hidden text-ellipsis';
  switch (status) {
    case 'pdf_prepared':
      return `${base} bg-green-500/10 text-green-700 dark:bg-green-400/10 dark:text-green-300`;
    case 'pdf_imported':
      return `${base} bg-blue-500/10 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300`;
    case 'pdf_not_available':
      return `${base} bg-muted/60 text-muted-foreground`;
    case 'pdf_needs_manual_retrieval':
    case 'pdf_needs_manual_preparation':
      return `${base} bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300`;
    case 'rev_included':
    case 'rev_synthesized':
      return `${base} bg-green-500/10 text-green-700 dark:bg-green-400/10 dark:text-green-300`;
    case 'rev_excluded':
    case 'rev_prescreen_excluded':
      return `${base} bg-muted/60 text-muted-foreground`;
    default:
      return `${base} bg-muted/60 text-muted-foreground`;
  }
}

export function statusPillDotClass(status: string): string {
  switch (status) {
    case 'pdf_prepared':
      return 'bg-green-500 dark:bg-green-400';
    case 'pdf_imported':
      return 'bg-blue-500 dark:bg-blue-400';
    case 'pdf_not_available':
      return 'bg-muted-foreground/50';
    case 'pdf_needs_manual_retrieval':
    case 'pdf_needs_manual_preparation':
      return 'bg-amber-500 dark:bg-amber-400';
    case 'rev_included':
    case 'rev_synthesized':
      return 'bg-green-500 dark:bg-green-400';
    default:
      return 'bg-muted-foreground/50';
  }
}
