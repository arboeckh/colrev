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
  BOB,
  DEFAULT_PROJECT_ID,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { clickWhenEnabled } from '../helpers/test-utils';
import {
  decideAllRecords,
  prescreenDecide,
  syncDevAcrossClones,
} from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;

/**
 * A managed prescreen needs more than one round whenever a search source is
 * added after the first round was reconciled. Reported against a real review
 * (PubMed first, OpenAlex added later): in the second round the stepper kept
 * Reconcile ticked, heading there with unsaved decisions opened the
 * save-or-discard dialog, "save" committed without pushing, and each reviewer
 * ended up at 28/28 on their own screen and 0/28 on the other's. The sidebar
 * meanwhile showed prescreen and screen both in progress with PDFs blank.
 *
 * post-prescreen: a managed prescreen task over 10 records, decided by both
 * reviewers and pushed. The spec reconciles it (round one), marks the
 * inclusions' PDFs prepared, and adds a batch of new records (round two).
 */
const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
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

function projectPath(workspace: TestWorkspace, login: string): string {
  return path.join(workspace.userDataDir, 'projects', login, DEFAULT_PROJECT_ID);
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

async function waitForBranch(window: Page, expected: string, timeout = 60_000) {
  await window.waitForFunction(
    (want) => {
      const branch = (self as any).__pinia__?._s.get('git')?.currentBranch as string | undefined;
      if (typeof branch !== 'string') return false;
      return want.endsWith('/') ? branch.startsWith(want) : branch === want;
    },
    expected,
    { timeout },
  );
}

async function gotoStep(window: Page, sub: string): Promise<void> {
  await window.evaluate((s) => {
    location.hash = location.hash.replace(/\/project\/([^/]+).*$/, `/project/$1${s}`);
  }, sub);
}

/**
 * Open the review the way a user's app runs it: with background sync on. The
 * fixture turns it off for specs that assert on the sync buttons, but this
 * scenario is about what reaches the remote.
 */
async function openReview(window: Page): Promise<void> {
  await window.waitForSelector('#app', { timeout: 15_000 });
  await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
  await waitForBackendReady(window);
  await window.evaluate(() => {
    localStorage.removeItem('sync.autoPull');
    localStorage.removeItem('sync.autoPush');
  });
  const row = window.locator('[data-testid="project-row-lit-review"]');
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.click();
  await window.waitForFunction(() => location.hash.includes('/project/lit-review'), {
    timeout: 15_000,
  });
}

async function expectPhases(
  window: Page,
  expected: Record<'launch' | 'review' | 'reconcile', string>,
): Promise<void> {
  for (const [id, status] of Object.entries(expected)) {
    await expect(window.locator(`[data-testid="workflow-phase-${id}"]`)).toHaveAttribute(
      'data-phase-status',
      status,
      { timeout: 30_000 },
    );
  }
}

async function expectSidebar(window: Page, expected: Record<string, string>): Promise<void> {
  for (const [id, status] of Object.entries(expected)) {
    await expect(window.locator(`[data-testid="sidebar-${id}"]`)).toHaveAttribute(
      'data-step-status',
      status,
      { timeout: 30_000 },
    );
  }
}

async function decideEverything(window: Page, pattern: ('include' | 'exclude')[]) {
  return decideAllRecords(window, {
    cardTestid: 'prescreen-record-card',
    completeTestid: 'prescreen-complete',
    recordIdTestid: 'prescreen-record-id',
    decide: prescreenDecide(60_000),
    pattern,
  });
}

test.describe('prescreen-second-round', () => {
  test('a second search batch runs a full managed prescreen round', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(600_000);

    const aliceProject = projectPath(workspace, ALICE.login);
    const bobProject = projectPath(workspace, BOB.login);
    const bare = workspace.bareRemotePath(ALICE.login, DEFAULT_PROJECT_ID);

    // ---------------------------------------------------------------------
    // Round one is reconciled; its inclusions get their PDFs; a new search
    // source adds three records nobody has prescreened.
    // ---------------------------------------------------------------------
    await openReview(window);
    await gotoStep(window, '');
    await waitForBranch(window, 'dev');

    // The reconcile UI itself is covered by 12-reconcile; this spec is about
    // what comes after it.
    await window.evaluate(async () => {
      const pinia = (self as any).__pinia__;
      const backend = pinia._s.get('backend');
      const projects = pinia._s.get('projects');
      const id = projects.currentProjectId;
      await pinia._s.get('sync').fetchNow();
      const { tasks } = await backend.call('list_managed_review_tasks', {
        project_id: id,
        kind: 'prescreen',
      });
      const task = tasks.find((t: any) => t.state === 'active');
      const preview = await backend.call('get_reconciliation_preview', {
        project_id: id,
        task_id: task.id,
      });
      const response = await backend.call('apply_reconciliation', {
        project_id: id,
        task_id: task.id,
        resolved_by: 'alice',
        resolutions: preview.items
          .filter((item: any) => item.status === 'conflict')
          .map((item: any) => ({ record_id: item.id, selected_reviewer: 'reviewer_a' })),
      });
      for (const branch of response.retired_branches) {
        await (window as any).git.deleteRemoteBranch(projects.currentProject.path, branch);
        await (window as any).git.deleteLocalBranch(projects.currentProject.path, branch);
      }
    });
    await expect
      .poll(() => git(bare, ['rev-parse', 'dev']), { timeout: 60_000 })
      .toBe(git(aliceProject, ['rev-parse', 'dev']));

    const bibPath = path.join(aliceProject, 'data', 'records.bib');
    const newBatch = fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'data', 'records.bib'),
      'utf-8',
    );
    const newRecordCount = (newBatch.match(/^@\w+\{/gm) ?? []).length;
    fs.writeFileSync(
      bibPath,
      `${fs
        .readFileSync(bibPath, 'utf-8')
        .replace(/(colrev_status\s*=\s*\{)rev_prescreen_included(\})/g, '$1pdf_prepared$2')
        .trimEnd()}\n\n${newBatch.trim()}\n`,
    );
    git(aliceProject, ['add', 'data/records.bib']);
    git(aliceProject, ['commit', '-m', 'test: PDFs prepared; second search batch preprocessed']);
    syncDevAcrossClones(workspace);
    await window.evaluate(() =>
      (self as any).__pinia__._s.get('projectData').invalidateAll(),
    );
    await workspace.markPhase(electronApp, 'round-two-records-arrived');

    // ---------------------------------------------------------------------
    // Round two, before launch: everything starts over at prescreen.
    // ---------------------------------------------------------------------
    await gotoStep(window, '/prescreen');
    await window.waitForSelector('[data-testid="reviewer-a-selector"]', { timeout: 60_000 });

    await expectSidebar(window, {
      search: 'complete',
      preprocessing: 'complete',
      prescreen: 'active',
      // Round one's records waiting at screen do not make it "in progress"
      // while the pipeline is back at prescreen.
      pdfs: 'pending',
      screen: 'pending',
      data: 'pending',
    });
    await expectPhases(window, { launch: 'active', review: 'pending', reconcile: 'pending' });
    await expect(window.locator('[data-testid="workflow-phase-review"]')).toBeDisabled();
    await expect(window.locator('[data-testid="workflow-phase-reconcile"]')).toBeDisabled();
    await expect(window.locator('[data-testid="launch-task-card"]')).toContainText(
      'Last prescreen task',
    );

    await window.click('[data-testid="reviewer-a-selector"] button[role="combobox"]');
    await window.click('[data-testid="reviewer-option-alice"]');
    await window.click('[data-testid="reviewer-b-selector"] button[role="combobox"]');
    await window.click('[data-testid="reviewer-option-bob"]');
    await clickWhenEnabled(window, '[data-testid="launch-managed-task-btn"]', 30_000);
    await window.waitForSelector('[data-testid="continue-to-review-btn"]', { timeout: 120_000 });

    // The reconciled first round does not tick Reconcile for this one.
    await expectPhases(window, { launch: 'complete', review: 'pending', reconcile: 'pending' });
    await expect(window.locator('[data-testid="reviewer-progress-alice"]')).toHaveText(
      `0 / ${newRecordCount}`,
    );
    await workspace.markPhase(electronApp, 'round-two-launched');

    // ---------------------------------------------------------------------
    // Alice reviews, then leaves the review with her decisions unsaved.
    // ---------------------------------------------------------------------
    await window.click('[data-testid="workflow-phase-review"]');
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 60_000 });
    await waitForBranch(window, 'review/');
    const aliceBranch = await window.evaluate(
      () => (self as any).__pinia__._s.get('git').currentBranch as string,
    );
    const launchCommit = git(bare, ['rev-parse', aliceBranch]);

    await decideEverything(window, ['include', 'exclude']);
    await expectPhases(window, { launch: 'complete', review: 'complete', reconcile: 'pending' });
    // Reconciliation reads decisions from the remote; unsaved ones keep it shut.
    await expect(window.locator('[data-testid="workflow-phase-reconcile"]')).toBeDisabled();

    await window.click('[data-testid="workflow-phase-launch"]');
    const dialog = window.locator('[data-testid="branch-switch-blocked-dialog"]');
    await expect(dialog).toContainText('Save your decisions before leaving the review');
    await clickWhenEnabled(window, '[data-testid="branch-switch-blocked-save"]', 10_000);
    await waitForBranch(window, 'dev');

    // Saved *and shared*: her branch on the remote moved past the launch.
    await expect
      .poll(() => git(bare, ['rev-parse', aliceBranch]), { timeout: 60_000 })
      .not.toBe(launchCommit);
    expect(git(bare, ['rev-parse', aliceBranch])).toBe(git(aliceProject, ['rev-parse', aliceBranch]));
    // The stepper carried on to where she was heading, once.
    await window.waitForSelector('[data-testid="launch-task-card"]', { timeout: 30_000 });
    await expect(dialog).toBeHidden();
    await expect(window.locator('[data-testid="reviewer-progress-alice"]')).toHaveText(
      `${newRecordCount} / ${newRecordCount}`,
      { timeout: 30_000 },
    );
    await workspace.markPhase(electronApp, 'alice-shared');

    // ---------------------------------------------------------------------
    // Bob sees Alice's progress, reviews, and reconciles.
    // ---------------------------------------------------------------------
    execFileSync('git', ['fetch', 'origin'], { cwd: bobProject, stdio: 'pipe' });
    execFileSync('git', ['merge', '--ff-only', 'origin/dev'], { cwd: bobProject, stdio: 'pipe' });
    await switchAccount(electronApp, BOB.login);
    await openReview(window);
    await gotoStep(window, '/prescreen');
    await window.waitForSelector('[data-testid="continue-to-review-btn"]', { timeout: 60_000 });
    await expect(window.locator('[data-testid="reviewer-progress-alice"]')).toHaveText(
      `${newRecordCount} / ${newRecordCount}`,
      { timeout: 30_000 },
    );
    await expect(window.locator('[data-testid="reviewer-progress-bob"]')).toHaveText(
      `0 / ${newRecordCount}`,
    );

    await window.click('[data-testid="workflow-phase-review"]');
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 60_000 });
    await waitForBranch(window, 'review/');
    await decideEverything(window, ['exclude', 'include']);

    await clickWhenEnabled(window, '[data-testid="prescreen-save-to-remote"]', 30_000);
    await clickWhenEnabled(window, '[data-testid="prescreen-continue-reconcile-btn"]', 60_000);
    await waitForBranch(window, 'dev');

    const walkthrough = window.locator('[data-testid="reconcile-walkthrough"]');
    await walkthrough.waitFor({ state: 'visible', timeout: 60_000 });
    const decisionBar = window.locator('[data-testid="reconcile-decision-bar"]');
    const applyBtn = window.locator('[data-testid="reconcile-apply-btn"]');
    for (let i = 0; i < 20; i++) {
      if (await applyBtn.isVisible().catch(() => false)) break;
      await decisionBar.waitFor({ state: 'visible', timeout: 30_000 });
      const recordId = (await window.textContent('[data-testid="reconcile-record-id"]'))?.trim();
      await clickWhenEnabled(
        window,
        `[data-testid="reconcile-btn-${i % 2 === 0 ? 'include' : 'exclude'}"]`,
        30_000,
      );
      await window.waitForFunction(
        (prev) => {
          const txt = (document.querySelector('[data-testid="reconcile-record-id"]')?.textContent ?? '').trim();
          return !document.querySelector('[data-testid="reconcile-decision-bar"]') || (txt.length > 0 && txt !== prev);
        },
        recordId,
        { timeout: 30_000 },
      );
    }
    await clickWhenEnabled(window, '[data-testid="reconcile-apply-btn"]', 30_000);
    await window.getByText('Reconciliation applied').waitFor({ state: 'visible', timeout: 120_000 });
    await workspace.markPhase(electronApp, 'round-two-reconciled');

    // ---------------------------------------------------------------------
    // Round two is finished, and the pipeline has moved on to PDFs.
    // ---------------------------------------------------------------------
    await expectPhases(window, { launch: 'complete', review: 'complete', reconcile: 'complete' });
    await expectSidebar(window, {
      prescreen: 'complete',
      pdfs: 'active',
      screen: 'pending',
      data: 'pending',
    });
  });

  test('decisions an older app saved but never pushed are shared on arrival', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    // Alice's decisions are on the remote. A later change of hers was
    // committed on her reviewer branch and never pushed — what the old
    // save-then-switch dialog left behind.
    const aliceProject = projectPath(workspace, ALICE.login);
    const bare = workspace.bareRemotePath(ALICE.login, DEFAULT_PROJECT_ID);
    const aliceBranch = git(aliceProject, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/review/'])
      .split('\n')
      .find((b) => b.endsWith(`/${ALICE.login}`))!;
    git(aliceProject, ['checkout', aliceBranch]);
    const bibPath = path.join(aliceProject, 'data', 'records.bib');
    const bib = fs.readFileSync(bibPath, 'utf-8');
    fs.writeFileSync(
      bibPath,
      bib.replace(/(colrev_status\s*=\s*\{)rev_prescreen_excluded(\})/, '$1rev_prescreen_included$2'),
    );
    git(aliceProject, ['commit', '-am', 'Save before switching to dev', '--no-verify']);
    git(aliceProject, ['checkout', 'dev']);
    const localHead = git(aliceProject, ['rev-parse', aliceBranch]);
    expect(git(bare, ['rev-parse', aliceBranch])).not.toBe(localHead);

    await openReview(window);
    await waitForBranch(window, 'dev');
    await gotoStep(window, '/prescreen');
    await window.waitForSelector('[data-testid="managed-review-prescreen"]', { timeout: 30_000 });

    await expect
      .poll(() => git(bare, ['rev-parse', aliceBranch]), { timeout: 60_000 })
      .toBe(localHead);
    await expect(window.getByText('Shared your saved decisions')).toBeVisible({ timeout: 30_000 });
    // Nothing is left marked as unshared, and the next step is reconciliation.
    await expect(window.locator('[data-testid^="reviewer-unshared-"]')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(window.locator('[data-testid="continue-to-reconcile-btn"]')).toBeVisible({
      timeout: 30_000,
    });
    await workspace.markPhase(electronApp, 'unshared-decisions-shared');
  });
});
