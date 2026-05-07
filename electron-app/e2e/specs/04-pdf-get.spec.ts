import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  test as baseTest,
  expect,
  SnapshotCache,
  SNAPSHOT_SOURCE_ROOTS,
  seedLocalIndex,
  ALICE,
  DEFAULT_PROJECT_ID,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { clickWhenEnabled } from '../helpers/test-utils';
import { reconcileReviewerToDev } from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;

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

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    const cache = createCache();
    cache.load('post-prescreen', ws.root);
    reconcileReviewerToDev(ws);

    // Slice 5 leaves bob as the activeLogin (he was the last reviewer to
    // act). For pdf_get we want a deterministic owner. Set alice — her
    // clone holds the dev branch we just reconciled to, so she'll see the
    // included records on first open.
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = ALICE.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

    // Seed the LocalIndex with two PDFs whose DOIs match alice's
    // rev_prescreen_included records (AitOudhia*2024 and Uddin*2024).
    // colrev's pdf_get with the local_index endpoint will find these by
    // DOI, symlink them in, and transition those records to pdf_imported.
    const pdfFixtureDir = path.join(__dirname, '..', 'fixtures', 'data', 'pdfs');
    seedLocalIndex(ws, [
      {
        doi: '10.1002/PSP4.13166',
        pdfPath: path.join(pdfFixtureDir, '10.1002_psp4.13166.pdf'),
      },
      {
        doi: '10.7759/CUREUS.51867',
        pdfPath: path.join(pdfFixtureDir, '10.7759_cureus.51867.pdf'),
      },
    ]);

    await use(ws);
  },
});

test.describe('pdf-get', () => {
  test('local_index hits transition rev_prescreen_included → pdf_imported, rest go to pdf_needs_manual_retrieval', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );

    // Phase 1: app + backend ready
    console.log('[pdf-get] waiting for app mount');
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // Phase 2: open Alice's project (which on the post-prescreen snapshot is
    // checked out on her reviewer branch with rev_prescreen_included records)
    console.log('[pdf-get] opening Alice project');
    await window.locator('[data-testid="project-row-lit-review"]').click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    // Phase 3: navigate to PDFs page
    console.log('[pdf-get] navigating to PDFs page');
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/pdfs',
      );
    });
    await window.waitForSelector('[data-testid="pdfs-page"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="pdfs-stage-retrieve-panel"]', {
      timeout: 30_000,
    });
    await window.waitForSelector('[data-testid="pdfs-retrieve-cta"]', {
      timeout: 30_000,
    });

    await workspace.markPhase(electronApp, 'pdfs-page-loaded');

    // Phase 4: click Start retrieval (pdf_get operation)
    console.log('[pdf-get] running pdf_get');
    await clickWhenEnabled(window, '[data-testid="pdfs-retrieve-cta"]', 30_000);

    // Wait for pdf_get to finish: panel transitions to "Retrieval finished"
    // (stageStatus.retrieve === 'complete'), which renders the "Re-run" or
    // "Go to upload" affordance and sets needsRetrievalCount or stops it.
    await window.waitForFunction(
      () => {
        // @ts-expect-error pinia on window
        const pinia = window.__pinia__;
        const projects = pinia?._s.get('projects');
        const status = projects?.currentStatus?.currently;
        if (!status) return false;
        // pdf_get pass succeeded once at least one record transitioned out of
        // rev_prescreen_included, OR everything fell to pdf_needs_manual_retrieval.
        return (
          (status.pdf_imported ?? 0) +
            (status.pdf_needs_manual_retrieval ?? 0) >
          0
        );
      },
      { timeout: 240_000 },
    );

    await workspace.markPhase(electronApp, 'pdf-get-done');

    // Assertion: read records.bib on disk and confirm the transitions.
    const recordsPath = path.join(aliceProjectPath, 'data', 'records.bib');
    expect(fs.existsSync(recordsPath)).toBe(true);
    const records = fs.readFileSync(recordsPath, 'utf-8');

    // No record should still be sitting at rev_prescreen_included after the
    // run — pdf_get must have either imported the PDF or marked it as needing
    // manual retrieval.
    const stillIncluded = (
      records.match(/colrev_status\s*=\s*\{rev_prescreen_included\}/g) ?? []
    ).length;
    expect(stillIncluded).toBe(0);

    // At least one record should be post-import: the seeded local_index hits
    // produced a PDF, which puts the record at pdf_imported, pdf_prepared,
    // or pdf_needs_manual_preparation depending on whether pdf_prep ran
    // inline. Without seeding, this assertion is what fails first.
    const postImportRe = /colrev_status\s*=\s*\{(pdf_imported|pdf_prepared|pdf_needs_manual_preparation)\}/g;
    const postImportCount = (records.match(postImportRe) ?? []).length;
    expect(postImportCount).toBeGreaterThanOrEqual(1);

    // The rest (no local_index hit) must have fallen through to
    // pdf_needs_manual_retrieval.
    const needsManualCount = (
      records.match(/colrev_status\s*=\s*\{pdf_needs_manual_retrieval\}/g) ?? []
    ).length;
    expect(needsManualCount).toBeGreaterThanOrEqual(1);

    if (process.env.BUILD_FIXTURES === '1') {
      const cache2 = createCache();
      cache2.checkpoint('post-pdf-get', workspace.root);
    }
  });
});
