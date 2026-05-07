import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
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
    cache.load('post-search', ws.root);

    await use(ws);
  },
});

test.describe('preprocessing', () => {
  test('runs load → prep → dedupe and writes records.bib', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );

    // Phase 1: app + backend ready
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // Phase 2: open project
    await window.locator('[data-testid="project-row-lit-review"]').click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    // Phase 3: navigate to Preprocessing page
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/preprocessing',
      );
    });
    await window.waitForSelector('[data-testid="preprocessing-page"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="preprocessing-run-all-button"]', { timeout: 10_000 });

    await workspace.markPhase(electronApp, 'preprocessing-loaded');

    // Phase 4: click Run preprocessing
    await clickWhenEnabled(window, '[data-testid="preprocessing-run-all-button"]', 10_000);

    // Wait for completion: button text becomes "Run again"
    await window.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="preprocessing-run-all-button"]');
        return btn !== null && (btn.textContent ?? '').includes('Run again');
      },
      { timeout: 240_000 },
    );

    await workspace.markPhase(electronApp, 'preprocessing-auto-done');

    // Phase 5: drive the Manual Prep UI to resolve any records that prep
    // flagged as md_needs_manual_preparation. The two planted messy rows
    // (missing year / missing journal) land here. Until they're resolved,
    // preprocessing isn't truly complete.
    const attentionCount = await window.evaluate(() => {
      // @ts-expect-error pinia on window
      const pinia = window.__pinia__;
      const status = pinia?._s.get('projects')?.currentStatus;
      return status?.currently?.md_needs_manual_preparation ?? 0;
    });
    if (attentionCount > 0) {
      await clickWhenEnabled(window, '[data-testid="view-results-button"]', 5_000);
      await window.waitForSelector(
        '[data-testid="preprocessing-results-modal"]', { timeout: 10_000 },
      );

      // The Needs Attention tab is active by default. Resolve every row
      // (each save closes the dialog and reloads the list, so re-query the
      // first row each iteration).
      let safetyBreak = 20;
      while (safetyBreak-- > 0) {
        await window.waitForFunction(() => {
          const tbl = document.querySelector('[data-testid="attention-records-table"]');
          const empty = document.querySelector('[data-testid="preprocessing-results-modal"]')
            ?.textContent?.includes('All records are ready');
          return Boolean(tbl) || Boolean(empty);
        }, { timeout: 10_000 });

        const remaining = await window
          .locator('[data-testid="attention-records-table"] tbody tr').count();
        if (remaining === 0) break;

        await window.locator('[data-testid="attention-record-row-0"]').click();
        await window.waitForSelector(
          '[data-testid="record-edit-dialog"]', { timeout: 10_000 },
        );

        // Wait for the record to actually load into the form (record-edit-status-badge
        // means the record arrived; without this, fills can race the load and
        // be overwritten when load finishes).
        await window.waitForSelector(
          '[data-testid="record-edit-status-badge"]',
          { timeout: 10_000 },
        );

        // Overwrite empty + literal-"UNKNOWN" required fields with sensible
        // values. colrev's prep treats "UNKNOWN" as a missing-field defect,
        // so the same defaults work for both empty and UNKNOWN inputs. We
        // skip select fields (ENTRYTYPE, language) — they always have a
        // value already.
        const defaults: Record<string, string> = {
          year: '2024',
          journal: 'Unknown Journal',
          booktitle: 'Unknown Proceedings',
          volume: '1',
          number: '1',
          pages: '1-2',
          publisher: 'Unknown Publisher',
        };
        for (const [fieldKey, defaultVal] of Object.entries(defaults)) {
          const input = window.locator(
            `[data-testid="record-edit-field-${fieldKey}"]`,
          );
          if (!(await input.count())) continue;
          const cur = (await input.inputValue()).trim();
          if (!cur || cur.toUpperCase() === 'UNKNOWN') {
            await input.fill(defaultVal);
          }
        }

        // Wait for hasChanges to reflect — Vue computes the save-button
        // disabled state from getChangedFields(). If we click before Vue
        // re-renders, the click hits a still-disabled button.
        await window.waitForFunction(
          () => {
            const btn = document.querySelector(
              '[data-testid="record-edit-save-button"]',
            ) as HTMLButtonElement | null;
            return btn !== null && !btn.disabled;
          },
          { timeout: 5_000 },
        );

        await clickWhenEnabled(
          window, '[data-testid="record-edit-save-button"]', 5_000,
        );

        // Save closes the dialog on success (md_prepared) and the modal
        // auto-runs dedupe. Wait for the dialog to disappear.
        await window.waitForSelector(
          '[data-testid="record-edit-dialog"]',
          { state: 'detached', timeout: 30_000 },
        );
      }

      // Close the results modal by pressing Escape.
      await window.keyboard.press('Escape');
      await window.waitForSelector(
        '[data-testid="preprocessing-results-modal"]',
        { state: 'detached', timeout: 5_000 },
      );

      // The modal fires auto-dedupe in the background after each save. By
      // the time we close the modal those calls may still be in flight.
      // Wait for the project status to show no records stuck at md_prepared
      // or md_needs_manual_preparation before snapshotting.
      await window.waitForFunction(
        () => {
          // @ts-expect-error pinia on window
          const pinia = window.__pinia__;
          const status = pinia?._s.get('projects')?.currentStatus?.currently;
          if (!status) return false;
          return (
            (status.md_needs_manual_preparation ?? 0) === 0 &&
            (status.md_prepared ?? 0) === 0
          );
        },
        { timeout: 60_000 },
      );

      await workspace.markPhase(electronApp, 'manual-prep-done');
    }

    // Assertions: records.bib populated and has status fields
    const recordsBib = path.join(aliceProjectPath, 'data', 'records.bib');
    expect(fs.existsSync(recordsBib), `missing ${recordsBib}`).toBe(true);
    const records = fs.readFileSync(recordsBib, 'utf-8');
    expect(records.length).toBeGreaterThan(0);

    // Status field assertions
    const statusLines = records.match(/colrev_status\s*=\s*\{([^}]+)\}/g) ?? [];
    expect(statusLines.length).toBeGreaterThan(0);
    // Load ran: no record is stuck at the input-only md_imported state.
    const stuckImported = statusLines.filter((l) => l.includes('md_imported'));
    expect(stuckImported.length).toBe(0);
    // After Manual Prep resolution: no record may remain at
    // md_needs_manual_preparation. The post-preprocessing snapshot represents
    // a fully-resolved state.
    const stuckManual = statusLines.filter((l) =>
      l.includes('md_needs_manual_preparation'),
    );
    expect(stuckManual.length).toBe(0);
    // Every record reaches md_processed (or briefly md_prepared if dedupe
    // hadn't finished, but post-modal-close dedupe should be done).
    const validPostPrepStates = ['md_processed', 'md_prepared'];
    const allReachedPostPrep = statusLines.every((l) =>
      validPostPrepStates.some((s) => l.includes(s)),
    );
    expect(allReachedPostPrep).toBe(true);
    // All 10 records should be md_processed after manual prep + dedupe.
    const processed = statusLines.filter((l) => l.includes('md_processed'));
    expect(processed.length).toBeGreaterThanOrEqual(10);

    // Slice 4: cross-source dedupe collapsed the 5 exact-DOI overlaps between
    // PubMed (5 records) and OpenAlex (10 records). Input 15 → output 10.
    const recordCount = (records.match(/^@\w+\{/gm) ?? []).length;
    expect(recordCount).toBe(10);

    // Each of the 5 cross-source DOIs should appear exactly once after dedupe.
    const overlapDois = [
      '10.1056/nejmoa2213558',
      '10.1161/circheartfailure.123.011227',
      '10.1002/cpt.3116',
      '10.1016/j.healun.2024.11.037',
      '10.1183/13993003.01347-2022',
    ];
    for (const doi of overlapDois) {
      const re = new RegExp(`doi\\s*=\\s*\\{${doi.replace(/\./g, '\\.')}`, 'gi');
      const hits = (records.match(re) ?? []).length;
      expect(hits, `DOI ${doi} appeared ${hits} times after dedupe`).toBe(1);
    }

    // Three commits should have landed on top of "Initialize CoLRev project":
    // load, prep, dedupe.
    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: aliceProjectPath, encoding: 'utf-8',
    });
    const commitCount = log.trim().split('\n').length;
    expect(commitCount).toBeGreaterThanOrEqual(4); // init + load + prep + dedupe

    if (process.env.BUILD_FIXTURES === '1') {
      const cache = createCache();
      cache.checkpoint('post-preprocessing', workspace.root);
    }
  });
});
