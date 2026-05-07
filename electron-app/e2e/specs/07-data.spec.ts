/**
 * Slice 9 — data extraction / synthesis stage.
 *
 * Loads `post-screen`. Single-reviewer: alice configures 3 extraction fields,
 * fills values for every rev_included record, exports CSV. End state: every
 * rev_included record reaches rev_synthesized.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  test as baseTest,
  expect,
  switchAccount,
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

interface BibEntry {
  id: string;
  status: string;
}

function parseRecordsBib(bibPath: string): BibEntry[] {
  const text = fs.readFileSync(bibPath, 'utf-8');
  const entries: BibEntry[] = [];
  const blocks = text.split(/\n@/).map((b, i) => (i === 0 ? b : '@' + b));
  for (const block of blocks) {
    const idMatch = block.match(/^@\w+\{([^,]+),/);
    if (!idMatch) continue;
    const statusMatch = block.match(/colrev_status\s*=\s*\{([^}]+)\}/);
    if (!statusMatch) continue;
    entries.push({
      id: idMatch[1].trim(),
      status: statusMatch[1].trim(),
    });
  }
  return entries;
}

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    const cache = createCache();
    cache.load('post-screen', ws.root);

    // post-screen ends with bob active. Slice 9 is single-reviewer (alice).
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = ALICE.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

    // colrev's default init template registers `colrev.rev_check` as a data
    // endpoint, but no such package is installed. data_operation.main() tries
    // to load every endpoint and crashes. Strip it here — slice 9 only
    // exercises the structured endpoint. Mirrored on bob's clone too in case
    // a future slice extends to bob (no-op if absent).
    const stripRevCheck = (settingsPath: string) => {
      if (!fs.existsSync(settingsPath)) return;
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const eps = s?.data?.data_package_endpoints;
      if (!Array.isArray(eps)) return;
      const filtered = eps.filter(
        (ep: any) => (ep?.endpoint ?? '') !== 'colrev.rev_check',
      );
      if (filtered.length !== eps.length) {
        s.data.data_package_endpoints = filtered;
        fs.writeFileSync(settingsPath, JSON.stringify(s, null, 4));
      }
    };
    const aliceSettings = path.join(
      ws.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID, 'settings.json',
    );
    stripRevCheck(aliceSettings);
    if (fs.existsSync(aliceSettings)) {
      try {
        execFileSync('git', ['add', 'settings.json'], {
          cwd: path.dirname(aliceSettings), stdio: 'pipe',
        });
        execFileSync(
          'git',
          ['-c', 'user.email=test@local', '-c', 'user.name=test',
            'commit', '-m', 'data-spec: drop unloadable rev_check endpoint',
            '--allow-empty'],
          { cwd: path.dirname(aliceSettings), stdio: 'pipe' },
        );
      } catch {
        // already committed or no change — fine
      }
    }

    await use(ws);
  },
});

test.describe('data', () => {
  test('configure 3 fields, extract values for each included record, export CSV', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(420_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );
    const aliceRecordsPath = path.join(aliceProjectPath, 'data', 'records.bib');
    const aliceSettingsPath = path.join(aliceProjectPath, 'settings.json');
    const aliceDataCsvPath = path.join(aliceProjectPath, 'data', 'data', 'data.csv');

    // post-screen leaves 2 rev_included records (alice's screen decisions).
    const initial = parseRecordsBib(aliceRecordsPath);
    const includedInitial = initial.filter((r) => r.status === 'rev_included');
    expect(
      includedInitial.length,
      'fixture must produce rev_included records to extract data from',
    ).toBeGreaterThan(0);

    // ---------------------------------------------------------------
    // Phase 1: app + backend ready, open Alice project, navigate to /data
    // ---------------------------------------------------------------
    console.log('[data] waiting for app mount');
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    console.log('[data] opening Alice project');
    await window.locator('[data-testid="project-row-lit-review"]').click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    // Wait for git to settle on dev — extraction operates against dev.
    await window.waitForFunction(
      () => {
        const pinia = (self as any).__pinia__;
        const g = pinia?._s.get('git');
        return g && g.currentBranch === 'dev';
      },
      { timeout: 30_000 },
    );

    console.log('[data] navigating to /data');
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/data',
      );
    });
    await window.waitForSelector('[data-testid="data-page"]', { timeout: 30_000 });

    await workspace.markPhase(electronApp, 'data-page-loaded');

    // ---------------------------------------------------------------
    // Phase A: configure 3 extraction fields
    // ---------------------------------------------------------------
    interface FieldSpec {
      name: string;
      data_type: 'str' | 'int' | 'double' | 'select' | 'multi_select';
      explanation: string;
      value: string;
    }
    const FIELDS: FieldSpec[] = [
      { name: 'intervention',     data_type: 'str', explanation: 'Drug or therapy under study', value: 'Sotatercept' },
      { name: 'n_participants',   data_type: 'int', explanation: 'Number of enrolled participants', value: '100' },
      { name: 'primary_endpoint', data_type: 'str', explanation: 'Primary efficacy endpoint',       value: '6MWD change' },
    ];

    console.log('[data] opening field configuration dialog');
    await clickWhenEnabled(window, '[data-testid="data-setup-btn"]', 10_000);
    await window.waitForSelector('[data-testid="data-fields-dialog"]', { timeout: 10_000 });

    // Dialog opens with one empty row pre-populated.
    for (let i = 0; i < FIELDS.length; i++) {
      if (i > 0) {
        await window.click('[data-testid="data-add-field-btn"]');
      }
      const f = FIELDS[i];
      await window.fill(`[data-testid="data-field-name-${i}"]`, f.name);
      await window.selectOption(`[data-testid="data-field-type-${i}"]`, f.data_type);
      await window.fill(`[data-testid="data-field-explanation-${i}"]`, f.explanation);
    }

    console.log('[data] saving field configuration');
    await clickWhenEnabled(window, '[data-testid="data-save-fields-btn"]', 10_000);
    // Dialog closes once configure_structured_endpoint resolves.
    await window.waitForSelector('[data-testid="data-fields-dialog"]', {
      state: 'detached', timeout: 30_000,
    });

    // Assert settings.json on disk carries the structured endpoint.
    const settings = JSON.parse(fs.readFileSync(aliceSettingsPath, 'utf-8'));
    const eps = settings.data?.data_package_endpoints || [];
    const structured = eps.find((ep: any) => ep.endpoint === 'colrev.structured');
    expect(structured, 'colrev.structured endpoint must be configured').toBeDefined();
    expect(structured.fields).toHaveLength(FIELDS.length);
    for (const f of FIELDS) {
      const onDisk = structured.fields.find((sf: any) => sf.name === f.name);
      expect(onDisk, `field ${f.name} present on disk`).toBeDefined();
      expect(onDisk.data_type).toBe(f.data_type);
      expect(onDisk.explanation).toBe(f.explanation);
    }

    await workspace.markPhase(electronApp, 'fields-configured');

    // ---------------------------------------------------------------
    // Phase B: walk the extraction queue, fill values for every record
    // ---------------------------------------------------------------
    console.log('[data] waiting for extraction panel');
    await window.waitForSelector('[data-testid="data-extraction-panel"]', { timeout: 30_000 });

    const totalRaw = await window.locator('[data-testid="data-remaining-count"]').textContent();
    const totalCount = parseInt((totalRaw ?? '').trim(), 10);
    expect(totalCount, 'extraction queue must report a total count').toBeGreaterThan(0);

    const filledIds: string[] = [];
    const MAX_LOOPS = totalCount + 2;

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const completeVisible = await window
        .locator('[data-testid="data-complete"]')
        .isVisible()
        .catch(() => false);
      if (completeVisible) break;

      await window.waitForSelector('[data-testid="data-record-id"]', { timeout: 30_000 });
      const recordId = (
        await window.locator('[data-testid="data-record-id"]').textContent()
      )?.trim() ?? '';
      expect(recordId, `loop ${loop}: record id present`).not.toBe('');

      console.log(`[data] extracting ${recordId} (${loop + 1}/${totalCount})`);
      for (const f of FIELDS) {
        await window.fill(`[data-testid="data-field-input-${f.name}"]`, f.value);
      }

      await clickWhenEnabled(window, '[data-testid="data-save-next-btn"]', 30_000);

      // Wait until either: record-id changes (next pending) or completion view shows.
      await window.waitForFunction(
        ({ prevId }) => {
          const completeEl = document.querySelector('[data-testid="data-complete"]');
          if (completeEl) return true;
          const idEl = document.querySelector('[data-testid="data-record-id"]');
          if (!idEl) return false;
          return (idEl.textContent ?? '').trim() !== prevId;
        },
        { prevId: recordId },
        { timeout: 60_000 },
      );

      filledIds.push(recordId);
    }

    expect(filledIds.length, 'every queued record should be filled').toBe(totalCount);
    expect(new Set(filledIds).size).toBe(totalCount);

    await workspace.markPhase(electronApp, 'extractions-saved');

    // ---------------------------------------------------------------
    // Phase C: export and verify on-disk CSV
    // ---------------------------------------------------------------
    console.log('[data] waiting for completion view');
    await window.waitForSelector('[data-testid="data-complete"]', { timeout: 30_000 });

    // Stub the native save dialog — we verify the CSV from its source path on
    // disk, not from the export destination.
    await window.evaluate(() => {
      (window as any).fileOps.saveDialog = async () => ({ ok: true });
    });

    console.log('[data] clicking export');
    await clickWhenEnabled(window, '[data-testid="data-export-csv-btn"]', 10_000);

    expect(fs.existsSync(aliceDataCsvPath), 'data.csv must exist on disk').toBe(true);
    const csv = fs.readFileSync(aliceDataCsvPath, 'utf-8').trimEnd();
    const lines = csv.split('\n');
    expect(lines.length, 'header + one row per record').toBe(totalCount + 1);

    // Columns: ID + the 3 configured fields, in some order. CSV is QUOTE_ALL
    // so each cell is wrapped in double quotes.
    const stripQuotes = (s: string) => s.replace(/^"|"$/g, '');
    const headers = lines[0].split(',').map(stripQuotes);
    expect(headers).toContain('ID');
    for (const f of FIELDS) {
      expect(headers).toContain(f.name);
    }

    const idIdx = headers.indexOf('ID');
    const fieldIdx = Object.fromEntries(FIELDS.map((f) => [f.name, headers.indexOf(f.name)]));

    const rowIds = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map(stripQuotes);
      rowIds.add(cells[idIdx]);
      for (const f of FIELDS) {
        expect(
          cells[fieldIdx[f.name]],
          `row ${i} field ${f.name}`,
        ).toBe(f.value);
      }
    }
    expect(rowIds.size, 'one row per filled record').toBe(totalCount);
    for (const id of filledIds) {
      expect(rowIds.has(id), `row for ${id} present in CSV`).toBe(true);
    }

    await workspace.markPhase(electronApp, 'export-verified');

    // ---------------------------------------------------------------
    // Final assertions: every previously rev_included record advanced to
    // rev_synthesized; rev_included is now empty.
    // ---------------------------------------------------------------
    const finalAlice = parseRecordsBib(aliceRecordsPath);
    const synthesized = finalAlice.filter((r) => r.status === 'rev_synthesized');
    const stillIncluded = finalAlice.filter((r) => r.status === 'rev_included');

    expect(synthesized.length).toBe(includedInitial.length);
    expect(stillIncluded.length).toBe(0);

    await workspace.markPhase(electronApp, 'data-done');

    if (process.env.BUILD_FIXTURES === '1') {
      // Commit any uncommitted data changes so the snapshot is on a clean
      // tree. save_data_extraction stages data.csv but doesn't commit; the
      // structured endpoint typically commits via data_operation.main but
      // edge cases can leave dirty bits.
      const projectDir = aliceProjectPath;
      try {
        const status = execFileSync('git', ['status', '--porcelain'], {
          cwd: projectDir, encoding: 'utf-8',
        }).trim();
        if (status) {
          execFileSync('git', ['add', '-A'], { cwd: projectDir, stdio: 'pipe' });
          execFileSync(
            'git',
            ['-c', 'user.email=alice@test.local', '-c', 'user.name=alice',
              'commit', '-m', 'data: extract values for included records'],
            { cwd: projectDir, stdio: 'pipe' },
          );
        }
        execFileSync('git', ['push', 'origin', 'dev'], {
          cwd: projectDir, stdio: 'pipe',
        });
      } catch (err) {
        console.warn('[data] post-extraction commit/push skipped:', err);
      }

      try {
        await electronApp.close();
      } catch {
        // already closed
      }
      const cache2 = createCache();
      cache2.checkpoint('post-data', workspace.root);
    }
  });
});
