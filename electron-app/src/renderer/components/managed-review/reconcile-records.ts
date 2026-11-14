/**
 * Record details for the records a reconciliation walkthrough shows.
 *
 * `get_records` has no filter by id and caps a page at 500 records, so a
 * single call only ever sees the first 500 records of `records.bib`. This
 * pages through the project until every wanted record has been seen.
 */

/** The backend's page cap (`MAX_LIMIT` in `records_handler.py`). */
const PAGE_SIZE = 500;

export interface RecordsPage {
  records: unknown[];
  pagination: { has_more: boolean };
}

export type FetchRecordsPage = (pagination: {
  offset: number;
  limit: number;
}) => Promise<RecordsPage>;

export async function collectRecordsById(
  fetchPage: FetchRecordsPage,
  ids: string[],
): Promise<Record<string, Record<string, unknown>>> {
  const wanted = new Set(ids);
  const found: Record<string, Record<string, unknown>> = {};
  let offset = 0;
  while (wanted.size > Object.keys(found).length) {
    const page = await fetchPage({ offset, limit: PAGE_SIZE });
    for (const record of page.records as Record<string, unknown>[]) {
      const rid = (record.ID ?? record.id) as string | undefined;
      if (rid && wanted.has(rid)) found[rid] = record;
    }
    if (!page.pagination.has_more || page.records.length === 0) break;
    offset += page.records.length;
  }
  return found;
}
