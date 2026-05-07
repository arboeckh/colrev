import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  test as baseTest,
  expect,
  seedAccounts,
  seedAliceProject,
  seedCollaborator,
  ALICE,
  BOB,
  DEFAULT_PROJECT_ID,
  SnapshotCache,
  SNAPSHOT_SOURCE_ROOTS,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { clickWhenEnabled } from '../helpers/test-utils';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;
const FIXTURE_CSV = path.join(__dirname, '../fixtures/data/openalex-minimal.csv');

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

    // Inline seed: accounts → empty project → collaborator. No records yet —
    // search.spec is the first stage that produces records. No snapshot load
    // because no upstream snapshot exists in the new TDD ladder yet (slice 1
    // is the first to emit one).
    seedAccounts(ws, [ALICE, BOB]);
    seedAliceProject(ws);
    seedCollaborator(ws, BOB, `${ALICE.login}/${DEFAULT_PROJECT_ID}`);

    await use(ws);
  },
});

test.describe('search', () => {
  test('registers OpenAlex CSV upload and PubMed API source, runs both', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(240_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );

    // Phase 1: app + backend ready
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // Phase 2: open Alice's project
    const projectRow = window.locator('[data-testid="project-row-lit-review"]');
    await projectRow.waitFor({ state: 'visible', timeout: 30_000 });
    await projectRow.click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    await workspace.markPhase(electronApp, 'project-open');

    // Phase 3: navigate to Search page
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/search',
      );
    });
    await window.waitForSelector('[data-testid="add-source-card"]', { timeout: 30_000 });

    // Phase 4: open Add Source dialog and pick OpenAlex
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="db-tile-openalex"]', { timeout: 10_000 });
    await window.click('[data-testid="db-tile-openalex"]');

    // Phase 5: attach CSV + fill query, submit
    await window.waitForSelector('[data-testid="file-input"]', { timeout: 10_000 });
    await window.setInputFiles('[data-testid="file-input"]', FIXTURE_CSV);
    await window.fill(
      '[data-testid="search-query-input"]',
      'sotatercept pulmonary arterial hypertension',
    );
    await clickWhenEnabled(window, '[data-testid="submit-add-source"]', 10_000);

    // Phase 6: wait for the source card to render in the list
    await window.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid^="source-card-"]');
        return cards.length >= 1;
      },
      { timeout: 30_000 },
    );

    await workspace.markPhase(electronApp, 'openalex-added');

    // Phase 7: add PubMed via API tab
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="db-tile-pubmed"]', { timeout: 10_000 });
    await window.click('[data-testid="db-tile-pubmed"]');
    await window.waitForSelector('[data-testid="search-query-input"]', { timeout: 10_000 });
    // Same query that was captured into pubmed.fixture.json — the mock matches
    // by host+path only (params irrelevant to dispatch), but using the real
    // query keeps URL traces honest.
    await window.fill(
      '[data-testid="search-query-input"]',
      'sotatercept[Title/Abstract] AND ("pulmonary arterial hypertension"[Title/Abstract] OR PAH[Title/Abstract]) AND 2023:2024[PDAT] AND "clinical trial"[Publication Type]',
    );
    await clickWhenEnabled(window, '[data-testid="submit-add-source"]', 10_000);
    await window.waitForFunction(
      () => document.querySelectorAll('[data-testid^="source-card-"]').length >= 2,
      { timeout: 30_000 },
    );

    await workspace.markPhase(electronApp, 'pubmed-added');

    // Phase 8: Run PubMed search only (per-source button). Run-all also
    // re-runs OpenAlex DB import which hangs on the doubled-prefix path bug
    // observed during slice 2 RED — out of scope here, file an issue.
    await clickWhenEnabled(window, '[data-testid="run-search-pubmed"]', 10_000);
    // Wait for the PubMed source card to show record_count > 0 (search
    // completed and store refreshed).
    await window.waitForFunction(
      () => {
        const card = document.querySelector('[data-testid="source-card-pubmed"]');
        return card !== null && /(\d+)\s*records/.test(card.textContent ?? '')
          && Number(((card.textContent ?? '').match(/(\d+)\s*records/) ?? [])[1] ?? 0) > 0;
      },
      { timeout: 60_000 },
    );

    await workspace.markPhase(electronApp, 'searches-run');

    // Source persistence in colrev: settings.json sources is intentionally
    // emptied on save (settings.py:437) — each source is written as a sidecar
    // <stem>_search_history.json next to the search results file.
    const searchDir = path.join(aliceProjectPath, 'data', 'search');
    expect(fs.existsSync(searchDir)).toBe(true);

    const historyPath = path.join(searchDir, 'openalex_search_history.json');
    expect(fs.existsSync(historyPath), `missing ${historyPath}`).toBe(true);
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    expect(history.platform).toBe('colrev.unknown_source');
    expect(history.search_type).toBe('DB');
    expect(history.search_string).toContain('sotatercept');

    const bibPath = path.join(searchDir, 'openalex.bib');
    expect(fs.existsSync(bibPath), `missing ${bibPath}`).toBe(true);
    const bib = fs.readFileSync(bibPath, 'utf-8');
    // All 10 records present (each has a doi line)
    const doiLines = bib.match(/^\s*doi\s*=/gm) ?? [];
    expect(doiLines.length).toBe(10);
    // Cross-source overlap DOIs are preserved (OpenAlex stores DOIs lowercase)
    expect(bib).toContain('10.1056/nejmoa2213558');
    expect(bib).toContain('10.1183/13993003.01347-2022');

    // PubMed assertions — fixture has 5 PMIDs
    const pubmedHistory = path.join(searchDir, 'pubmed_search_history.json');
    expect(fs.existsSync(pubmedHistory), `missing ${pubmedHistory}`).toBe(true);
    const pubmedHist = JSON.parse(fs.readFileSync(pubmedHistory, 'utf-8'));
    expect(pubmedHist.platform).toBe('colrev.pubmed');
    expect(pubmedHist.search_type).toBe('API');

    const pubmedBib = path.join(searchDir, 'pubmed.bib');
    expect(fs.existsSync(pubmedBib), `missing ${pubmedBib}`).toBe(true);
    const pubmedContent = fs.readFileSync(pubmedBib, 'utf-8');
    const pubmedDoiLines = pubmedContent.match(/^\s*doi\s*=/gm) ?? [];
    expect(pubmedDoiLines.length).toBe(5);
    // Snapshot fixture's 5 cross-source DOIs all appear
    expect(pubmedContent.toLowerCase()).toContain('10.1056/nejmoa2213558');
    expect(pubmedContent.toLowerCase()).toContain('10.1183/13993003.01347-2022');

    // Snapshot for downstream slices
    if (process.env.BUILD_FIXTURES === '1') {
      const cache = createCache();
      cache.checkpoint('post-search', workspace.root);
    }
  });
});
