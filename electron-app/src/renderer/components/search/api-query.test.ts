import { describe, it, expect } from 'vitest';
import {
  apiQueryFromSource,
  apiQueryIsComplete,
  apiQuerySearchString,
  apiQueryToStoredQuery,
  emptyApiQuery,
} from './api-query';

describe('apiQueryFromSource', () => {
  it('re-opens the form on every option the source was created with', () => {
    const value = apiQueryFromSource(
      {
        url: 'https://api.openalex.org/works?filter=...',
        query: {
          search: 'machine learning',
          year_from: 2020,
          year_to: 2024,
          open_access_only: true,
          work_types: ['article', 'preprint'],
          sort: 'citations',
          search_exact: true,
          min_citations: 10,
          language: 'en',
          has_abstract: true,
        },
      },
      'machine learning',
    );

    expect(value).toEqual({
      searchQuery: 'machine learning',
      yearFrom: '2020',
      yearTo: '2024',
      openAccessOnly: true,
      workTypes: 'article, preprint',
      sortOrder: 'citations',
      searchExact: true,
      minCitations: '10',
      languageFilter: 'en',
      hasAbstract: true,
      rawApiUrl: '',
    });
  });

  it('falls back to the search string for sources stored without a query', () => {
    const value = apiQueryFromSource(undefined, 'legacy query');
    expect(value.searchQuery).toBe('legacy query');
    expect(value.sortOrder).toBe('relevance');
  });

  it('leaves unset filters blank rather than guessing a value', () => {
    const value = apiQueryFromSource({ query: { search: 'dogs' } }, 'dogs');
    expect(value.yearFrom).toBe('');
    expect(value.minCitations).toBe('');
    expect(value.workTypes).toBe('');
    expect(value.openAccessOnly).toBe(false);
  });

  it('restores a pasted API URL', () => {
    const value = apiQueryFromSource({
      query: { raw_url: 'https://api.openalex.org/works?filter=is_oa:true' },
    });
    expect(value.rawApiUrl).toBe('https://api.openalex.org/works?filter=is_oa:true');
  });
});

describe('apiQueryToStoredQuery', () => {
  it('round-trips a source through the form without losing filters', () => {
    const stored = {
      search: 'dogs',
      search_exact: false,
      year_from: 2020,
      year_to: null,
      open_access_only: true,
      work_types: ['article'],
      sort: 'date',
      min_citations: null,
      language: 'en',
      has_abstract: false,
      raw_url: null,
    };

    expect(apiQueryToStoredQuery(apiQueryFromSource({ query: stored }))).toEqual(stored);
  });

  it('sends nulls, not empty strings, for cleared numeric filters', () => {
    const value = { ...emptyApiQuery(), searchQuery: 'dogs' };
    const query = apiQueryToStoredQuery(value);
    expect(query.year_from).toBeNull();
    expect(query.min_citations).toBeNull();
    expect(query.work_types).toBeNull();
    expect(query.language).toBeNull();
  });

  it('drops the other options when a raw URL is set, so only one query wins', () => {
    const value = {
      ...emptyApiQuery(),
      searchQuery: 'ignored',
      openAccessOnly: true,
      rawApiUrl: 'https://api.openalex.org/works?filter=type:article',
    };
    expect(apiQueryToStoredQuery(value)).toEqual({
      raw_url: 'https://api.openalex.org/works?filter=type:article',
    });
  });

  it('splits work types on commas and ignores the gaps', () => {
    const value = { ...emptyApiQuery(), searchQuery: 'x', workTypes: 'article, , preprint ' };
    expect(apiQueryToStoredQuery(value).work_types).toEqual(['article', 'preprint']);
  });
});

describe('apiQuerySearchString', () => {
  it('uses the keyword query when there is one', () => {
    const value = { ...emptyApiQuery(), searchQuery: '  dogs  ' };
    expect(apiQuerySearchString(value)).toBe('dogs');
  });

  it('falls back to the pasted URL so the source is never nameless', () => {
    const value = { ...emptyApiQuery(), rawApiUrl: 'https://api.openalex.org/works?x=1' };
    expect(apiQuerySearchString(value)).toBe('https://api.openalex.org/works?x=1');
  });
});

describe('apiQueryIsComplete', () => {
  it('accepts a keyword query', () => {
    expect(apiQueryIsComplete({ ...emptyApiQuery(), searchQuery: 'dogs' }, true)).toBe(true);
  });

  it('accepts a filter-only query when the connector has filters', () => {
    const value = { ...emptyApiQuery(), yearFrom: '2020', openAccessOnly: true };
    expect(apiQueryIsComplete(value, true)).toBe(true);
  });

  it('rejects a filter-only query for a connector without filters', () => {
    const value = { ...emptyApiQuery(), yearFrom: '2020' };
    expect(apiQueryIsComplete(value, false)).toBe(false);
  });

  it('rejects an empty query', () => {
    expect(apiQueryIsComplete(emptyApiQuery(), true)).toBe(false);
  });
});
