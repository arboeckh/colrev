export interface PdfRecord {
  ID: string;
  title: string;
  author: string;
  year: string;
  colrev_status: string;
  journal?: string;
  booktitle?: string;
  doi?: string;
  colrev_data_provenance?: globalThis.Record<string, { source: string; note: string }>;
}

export interface UploadResult {
  status: 'success' | 'prep-failed' | 'error';
  message?: string;
}

export interface StatusFilterPill {
  label: string;
  /** Null matches all records; array matches any listed colrev_status. */
  statuses: string[] | null;
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

interface DefectCopy {
  label: string;
  sentence: string;
}

const PDF_DEFECT_LABELS: globalThis.Record<string, DefectCopy> = {
  'no-text-in-pdf': {
    label: 'no extractable text',
    sentence: 'The PDF appears to be scanned with no text layer — try a different source or OCR it first.',
  },
  'pdf-incomplete': {
    label: 'incomplete',
    sentence: 'The PDF looks incomplete — some pages may be missing.',
  },
  'author-not-in-pdf': {
    label: 'author missing',
    sentence: "The author's name couldn't be found in the PDF — it may be the wrong file.",
  },
  'title-not-in-pdf': {
    label: 'title missing',
    sentence: "The title couldn't be found in the PDF — it may be the wrong file.",
  },
  'coverpage-included': {
    label: 'cover page included',
    sentence: 'The PDF has a cover page that interferes with extraction — re-upload without it.',
  },
  'last-page-appended': {
    label: 'extra last page',
    sentence: 'The PDF has extra pages at the end that interfere with extraction.',
  },
};

export function getDefects(record: PdfRecord): string[] {
  const note = record.colrev_data_provenance?.file?.note || '';
  return note
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith('IGNORE:'));
}

export function getDefectLabel(code: string): string {
  return PDF_DEFECT_LABELS[code]?.label || code;
}

export function getDefectSentence(code: string): string {
  return PDF_DEFECT_LABELS[code]?.sentence || code;
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
    default:
      return status;
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
    default:
      return 'text-muted-foreground';
  }
}

export function statusPillClass(status: string): string {
  const base =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-tight whitespace-nowrap';
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
    default:
      return 'bg-muted-foreground/50';
  }
}
