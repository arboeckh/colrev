import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
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

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
    // post-prescreen: managed prescreen task launched, both reviewers decided
    // every record (inverse patterns, so every record is a conflict) and
    // pushed their reviewer branches. The snapshot ends with bob active.
    new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS })
      .load('post-prescreen', ws.root);
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = ALICE.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
    await use(ws);
  },
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function countStatuses(bib: string, status: string): number {
  return (bib.match(new RegExp(`colrev_status\\s*=\\s*\\{${status}\\}`, 'g')) ?? []).length;
}

async function waitForBackendReady(window: Page): Promise<void> {
  await window.waitForFunction(
    () => {
      // @ts-expect-error pinia on window
      const pinia = window.__pinia__;
      return pinia?._s.get('backend')?.status === 'running';
    },
    { timeout: BACKEND_TIMEOUT },
  );
}

async function waitForBranchEquals(window: Page, name: string, timeout = 60_000) {
  await window.waitForFunction(
    (expected) => {
      const pinia = (self as any).__pinia__;
      return pinia?._s.get('git')?.currentBranch === expected;
    },
    name,
    { timeout },
  );
}

/**
 * The reconciliation phase driven end to end through its UI (previous specs
 * substituted a git fast-forward for this). Every record is a conflict
 * (the reviewers decided inversely), so the walkthrough must be walked in
 * full: resolve each conflict, apply, and verify the engine committed the
 * resolutions to dev, pushed, completed the task, and retired both reviewer
 * branches locally and on the remote.
 */
test.describe('reconcile', () => {
  test('walk every conflict, apply, branches retired and audit exportable', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(420_000);

    const aliceProject = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );
    const bare = workspace.bareRemotePath(ALICE.login, DEFAULT_PROJECT_ID);

    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    const projectRow = window.locator('[data-testid="project-row-lit-review"]');
    await projectRow.waitFor({ state: 'visible', timeout: 30_000 });
    await projectRow.click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );
    await workspace.markPhase(electronApp, 'project-open');

    // --- Enter the reconcile phase (switches to dev) ------------------------
    await window.evaluate(() => {
      location.hash = location.hash.replace(/\/project\/([^/]+).*$/, '/project/$1/prescreen');
    });
    await window.waitForSelector('[data-testid="managed-review-prescreen"]', { timeout: 30_000 });
    await clickWhenEnabled(window, '[data-testid="workflow-phase-reconcile"]', 60_000);
    await waitForBranchEquals(window, 'dev');

    // The panel auto-starts the walkthrough when both reviewers are done;
    // otherwise the start button is the way in.
    const walkthrough = window.locator('[data-testid="reconcile-walkthrough"]');
    const startBtn = window.locator('[data-testid="reconcile-start-btn"]');
    await expect(walkthrough.or(startBtn).first()).toBeVisible({ timeout: 60_000 });
    if (!(await walkthrough.isVisible())) {
      await clickWhenEnabled(window, '[data-testid="reconcile-start-btn"]', 30_000);
    }
    await walkthrough.waitFor({ state: 'visible', timeout: 60_000 });
    await workspace.markPhase(electronApp, 'walkthrough-open');

    // --- Resolve every conflict: alternate include/exclude ------------------
    const decisionBar = window.locator('[data-testid="reconcile-decision-bar"]');
    const applyBtn = window.locator('[data-testid="reconcile-apply-btn"]');
    let included = 0;
    let excluded = 0;
    for (let i = 0; i < 40; i++) {
      // allDecided unmounts the decision bar and mounts the enabled apply bar.
      if (await applyBtn.isVisible().catch(() => false)) break;
      await decisionBar.waitFor({ state: 'visible', timeout: 30_000 });
      const recordId = (
        await window.textContent('[data-testid="reconcile-record-id"]')
      )?.trim();
      expect(recordId).toBeTruthy();
      const decision = i % 2 === 0 ? 'include' : 'exclude';
      await clickWhenEnabled(window, `[data-testid="reconcile-btn-${decision}"]`, 30_000);
      if (decision === 'include') included += 1;
      else excluded += 1;
      // The walkthrough advances (or, on the last conflict, completes).
      await window.waitForFunction(
        (prev) => {
          const el = document.querySelector('[data-testid="reconcile-record-id"]');
          const txt = (el?.textContent ?? '').trim();
          const bar = document.querySelector('[data-testid="reconcile-decision-bar"]');
          return !bar || (txt.length > 0 && txt !== prev);
        },
        recordId,
        { timeout: 30_000 },
      );
    }
    expect(included).toBeGreaterThan(0);
    expect(excluded).toBeGreaterThan(0);
    await workspace.markPhase(electronApp, 'all-conflicts-resolved');

    // --- Apply --------------------------------------------------------------
    await clickWhenEnabled(window, '[data-testid="reconcile-apply-btn"]', 30_000);
    await window.getByText('Reconciliation applied').waitFor({ state: 'visible', timeout: 120_000 });
    await workspace.markPhase(electronApp, 'applied');

    // --- Engine state: the resolutions are committed on dev and pushed ------
    const bib = fs.readFileSync(path.join(aliceProject, 'data', 'records.bib'), 'utf-8');
    expect(countStatuses(bib, 'rev_prescreen_included')).toBe(included);
    expect(countStatuses(bib, 'rev_prescreen_excluded')).toBe(excluded);
    expect(countStatuses(bib, 'md_processed')).toBe(0);

    expect(git(aliceProject, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('dev');

    // Apply commits locally; publishing to the remote is the user's push.
    await clickWhenEnabled(window, '[data-testid="push-button"]', 60_000);
    await expect
      .poll(() => git(bare, ['rev-parse', 'dev']), { timeout: 60_000 })
      .toBe(git(aliceProject, ['rev-parse', 'dev']));

    // --- Reviewer branches are retired locally and on the remote ------------
    await expect
      .poll(
        () => git(aliceProject, ['branch', '--list', 'review/*']),
        { timeout: 60_000 },
      )
      .toBe('');
    await expect
      .poll(
        () => git(bare, ['for-each-ref', 'refs/heads/review']),
        { timeout: 60_000 },
      )
      .toBe('');
    await workspace.markPhase(electronApp, 'branches-retired');

    // --- The completed task offers the audit export -------------------------
    const exportCsv = window.getByRole('button', { name: 'Export CSV' });
    await exportCsv.waitFor({ state: 'visible', timeout: 60_000 });
    // `window.fileOps` is a frozen contextBridge object, so the dialog must be
    // stubbed at its IPC seam in the main process.
    await electronApp.evaluate(({ ipcMain }) => {
      (globalThis as any).__exportedAudit = null;
      ipcMain.removeHandler('file:save-dialog');
      ipcMain.handle('file:save-dialog', (_event, opts) => {
        (globalThis as any).__exportedAudit = opts;
        return { ok: true };
      });
    });
    await exportCsv.click();
    await expect
      .poll(
        () => electronApp.evaluate(() => (globalThis as any).__exportedAudit !== null),
        { timeout: 60_000 },
      )
      .toBe(true);
    const exported = await electronApp.evaluate(
      () => (globalThis as any).__exportedAudit,
    );
    expect(exported.defaultName).toContain('.csv');
    expect(exported.content.length).toBeGreaterThan(0);

    await workspace.markPhase(electronApp, 'audit-exported');
  });
});
