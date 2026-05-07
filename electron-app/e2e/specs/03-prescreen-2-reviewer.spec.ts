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
  createDevBranches,
  decideAllRecords,
  prescreenDecide,
} from '../helpers/multi-reviewer';
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

// Extend the base test to load post-preprocessing before Electron launches
const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    const cache = createCache();
    cache.load('post-preprocessing', ws.root);
    createDevBranches(ws);

    await use(ws);
  },
});

async function prescreenAllRecords(
  window: Page,
  pattern: ('include' | 'exclude')[],
): Promise<{ included: number; excluded: number }> {
  return decideAllRecords(window, {
    cardTestid: 'prescreen-record-card',
    completeTestid: 'prescreen-complete',
    recordIdTestid: 'prescreen-record-id',
    decide: prescreenDecide(60_000),
    pattern,
  });
}

test.describe('prescreen-2-reviewer', () => {
  test('both reviewers complete prescreen from post-preprocessing', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );
    const bobProjectPath = path.join(
      workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
    );
    const barePath = workspace.bareRemotePath('alice', DEFAULT_PROJECT_ID);

    // ---------------------------------------------------------------
    // Phase 1: App launch + navigate to project as Alice
    // ---------------------------------------------------------------
    console.log('[prescreen-2r] waiting for app mount');
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });

    console.log('[prescreen-2r] waiting for backend');
    await waitForBackendReady(window);

    // Wait for the local project to appear on the landing page
    console.log('[prescreen-2r] opening Alice project');
    const projectRow = window.locator('[data-testid="project-row-lit-review"]');
    await projectRow.waitFor({ state: 'visible', timeout: 30_000 });
    await projectRow.click();

    // Wait for the project to load (route changes to /project/lit-review)
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    // Wait for git to settle on dev branch
    await window.waitForFunction(
      () => {
        const pinia = (self as any).__pinia__;
        const g = pinia?._s.get('git');
        return g && g.currentBranch === 'dev';
      },
      { timeout: 30_000 },
    );

    await workspace.markPhase(electronApp, 'alice-project-open');

    // ---------------------------------------------------------------
    // Phase 2: Navigate to prescreen and create managed review task
    // ---------------------------------------------------------------
    console.log('[prescreen-2r] navigating to prescreen');
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/prescreen',
      );
    });

    await window.waitForSelector('[data-testid="managed-review-prescreen"]', {
      timeout: 30_000,
    });

    // Wait for the launch panel to load readiness and collaborators
    console.log('[prescreen-2r] waiting for launch panel readiness');
    await window.waitForSelector('[data-testid="reviewer-a-selector"]', {
      timeout: 30_000,
    });

    // Select Alice as Reviewer A
    console.log('[prescreen-2r] selecting reviewers');
    await window.click('[data-testid="reviewer-a-selector"] button[role="combobox"]');
    await window.waitForSelector('[data-testid="reviewer-option-alice"]', { timeout: 5_000 });
    await window.click('[data-testid="reviewer-option-alice"]');

    // Select Bob as Reviewer B
    await window.click('[data-testid="reviewer-b-selector"] button[role="combobox"]');
    await window.waitForSelector('[data-testid="reviewer-option-bob"]', { timeout: 5_000 });
    await window.click('[data-testid="reviewer-option-bob"]');

    // Launch the managed review task
    console.log('[prescreen-2r] launching managed review task');
    await clickWhenEnabled(window, '[data-testid="launch-managed-task-btn"]', 10_000);

    // Wait for the Review phase button to become clickable (task created)
    await window.waitForSelector(
      '[data-testid="workflow-phase-review"]:not([disabled])',
      { timeout: 60_000 },
    );

    await workspace.markPhase(electronApp, 'task-launched');

    // ---------------------------------------------------------------
    // Phase 3: Alice prescreens all 3 records
    // ---------------------------------------------------------------
    console.log('[prescreen-2r] clicking Review phase');
    await window.click('[data-testid="workflow-phase-review"]');

    // Wait for PrescreenPage to load and auto-switch to reviewer branch
    await window.waitForSelector('[data-testid="prescreen-page"]', { timeout: 30_000 });

    // Wait for the queue to load (first record visible)
    await window.waitForSelector('[data-testid="prescreen-record-card"]', {
      timeout: 30_000,
    });

    // Alice prescreens every record presented. Pattern: include, exclude,
    // include, … so reviewers' decisions disagree on roughly half (Bob uses
    // the inverse pattern below).
    console.log('[prescreen-2r] Alice: deciding all records (include/exclude alternating)');
    const aliceCounts = await prescreenAllRecords(window, ['include', 'exclude']);

    // Wait for completion screen
    const aliceComplete = window.locator('[data-testid="prescreen-complete"]');
    await aliceComplete.waitFor({ state: 'visible', timeout: 30_000 });

    const aliceTotal = await window.textContent('[data-testid="prescreen-complete-total"]');
    expect(Number(aliceTotal?.trim())).toBe(aliceCounts.included + aliceCounts.excluded);
    expect(aliceCounts.included).toBeGreaterThan(0);
    expect(aliceCounts.excluded).toBeGreaterThan(0);
    expect(aliceCounts.included + aliceCounts.excluded).toBeGreaterThanOrEqual(6);

    // Save to remote
    console.log('[prescreen-2r] Alice: saving to remote');
    await clickWhenEnabled(window, '[data-testid="prescreen-save-to-remote"]', 10_000);

    // Wait for the save to complete (button disappears or unsaved hint disappears)
    await window.waitForFunction(
      () => !document.querySelector('[data-testid="prescreen-unsaved-hint"]'),
      { timeout: 30_000 },
    );

    await workspace.markPhase(electronApp, 'alice-saved');

    // ---------------------------------------------------------------
    // Phase 4: Prepare Bob's clone then switch account
    // ---------------------------------------------------------------
    console.log('[prescreen-2r] preparing Bob clone');
    execFileSync('git', ['fetch', 'origin'], {
      cwd: bobProjectPath, stdio: 'pipe',
    });
    execFileSync('git', ['merge', 'origin/dev', '--ff-only'], {
      cwd: bobProjectPath, stdio: 'pipe',
    });

    console.log('[prescreen-2r] switching to Bob');
    await switchAccount(electronApp, BOB.login);

    // Wait for landing page after account switch
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });

    await workspace.markPhase(electronApp, 'bob-active');

    // ---------------------------------------------------------------
    // Phase 5: Bob navigates to project and prescreens
    // ---------------------------------------------------------------
    console.log('[prescreen-2r] opening Bob project');

    // Wait for Bob's project to appear in the projects list
    const bobProjectRow = window.locator('[data-testid="project-row-lit-review"]');
    await bobProjectRow.waitFor({ state: 'visible', timeout: 30_000 });
    await bobProjectRow.click();

    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    // Navigate to prescreen
    console.log('[prescreen-2r] Bob: navigating to prescreen');
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/prescreen',
      );
    });

    await window.waitForSelector('[data-testid="managed-review-prescreen"]', {
      timeout: 30_000,
    });

    // Click the Review phase button to enter review mode
    await window.waitForSelector(
      '[data-testid="workflow-phase-review"]:not([disabled])',
      { timeout: 30_000 },
    );
    await window.click('[data-testid="workflow-phase-review"]');

    // Wait for PrescreenPage to load and auto-switch to Bob's reviewer branch
    await window.waitForSelector('[data-testid="prescreen-page"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="prescreen-record-card"]', {
      timeout: 30_000,
    });

    // Bob uses the inverse pattern so reviewers disagree on roughly half.
    console.log('[prescreen-2r] Bob: deciding all records (exclude/include alternating)');
    const bobCounts = await prescreenAllRecords(window, ['exclude', 'include']);

    const bobComplete = window.locator('[data-testid="prescreen-complete"]');
    await bobComplete.waitFor({ state: 'visible', timeout: 30_000 });

    const bobTotal = await window.textContent('[data-testid="prescreen-complete-total"]');
    expect(Number(bobTotal?.trim())).toBe(bobCounts.included + bobCounts.excluded);
    expect(bobCounts.included).toBeGreaterThan(0);
    expect(bobCounts.excluded).toBeGreaterThan(0);
    // Same record set as Alice
    expect(bobCounts.included + bobCounts.excluded).toBe(
      aliceCounts.included + aliceCounts.excluded,
    );

    // Save to remote
    console.log('[prescreen-2r] Bob: saving to remote');
    await clickWhenEnabled(window, '[data-testid="prescreen-save-to-remote"]', 10_000);
    await window.waitForFunction(
      () => !document.querySelector('[data-testid="prescreen-unsaved-hint"]'),
      { timeout: 30_000 },
    );

    await workspace.markPhase(electronApp, 'bob-saved');

    // ---------------------------------------------------------------
    // Assertions: git history on the bare remote
    // ---------------------------------------------------------------
    console.log('[prescreen-2r] verifying bare remote');

    const remoteBranches = execFileSync(
      'git', ['branch', '-a'],
      { cwd: barePath, encoding: 'utf-8' },
    ).trim();
    expect(remoteBranches).toContain('dev');

    // Both reviewer branches should exist on the bare remote
    const remoteRefs = execFileSync(
      'git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
      { cwd: barePath, encoding: 'utf-8' },
    ).trim().split('\n');
    const reviewerBranches = remoteRefs.filter((r) => r.startsWith('review/'));
    expect(reviewerBranches).toHaveLength(2);

    // Alice's reviewer branch should have prescreen commits
    const aliceBranch = reviewerBranches.find((b) => b.includes('alice'));
    expect(aliceBranch).toBeDefined();
    const aliceLog = execFileSync(
      'git', ['log', '--oneline', aliceBranch!],
      { cwd: barePath, encoding: 'utf-8' },
    ).trim();
    expect(aliceLog).toContain('rescreen');

    // Bob's reviewer branch should have prescreen commits
    const bobBranch = reviewerBranches.find((b) => b.includes('bob'));
    expect(bobBranch).toBeDefined();
    const bobLog = execFileSync(
      'git', ['log', '--oneline', bobBranch!],
      { cwd: barePath, encoding: 'utf-8' },
    ).trim();
    expect(bobLog).toContain('rescreen');

    // ---------------------------------------------------------------
    // Assertions: files on disk
    // ---------------------------------------------------------------
    console.log('[prescreen-2r] verifying files on disk');

    // Alice's project dir should exist with records
    expect(fs.existsSync(path.join(aliceProjectPath, 'data', 'records.bib'))).toBe(true);

    // Bob's project dir should exist with records
    expect(fs.existsSync(path.join(bobProjectPath, 'data', 'records.bib'))).toBe(true);

    // Read Alice's records to verify statuses changed from md_processed
    const aliceRecords = fs.readFileSync(
      path.join(aliceProjectPath, 'data', 'records.bib'), 'utf-8',
    );
    expect(aliceRecords).not.toContain('colrev_status = {md_processed}');
    expect(aliceRecords).toContain('rev_prescreen_included');
    expect(aliceRecords).toContain('rev_prescreen_excluded');

    // Read Bob's records to verify statuses changed
    const bobRecords = fs.readFileSync(
      path.join(bobProjectPath, 'data', 'records.bib'), 'utf-8',
    );
    expect(bobRecords).not.toContain('colrev_status = {md_processed}');
    expect(bobRecords).toContain('rev_prescreen_included');
    expect(bobRecords).toContain('rev_prescreen_excluded');

    console.log('[prescreen-2r] proof-of-life complete');

    if (process.env.BUILD_FIXTURES === '1') {
      const cache2 = createCache();
      cache2.checkpoint('post-prescreen', workspace.root);
    }
  });
});
