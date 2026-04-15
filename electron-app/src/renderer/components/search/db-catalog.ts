/**
 * Single source of truth for the Add Source gallery.
 *
 * Order inside each status group = visual order in the gallery.
 * Logos live at `@/assets/db-logos/<id>.svg`. If a file is missing, the
 * DatabaseTile falls back to a letter tile colored with `brandColor`.
 */

export type ConnectionStyle = 'api' | 'upload';
export type ConnectorStatus = 'enabled' | 'planned';

export interface DbConnector {
  id: string;
  style: ConnectionStyle;
  /** colrev package endpoint, e.g. `colrev.pubmed`. For generic uploads, `colrev.unknown_source`. */
  endpoint: string;
  name: string;
  tagline: string;
  brandColor: string;
  status: ConnectorStatus;

  // API-style fields
  queryPlaceholder?: string;
  queryHelp?: string;
  requiresApiKey?: boolean;

  // Upload-style fields
  acceptedFormats?: string[];
  /** Passed to `upload_search_file` as `source_template` when present. */
  csvTemplate?: string | null;
  uploadInstructions?: string;
}

export const CONNECTORS: DbConnector[] = [
  // ─── Direct connection (enabled) ───────────────────────────────
  {
    id: 'pubmed',
    style: 'api',
    endpoint: 'colrev.pubmed',
    name: 'PubMed',
    tagline: 'Biomedical literature via NCBI',
    brandColor: '#326599',
    status: 'enabled',
    queryPlaceholder:
      '"machine learning" AND "diabetic retinopathy" AND 2023/01:2023/06[dp]',
    queryHelp:
      'PubMed syntax: boolean operators (AND, OR, NOT) and field tags like [ti], [au], [dp].',
  },
  {
    id: 'crossref',
    style: 'api',
    endpoint: 'colrev.crossref',
    name: 'Crossref',
    tagline: 'Cross-publisher DOI metadata',
    brandColor: '#FFC72C',
    status: 'planned',
    queryPlaceholder: 'machine learning healthcare',
    queryHelp: 'Free-text query across Crossref metadata (title, abstract, authors).',
  },
  {
    id: 'arxiv',
    style: 'api',
    endpoint: 'colrev.arxiv',
    name: 'arXiv',
    tagline: 'Preprints in CS, math, physics',
    brandColor: '#B31B1B',
    status: 'planned',
    queryPlaceholder: 'cat:cs.LG AND ti:"large language model"',
    queryHelp:
      'arXiv syntax: prefix fields with ti:, au:, abs:, cat:. Combine with AND/OR.',
  },
  {
    id: 'dblp',
    style: 'api',
    endpoint: 'colrev.dblp',
    name: 'DBLP',
    tagline: 'Computer science bibliography',
    brandColor: '#003A70',
    status: 'planned',
    queryPlaceholder: 'reinforcement learning robotics',
    queryHelp: 'DBLP title/author keyword search.',
  },
  {
    id: 'eric',
    style: 'api',
    endpoint: 'colrev.eric',
    name: 'ERIC',
    tagline: 'Education research literature',
    brandColor: '#1D5AA2',
    status: 'planned',
    queryPlaceholder: 'classroom technology AND K-12',
    queryHelp: 'ERIC keyword search across education publications.',
  },
  {
    id: 'plos',
    style: 'api',
    endpoint: 'colrev.plos',
    name: 'PLOS',
    tagline: 'Public Library of Science',
    brandColor: '#F8AF26',
    status: 'planned',
    queryPlaceholder: 'crispr AND gene therapy',
    queryHelp: 'PLOS full-text and metadata search.',
  },

  // ─── Direct connection (planned, need API key plumbing) ────────
  {
    id: 'ieee',
    style: 'api',
    endpoint: 'colrev.ieee',
    name: 'IEEE Xplore',
    tagline: 'Engineering & tech research',
    brandColor: '#00629B',
    status: 'planned',
    requiresApiKey: true,
  },
  {
    id: 'semantic-scholar',
    style: 'api',
    endpoint: 'colrev.semanticscholar',
    name: 'Semantic Scholar',
    tagline: 'AI-driven scholarly search',
    brandColor: '#1857B6',
    status: 'planned',
    requiresApiKey: true,
  },
  {
    id: 'scopus-api',
    style: 'api',
    endpoint: 'colrev.scopus',
    name: 'Scopus',
    tagline: 'Elsevier abstract & citation DB',
    brandColor: '#E9711C',
    status: 'planned',
    requiresApiKey: true,
  },

  // ─── Manual upload (enabled) ───────────────────────────────────
  {
    id: 'openalex',
    style: 'upload',
    endpoint: 'colrev.unknown_source',
    name: 'OpenAlex',
    tagline: 'Open scholarly graph',
    brandColor: '#1B4E82',
    status: 'enabled',
    acceptedFormats: ['.csv', '.xlsx', '.xls'],
    csvTemplate: 'openalex',
    uploadInstructions:
      'Export a CSV from openalex.org using Works Search, then upload it here.',
  },

  // ─── Manual upload (planned) ───────────────────────────────────
  {
    id: 'web-of-science',
    style: 'upload',
    endpoint: 'colrev.web_of_science',
    name: 'Web of Science',
    tagline: 'Clarivate citation index',
    brandColor: '#5E33BF',
    status: 'planned',
    acceptedFormats: ['.bib', '.ris', '.txt'],
  },
  {
    id: 'scopus-upload',
    style: 'upload',
    endpoint: 'colrev.scopus',
    name: 'Scopus',
    tagline: 'Export from scopus.com',
    brandColor: '#E9711C',
    status: 'planned',
    acceptedFormats: ['.bib', '.ris', '.csv'],
  },
  {
    id: 'ieee-upload',
    style: 'upload',
    endpoint: 'colrev.ieee',
    name: 'IEEE Xplore',
    tagline: 'Export from ieeexplore.ieee.org',
    brandColor: '#00629B',
    status: 'planned',
    acceptedFormats: ['.bib', '.ris', '.csv'],
  },
  {
    id: 'google-scholar',
    style: 'upload',
    endpoint: 'colrev.google_scholar',
    name: 'Google Scholar',
    tagline: 'Via Publish or Perish export',
    brandColor: '#4285F4',
    status: 'planned',
    acceptedFormats: ['.bib', '.ris', '.csv'],
  },
  {
    id: 'acm',
    style: 'upload',
    endpoint: 'colrev.acm_digital_library',
    name: 'ACM Digital Library',
    tagline: 'Computing research archive',
    brandColor: '#0085CA',
    status: 'planned',
    acceptedFormats: ['.bib', '.ris'],
  },
  {
    id: 'ebsco',
    style: 'upload',
    endpoint: 'colrev.ebsco_host',
    name: 'EBSCOhost',
    tagline: 'Multi-disciplinary DB host',
    brandColor: '#007A33',
    status: 'planned',
    acceptedFormats: ['.bib', '.ris'],
  },
];

export const ENABLED_API_CONNECTORS = CONNECTORS.filter(
  (c) => c.style === 'api' && c.status === 'enabled',
);
export const PLANNED_API_CONNECTORS = CONNECTORS.filter(
  (c) => c.style === 'api' && c.status === 'planned',
);
export const ENABLED_UPLOAD_CONNECTORS = CONNECTORS.filter(
  (c) => c.style === 'upload' && c.status === 'enabled',
);
export const PLANNED_UPLOAD_CONNECTORS = CONNECTORS.filter(
  (c) => c.style === 'upload' && c.status === 'planned',
);

export function findConnector(id: string): DbConnector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
