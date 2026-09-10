/**
 * Display names for engine identifiers.
 *
 * The colrev engine speaks snake_case package names (`colrev.open_alex`,
 * `literature_review`). Those are the right identifiers on the wire and the
 * wrong words on screen — the search page was labelling sources `open_alex`
 * and Preprocessing was title-casing that into `Open_alex`. Everything the
 * user reads should go through here, so the engine's vocabulary stops at the
 * renderer boundary.
 *
 * Unknown identifiers fall back to a readable title-cased form rather than
 * leaking raw snake_case.
 */

/** Sources whose canonical spelling isn't recoverable by title-casing. */
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  open_alex: 'OpenAlex',
  openalex: 'OpenAlex',
  pubmed: 'PubMed',
  crossref: 'Crossref',
  dblp: 'DBLP',
  arxiv: 'arXiv',
  ieee: 'IEEE',
  ieeexplore: 'IEEE Xplore',
  acm: 'ACM',
  acm_digital_library: 'ACM Digital Library',
  web_of_science: 'Web of Science',
  scopus: 'Scopus',
  springer_link: 'SpringerLink',
  semantic_scholar: 'Semantic Scholar',
  google_scholar: 'Google Scholar',
  europe_pmc: 'Europe PMC',
  eric: 'ERIC',
  psycinfo: 'PsycINFO',
  ebsco_host: 'EBSCOhost',
  jstor: 'JSTOR',
  doi_org: 'doi.org',
  local_index: 'Local index',
  unknown_source: 'Unknown source',
  files_dir: 'Files',
  colrev_project: 'CoLRev project',
};

/** Review types as declared in a project's settings. */
const REVIEW_TYPE_DISPLAY_NAMES: Record<string, string> = {
  literature_review: 'Literature review',
  narrative_review: 'Narrative review',
  descriptive_review: 'Descriptive review',
  scoping_review: 'Scoping review',
  critical_review: 'Critical review',
  theoretical_review: 'Theoretical review',
  umbrella: 'Umbrella review',
  qualitative_systematic_review: 'Qualitative systematic review',
  meta_analysis: 'Meta-analysis',
  scientometric: 'Scientometric study',
  conceptual_review: 'Conceptual review',
};

/**
 * Title-case a snake_case / dotted identifier.
 *
 * `colrev.some_source` -> `Some source`. Deliberately sentence case, not
 * Title Case: "Web Of Science" reads worse than "Web of science", and anything
 * with a real proper name should be in the maps above instead.
 */
export function humanizeIdentifier(raw: string): string {
  const leaf = raw.split('.').pop() || raw;
  const spaced = leaf.replace(/_/g, ' ').trim();
  if (!spaced) return raw;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Display name for a search source endpoint or platform.
 *
 * Accepts either a bare name (`open_alex`) or a fully qualified package
 * (`colrev.open_alex`).
 */
export function formatSourceName(raw: string | null | undefined): string {
  if (!raw) return 'Unknown source';
  const leaf = (raw.split('.').pop() || raw).toLowerCase();
  return SOURCE_DISPLAY_NAMES[leaf] ?? humanizeIdentifier(raw);
}

/** Display name for a project's review type. */
export function formatReviewType(raw: string | null | undefined): string {
  if (!raw) return 'Not set';
  const leaf = (raw.split('.').pop() || raw).toLowerCase();
  return REVIEW_TYPE_DISPLAY_NAMES[leaf] ?? humanizeIdentifier(raw);
}
