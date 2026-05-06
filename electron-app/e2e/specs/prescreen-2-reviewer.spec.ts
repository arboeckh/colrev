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
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');

const BACKEND_TIMEOUT = 45_000;

function createCache(): SnapshotCache {
  return new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS });
}

function createDevBranches(workspace: TestWorkspace): void {
  const aliceProject = path.join(
    workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
  );
  const bobProject = path.join(
    workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
  );

  execFileSync('git', ['checkout', '-b', 'dev'], {
    cwd: aliceProject, stdio: 'pipe',
  });
  execFileSync('git', ['push', '-u', 'origin', 'dev'], {
    cwd: aliceProject, stdio: 'pipe',
  });

  execFileSync('git', ['fetch', 'origin'], {
    cwd: bobProject, stdio: 'pipe',
  });
  execFileSync('git', ['checkout', '-b', 'dev', '--track', 'origin/dev'], {
    cwd: bobProject, stdio: 'pipe',
  });
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

// Extend the base test to load L4 before Electron launches
const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    const cache = createCache();
    cache.load('L4', ws.root);
    createDevBranches(ws);

    await use(ws);
  },
});

test.describe('prescreen-2-reviewer', () => {
  test('both reviewers complete prescreen from L4', async ({
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

    // Record 1: Include
    console.log('[prescreen-2r] Alice: deciding record 1 (include)');
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 10_000);

    // Record 2: Exclude
    console.log('[prescreen-2r] Alice: deciding record 2 (exclude)');
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-exclude"]', 10_000);

    // Record 3: Include
    console.log('[prescreen-2r] Alice: deciding record 3 (include)');
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 10_000);

    // Wait for completion screen
    console.log('[prescreen-2r] Alice: waiting for completion');
    const aliceComplete = window.locator('[data-testid="prescreen-complete"]');
    await aliceComplete.waitFor({ state: 'visible', timeout: 30_000 });

    // Assert Alice's completion counts
    const aliceIncluded = await window.textContent(
      '[data-testid="prescreen-complete-included"]',
    );
    const aliceExcluded = await window.textContent(
      '[data-testid="prescreen-complete-excluded"]',
    );
    const aliceTotal = await window.textContent(
      '[data-testid="prescreen-complete-total"]',
    );
    expect(aliceIncluded?.trim()).toBe('2');
    expect(aliceExcluded?.trim()).toBe('1');
    expect(aliceTotal?.trim()).toBe('3');

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

    // Record 1: Exclude (different from Alice)
    console.log('[prescreen-2r] Bob: deciding record 1 (exclude)');
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-exclude"]', 10_000);

    // Record 2: Include (different from Alice)
    console.log('[prescreen-2r] Bob: deciding record 2 (include)');
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 10_000);

    // Record 3: Exclude (different from Alice)
    console.log('[prescreen-2r] Bob: deciding record 3 (exclude)');
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-exclude"]', 10_000);

    // Wait for completion screen
    console.log('[prescreen-2r] Bob: waiting for completion');
    const bobComplete = window.locator('[data-testid="prescreen-complete"]');
    await bobComplete.waitFor({ state: 'visible', timeout: 30_000 });

    // Assert Bob's completion counts
    const bobIncluded = await window.textContent(
      '[data-testid="prescreen-complete-included"]',
    );
    const bobExcluded = await window.textContent(
      '[data-testid="prescreen-complete-excluded"]',
    );
    const bobTotal = await window.textContent(
      '[data-testid="prescreen-complete-total"]',
    );
    expect(bobIncluded?.trim()).toBe('1');
    expect(bobExcluded?.trim()).toBe('2');
    expect(bobTotal?.trim()).toBe('3');

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
  });
});
