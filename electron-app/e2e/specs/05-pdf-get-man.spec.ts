import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  test as baseTest,
  expect,
  SnapshotCache,
  SNAPSHOT_SOURCE_ROOTS,
  ALICE,
  DEFAULT_PROJECT_ID,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { clickWhenEnabled } from '../helpers/test-utils';
import { reconcileReviewerToDev } from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;
const PDF_FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'data', 'pdfs');

function createCache(): SnapshotCache {
  return new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS });
}

async function waitForBackendReady(window: Page, timeout = BACKEND_TIMEOUT): Promise<void> {
  const ready = await window.waitForFunction(
    () => {
      // @ts-expect-error pinia on window
      const pinia = window.__pinia__;
      return pinia?._s.get('backend')?.status === 'running';
    },
    { timeout },
  );
  expect(ready).toBeTruthy();
}

interface BibEntry {
  id: string;
  status: string;
  doi: string | null;
}

function parseRecordsBib(bibPath: string): BibEntry[] {
  const text = fs.readFileSync(bibPath, 'utf-8');
  const entries: BibEntry[] = [];
  const blocks = text.split(/\n@/).map((b, i) => (i === 0 ? b : '@' + b));
  for (const block of blocks) {
    const idMatch = block.match(/^@\w+\{([^,]+),/);
    if (!idMatch) continue;
    const statusMatch = block.match(/colrev_status\s*=\s*\{([^}]+)\}/);
    const doiMatch = block.match(/^\s*doi\s*=\s*\{([^}]+)\}/m);
    if (!statusMatch) continue;
    entries.push({
      id: idMatch[1].trim(),
      status: statusMatch[1].trim(),
      doi: doiMatch ? doiMatch[1].trim() : null,
    });
  }
  return entries;
}

function normalizeDoi(doi: string | null): string | null {
  if (!doi) return null;
  return doi.replace(/^doi:/i, '').toLowerCase().trim();
}

/**
 * Match fixture PDFs to records by DOI. Filenames encode the DOI with `_`
 * substituted for the `/` (e.g. `10.1007_s12325-023-02684-x.pdf` ↔
 * `10.1007/s12325-023-02684-x`).
 */
function findFixturePdfsForRecords(
  records: BibEntry[],
): Array<{ record: BibEntry; pdfPath: string }> {
  const fixtureFiles = fs
    .readdirSync(PDF_FIXTURE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'));
  const fixtureByDoi = new Map<string, string>();
  for (const f of fixtureFiles) {
    const stem = f.replace(/\.pdf$/i, '');
    const doi = stem.replace(/_/g, '/').toLowerCase();
    fixtureByDoi.set(doi, path.join(PDF_FIXTURE_DIR, f));
  }
  const matches: Array<{ record: BibEntry; pdfPath: string }> = [];
  for (const r of records) {
    const norm = normalizeDoi(r.doi);
    if (!norm) continue;
    const pdfPath = fixtureByDoi.get(norm);
    if (pdfPath) matches.push({ record: r, pdfPath });
  }
  return matches;
}

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    const cache = createCache();
    cache.load('post-pdf-get', ws.root);
    reconcileReviewerToDev(ws);

    // Alice owns the project; her clone is already on dev with included
    // records. Set her active so the first project open lands in her workspace.
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = ALICE.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

    await use(ws);
  },
});

test.describe('pdf-get-man', () => {
  test('batch-upload + mark-unavailable resolves every pdf_needs_manual_retrieval record', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );
    const recordsPath = path.join(aliceProjectPath, 'data', 'records.bib');

    // Sanity: snapshot must contain pdf_needs_manual_retrieval records to test against.
    const initial = parseRecordsBib(recordsPath);
    const initialNeedsRetrieval = initial.filter(
      (r) => r.status === 'pdf_needs_manual_retrieval',
    );
    expect(initialNeedsRetrieval.length).toBeGreaterThan(0);

    // Phase 1: app + backend ready
    console.log('[pdf-get-man] waiting for app mount');
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // Phase 2: open Alice's project
    console.log('[pdf-get-man] opening Alice project');
    await window.locator('[data-testid="project-row-lit-review"]').click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    // Phase 3: navigate to PDFs page
    console.log('[pdf-get-man] navigating to PDFs page');
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/pdfs',
      );
    });
    await window.waitForSelector('[data-testid="pdfs-page"]', { timeout: 30_000 });

    // The page should auto-land on the Upload stage because retrieve is
    // already complete on this snapshot. Click into it explicitly to be safe.
    await window.waitForSelector('[data-testid="pdfs-stage-upload"]', { timeout: 30_000 });
    await window.locator('[data-testid="pdfs-stage-upload"]').click();
    await window.waitForSelector('[data-testid="pdfs-stage-upload-panel"]', {
      timeout: 30_000,
    });
    await workspace.markPhase(electronApp, 'pdfs-page-upload-stage');

    // Phase 4: batch-upload any fixture PDFs whose DOIs match
    // pdf_needs_manual_retrieval records.
    const fixtureMatches = findFixturePdfsForRecords(initialNeedsRetrieval);
    console.log(
      `[pdf-get-man] ${initialNeedsRetrieval.length} need retrieval; ${fixtureMatches.length} fixture PDFs match by DOI`,
    );

    if (fixtureMatches.length > 0) {
      await clickWhenEnabled(window, '[data-testid="pdfs-batch-upload-btn"]', 30_000);
      const batchInput = window.locator('[data-testid="pdfs-batch-upload-input"]');
      await batchInput.waitFor({ state: 'attached', timeout: 15_000 });
      await batchInput.setInputFiles(fixtureMatches.map((m) => m.pdfPath));

      // Wait for the dialog to finish analyzing + finalize matches; submit
      // becomes visible+enabled in REVIEW_MATCHES with at least one match.
      await clickWhenEnabled(
        window, '[data-testid="batch-upload-submit"]', 120_000,
      );

      // Dialog auto-closes once all uploads succeed.
      await window.waitForSelector(
        '[data-testid="pdfs-batch-upload-input"]',
        { state: 'detached', timeout: 120_000 },
      );

      await workspace.markPhase(electronApp, 'after-batch-upload');
    }

    // Phase 5: mark every remaining pdf_needs_manual_retrieval record
    // unavailable. Read the bib fresh after batch upload — uploaded records
    // have transitioned out.
    const afterUpload = parseRecordsBib(recordsPath);
    const stillNeedsRetrieval = afterUpload.filter(
      (r) => r.status === 'pdf_needs_manual_retrieval',
    );
    console.log(
      `[pdf-get-man] marking ${stillNeedsRetrieval.length} records pdf_not_available`,
    );

    for (const r of stillNeedsRetrieval) {
      const btn = `[data-testid="pdf-not-available-btn-${r.id}"]`;
      await clickWhenEnabled(window, btn, 30_000);
      // Wait for the row to leave manual_retrieval before moving on so the
      // next click doesn't race a stale render.
      await window.waitForFunction(
        (id) => {
          // @ts-expect-error pinia on window
          const pinia = window.__pinia__;
          const projects = pinia?._s.get('projects');
          const counts = projects?.currentStatus?.currently;
          return counts && (counts.pdf_needs_manual_retrieval ?? 0) >= 0;
        },
        r.id,
        { timeout: 30_000 },
      );
    }

    // Phase 6: wait for the store to confirm 0 records still need retrieval.
    await window.waitForFunction(
      () => {
        // @ts-expect-error pinia on window
        const pinia = window.__pinia__;
        const projects = pinia?._s.get('projects');
        const counts = projects?.currentStatus?.currently;
        return counts && (counts.pdf_needs_manual_retrieval ?? 0) === 0;
      },
      { timeout: 60_000 },
    );

    await workspace.markPhase(electronApp, 'pdf-get-man-done');

    // Assertion: ground-truth records.bib on disk.
    const final = parseRecordsBib(recordsPath);

    const stillRetrieval = final.filter(
      (r) => r.status === 'pdf_needs_manual_retrieval',
    );
    expect(stillRetrieval.length).toBe(0);

    const expectedNotAvailable = initialNeedsRetrieval.length - fixtureMatches.length;
    const notAvailable = final.filter((r) => r.status === 'pdf_not_available');
    expect(notAvailable.length).toBe(expectedNotAvailable);

    if (fixtureMatches.length > 0) {
      // Each uploaded PDF should land in pdf_imported / pdf_prepared /
      // pdf_needs_manual_preparation depending on whether colrev's inline
      // pdf_prep step succeeded.
      const postImportStatuses = new Set([
        'pdf_imported', 'pdf_prepared', 'pdf_needs_manual_preparation',
      ]);
      for (const m of fixtureMatches) {
        const updated = final.find((r) => r.id === m.record.id);
        expect(updated, `record ${m.record.id} missing after upload`).toBeDefined();
        expect(
          postImportStatuses.has(updated!.status),
          `record ${m.record.id} expected post-import, got ${updated?.status}`,
        ).toBe(true);
      }
    }

    if (process.env.BUILD_FIXTURES === '1') {
      // Close the Electron app first so it stops appending to rpc.jsonl;
      // tar otherwise fails with "file changed as we read it".
      try {
        await electronApp.close();
      } catch {
        // already closed
      }
      const cache2 = createCache();
      cache2.checkpoint('post-pdf-get-man', workspace.root);
    }
  });
});
