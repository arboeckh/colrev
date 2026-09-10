/**
 * The API search query as the forms hold it, and its translation to and from
 * the `search_parameters` the backend stores.
 *
 * Adding a source and editing one are the same question asked twice, so both
 * surfaces bind to this shape via `ApiQueryForm`. Keeping the translation here
 * (rather than inside either dialog) is what stops the edit dialog from
 * drifting into a narrower version of the add dialog.
 *
 * Form fields are strings because that is what `<input>` yields; the numbers
 * and lists the backend wants are produced only at the boundary.
 */

/** Backing store for the query form. Every field is bindable as-is. */
export interface ApiQueryValue {
  searchQuery: string;
  yearFrom: string;
  yearTo: string;
  openAccessOnly: boolean;
  workTypes: string;
  sortOrder: string;
  searchExact: boolean;
  minCitations: string;
  languageFilter: string;
  hasAbstract: boolean;
  rawApiUrl: string;
}

/** The structured query as persisted in `search_parameters.query`. */
export interface StoredApiQuery {
  search?: string;
  search_exact?: boolean;
  year_from?: number | null;
  year_to?: number | null;
  open_access_only?: boolean;
  work_types?: string[] | null;
  sort?: string;
  min_citations?: number | null;
  language?: string | null;
  has_abstract?: boolean;
  raw_url?: string | null;
}

export function emptyApiQuery(): ApiQueryValue {
  return {
    searchQuery: '',
    yearFrom: '',
    yearTo: '',
    openAccessOnly: false,
    workTypes: '',
    sortOrder: 'relevance',
    searchExact: false,
    minCitations: '',
    languageFilter: '',
    hasAbstract: false,
    rawApiUrl: '',
  };
}

function toFormNumber(value: unknown): string {
  return value === null || value === undefined || value === '' ? '' : String(value);
}

/**
 * Re-open the form on a source that already exists.
 *
 * `searchString` is the fallback for sources stored before structured queries
 * existed, which have a search string and no `query` at all.
 */
export function apiQueryFromSource(
  searchParameters: globalThis.Record<string, unknown> | undefined | null,
  searchString?: string,
): ApiQueryValue {
  const value = emptyApiQuery();
  const query = (searchParameters?.query ?? null) as StoredApiQuery | null;

  if (!query) {
    value.searchQuery = searchString ?? '';
    return value;
  }

  value.searchQuery = query.search ?? searchString ?? '';
  value.yearFrom = toFormNumber(query.year_from);
  value.yearTo = toFormNumber(query.year_to);
  value.openAccessOnly = !!query.open_access_only;
  value.workTypes = (query.work_types ?? []).join(', ');
  value.sortOrder = query.sort ?? 'relevance';
  value.searchExact = !!query.search_exact;
  value.minCitations = toFormNumber(query.min_citations);
  value.languageFilter = query.language ?? '';
  value.hasAbstract = !!query.has_abstract;
  value.rawApiUrl = query.raw_url ?? '';

  return value;
}

/** The structured query to send as `search_parameters.query`. */
export function apiQueryToStoredQuery(value: ApiQueryValue): StoredApiQuery {
  const rawUrl = value.rawApiUrl.trim();
  if (rawUrl) {
    // A pasted URL is the whole query — the backend ignores the rest, so
    // sending it would only invite confusion about which one won.
    return { raw_url: rawUrl };
  }

  const workTypes = value.workTypes
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    search: value.searchQuery.trim(),
    search_exact: value.searchExact,
    year_from: value.yearFrom ? Number(value.yearFrom) : null,
    year_to: value.yearTo ? Number(value.yearTo) : null,
    open_access_only: value.openAccessOnly,
    work_types: workTypes.length ? workTypes : null,
    sort: value.sortOrder,
    min_citations: value.minCitations ? Number(value.minCitations) : null,
    language: value.languageFilter.trim() || null,
    has_abstract: value.hasAbstract,
    raw_url: null,
  };
}

/**
 * The `search_string` for the source: the keyword query, or the pasted URL when
 * that is all the user gave. It is what the source card shows and what the
 * search history records for reproducibility.
 */
export function apiQuerySearchString(value: ApiQueryValue): string {
  return value.searchQuery.trim() || value.rawApiUrl.trim();
}

/** A query is runnable once it has keywords, a pasted URL, or any filter. */
export function apiQueryIsComplete(value: ApiQueryValue, hasOptions: boolean): boolean {
  if (value.rawApiUrl.trim()) return true;
  if (value.searchQuery.trim()) return true;
  if (!hasOptions) return false;
  // Filter-only searches are legitimate: "every open-access article from 2023".
  return !!(
    value.yearFrom ||
    value.yearTo ||
    value.openAccessOnly ||
    value.workTypes.trim() ||
    value.minCitations ||
    value.languageFilter.trim() ||
    value.hasAbstract
  );
}
