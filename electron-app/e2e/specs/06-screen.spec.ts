/**
 * Slice 8 — full-text screen stage.
 *
 * Loads `post-pdf-get-man`. Alice's dev contains the pdf_get_man commits but
 * was never pushed in slice 7, so we sync dev across clones first. Then:
 *   Phase A: configure 1 inclusion + 1 exclusion criterion via the launch
 *            panel, verify settings.json carries them.
 *   Phase B: launch the screen task, walk both reviewers through the queue
 *            (alternating include/exclude pattern), save, reconcile to dev.
 *
 * Assumption (per plan): pick a deterministic per-record pattern. Alice
 * alternates include/exclude; Bob uses the inverse pattern. Reconcile follows
 * alice's branch verbatim — slice 8 doesn't exercise the manual reconciliation
 * UI, only the ff-merge that pushes screen decisions onto dev for downstream.
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
  BOB,
  DEFAULT_PROJECT_ID,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { clickWhenEnabled } from '../helpers/test-utils';
import {
  decideAllRecords,
  reconcileReviewerToDev,
  screenDecide,
  simulateBibTransition,
  syncDevAcrossClones,
} from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;

const INCLUSION_NAME = 'population';
const INCLUSION_EXPLANATION = 'Adults with PAH';
const EXCLUSION_NAME = 'study_design';
const EXCLUSION_EXPLANATION = 'Animal studies';

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
    cache.load('post-pdf-get-man', ws.root);

    // pdf_get_man committed to alice's dev but never pushed. Push it so bob's
    // clone gets the same pdf_imported/pdf_prepared records when he opens the
    // project later in this spec.
    syncDevAcrossClones(ws);

    // pdf_prep needs grobid (Docker) and the test harness has no Docker, so
    // pdf_imported records can't transition via the UI. Slice 8 tests the
    // screen UI only — flip the upstream states directly so the screen queue
    // is non-empty. Drives bob's clone too via syncDevAcrossClones.
    const flipped = simulateBibTransition(
      ws,
      ['pdf_imported', 'pdf_needs_manual_preparation'],
      'pdf_prepared',
    );
    if (flipped === 0) {
      throw new Error(
        'No pdf_imported/pdf_needs_manual_preparation records to simulate-prep',
      );
    }

    // Slice 7 already sets alice as activeLogin in auth.json before the
    // checkpoint; reaffirm in case the cache layout changes.
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = ALICE.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

    await use(ws);
  },
});

test.describe('screen', () => {
  test('configure criteria, both reviewers screen all eligible records', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(420_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );
    const bobProjectPath = path.join(
      workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
    );
    const barePath = workspace.bareRemotePath('alice', DEFAULT_PROJECT_ID);
    const aliceRecordsPath = path.join(aliceProjectPath, 'data', 'records.bib');
    const aliceSettingsPath = path.join(aliceProjectPath, 'settings.json');

    // After simulateBibTransition the bib has pdf_prepared records ready to
    // screen.
    const initial = parseRecordsBib(aliceRecordsPath);
    const screenable = initial.filter((r) => r.status === 'pdf_prepared');
    expect(
      screenable.length,
      'fixture must produce pdf_prepared records to screen',
    ).toBeGreaterThan(0);

    // ---------------------------------------------------------------
    // Phase 1: app + backend ready, open Alice project
    // ---------------------------------------------------------------
    console.log('[screen] waiting for app mount');
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    console.log('[screen] opening Alice project');
    await window.locator('[data-testid="project-row-lit-review"]').click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    // Wait for git to settle on dev branch — criteria editing requires it.
    await window.waitForFunction(
      () => {
        const pinia = (self as any).__pinia__;
        const g = pinia?._s.get('git');
        return g && g.currentBranch === 'dev';
      },
      { timeout: 30_000 },
    );

    // ---------------------------------------------------------------
    // Phase A: configure criteria via launch panel
    // ---------------------------------------------------------------
    console.log('[screen] navigating to /screen (Launch phase)');
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/screen',
      );
    });
    await window.waitForSelector('[data-testid="managed-review-screen"]', {
      timeout: 30_000,
    });
    await window.waitForSelector('[data-testid="add-criterion-inline-btn"]', {
      timeout: 30_000,
    });

    async function addCriterion(
      name: string,
      explanation: string,
      type: 'inclusion_criterion' | 'exclusion_criterion',
    ) {
      await clickWhenEnabled(window, '[data-testid="add-criterion-inline-btn"]', 10_000);
      await window.waitForSelector('[data-testid="criterion-add-form"]', { timeout: 10_000 });
      await window.fill('[data-testid="criterion-name-input"]', name);
      await window.selectOption('[data-testid="criterion-type-select"]', type);
      await window.fill('[data-testid="criterion-explanation-input"]', explanation);
      await clickWhenEnabled(window, '[data-testid="criterion-save-btn"]', 10_000);
      // After save the inline editor unmounts and the new criterion is rendered.
      await window.waitForSelector(
        `[data-testid="criterion-view-${name}"]`,
        { timeout: 15_000 },
      );
    }

    console.log('[screen] adding inclusion criterion');
    await addCriterion(INCLUSION_NAME, INCLUSION_EXPLANATION, 'inclusion_criterion');
    console.log('[screen] adding exclusion criterion');
    await addCriterion(EXCLUSION_NAME, EXCLUSION_EXPLANATION, 'exclusion_criterion');

    // Verify settings.json on disk carries both criteria.
    const settingsRaw = fs.readFileSync(aliceSettingsPath, 'utf-8');
    const settings = JSON.parse(settingsRaw);
    expect(settings.screen).toBeDefined();
    expect(settings.screen.criteria).toBeDefined();
    expect(settings.screen.criteria[INCLUSION_NAME]).toMatchObject({
      explanation: INCLUSION_EXPLANATION,
      criterion_type: 'inclusion_criterion',
    });
    expect(settings.screen.criteria[EXCLUSION_NAME]).toMatchObject({
      explanation: EXCLUSION_EXPLANATION,
      criterion_type: 'exclusion_criterion',
    });

    await workspace.markPhase(electronApp, 'criteria-saved');

    // Adding criteria stages settings.json but doesn't auto-commit. Launch
    // readiness requires a clean tree, so drive the UI's existing
    // pending-changes commit + push pathway. (Same pattern ScreenComplete
    // uses for "Save to remote".)
    await window.waitForFunction(async () => {
      const pinia = (self as any).__pinia__;
      const pending = pinia?._s.get('pendingChanges');
      const git = pinia?._s.get('git');
      if (!pending || !git) return false;
      if (pending.hasPending) {
        const ok = await pending.commit('screen: add criteria');
        if (!ok) return false;
        await git.refreshStatus?.();
      }
      if (git.hasRemote && git.ahead > 0) {
        await git.push();
      }
      await git.refreshStatus?.();
      return git.isClean && git.ahead === 0;
    }, { timeout: 30_000 });

    // ---------------------------------------------------------------
    // Phase B: launch screen task with alice + bob as reviewers
    // ---------------------------------------------------------------
    console.log('[screen] selecting reviewers');
    await window.waitForSelector('[data-testid="reviewer-a-selector"]', {
      timeout: 30_000,
    });
    await window.click('[data-testid="reviewer-a-selector"] button[role="combobox"]');
    await window.waitForSelector('[data-testid="reviewer-option-alice"]', {
      timeout: 5_000,
    });
    await window.click('[data-testid="reviewer-option-alice"]');

    await window.click('[data-testid="reviewer-b-selector"] button[role="combobox"]');
    await window.waitForSelector('[data-testid="reviewer-option-bob"]', {
      timeout: 5_000,
    });
    await window.click('[data-testid="reviewer-option-bob"]');

    console.log('[screen] launching screen task');
    await clickWhenEnabled(window, '[data-testid="launch-managed-task-btn"]', 10_000);

    await window.waitForSelector(
      '[data-testid="workflow-phase-review"]:not([disabled])',
      { timeout: 60_000 },
    );

    await workspace.markPhase(electronApp, 'task-launched');

    // ---------------------------------------------------------------
    // Phase B.1: Alice screens all eligible records
    // ---------------------------------------------------------------
    console.log('[screen] entering Review phase as Alice');
    await window.click('[data-testid="workflow-phase-review"]');
    await window.waitForSelector('[data-testid="screen-page"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="screen-record-card"]', {
      timeout: 60_000,
    });

    const aliceCounts = await decideAllRecords(window, {
      cardTestid: 'screen-record-card',
      completeTestid: 'screen-complete',
      recordIdTestid: 'screen-record-id',
      decide: screenDecide({
        inclusionName: INCLUSION_NAME,
        exclusionName: EXCLUSION_NAME,
      }, 60_000),
      pattern: ['include', 'exclude'],
      perDecisionTimeout: 60_000,
    });

    expect(aliceCounts.included + aliceCounts.excluded).toBe(screenable.length);
    if (screenable.length >= 2) {
      expect(aliceCounts.included).toBeGreaterThan(0);
      expect(aliceCounts.excluded).toBeGreaterThan(0);
    }
    // The screen-complete widget reads from overallCounts which aggregates
    // historical states; don't cross-check it here.

    console.log('[screen] Alice: saving to remote');
    await clickWhenEnabled(window, '[data-testid="screen-save-to-remote"]', 10_000);
    await window.waitForFunction(
      () => !document.querySelector('[data-testid="screen-unsaved-hint"]'),
      { timeout: 30_000 },
    );

    await workspace.markPhase(electronApp, 'alice-saved');

    // ---------------------------------------------------------------
    // Phase B.2: switch to bob and screen the same set
    // ---------------------------------------------------------------
    console.log('[screen] preparing Bob clone');
    execFileSync('git', ['fetch', 'origin'], {
      cwd: bobProjectPath, stdio: 'pipe',
    });
    execFileSync('git', ['merge', 'origin/dev', '--ff-only'], {
      cwd: bobProjectPath, stdio: 'pipe',
    });

    console.log('[screen] switching to Bob');
    await switchAccount(electronApp, BOB.login);
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });

    console.log('[screen] opening Bob project');
    await window.locator('[data-testid="project-row-lit-review"]').click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );

    console.log('[screen] Bob: navigating to /screen');
    await window.evaluate(() => {
      location.hash = location.hash.replace(
        /\/project\/([^/]+).*$/,
        '/project/$1/screen',
      );
    });
    await window.waitForSelector('[data-testid="managed-review-screen"]', {
      timeout: 30_000,
    });
    await window.waitForSelector(
      '[data-testid="workflow-phase-review"]:not([disabled])',
      { timeout: 30_000 },
    );
    await window.click('[data-testid="workflow-phase-review"]');

    await window.waitForSelector('[data-testid="screen-page"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="screen-record-card"]', {
      timeout: 60_000,
    });

    const bobCounts = await decideAllRecords(window, {
      cardTestid: 'screen-record-card',
      completeTestid: 'screen-complete',
      recordIdTestid: 'screen-record-id',
      decide: screenDecide({
        inclusionName: INCLUSION_NAME,
        exclusionName: EXCLUSION_NAME,
      }, 60_000),
      // Inverse pattern so reviewers disagree on roughly half.
      pattern: ['exclude', 'include'],
      perDecisionTimeout: 60_000,
    });

    expect(bobCounts.included + bobCounts.excluded).toBe(
      aliceCounts.included + aliceCounts.excluded,
    );
    if (screenable.length >= 2) {
      expect(bobCounts.included).toBeGreaterThan(0);
      expect(bobCounts.excluded).toBeGreaterThan(0);
    }

    console.log('[screen] Bob: saving to remote');
    await clickWhenEnabled(window, '[data-testid="screen-save-to-remote"]', 10_000);
    await window.waitForFunction(
      () => !document.querySelector('[data-testid="screen-unsaved-hint"]'),
      { timeout: 30_000 },
    );

    await workspace.markPhase(electronApp, 'bob-saved');

    // ---------------------------------------------------------------
    // Reconcile alice's reviewer branch to dev (downstream stages — slice 9
    // — read decisions from dev). Reconciliation UI isn't exercised here.
    // ---------------------------------------------------------------
    console.log('[screen] reconciling alice → dev');
    reconcileReviewerToDev(workspace, 'screen');

    await workspace.markPhase(electronApp, 'screen-done');

    // ---------------------------------------------------------------
    // Assertions
    // ---------------------------------------------------------------
    console.log('[screen] verifying records.bib');
    const finalAlice = parseRecordsBib(aliceRecordsPath);

    // No screen-eligible records left (everything pdf_prepared moved).
    const stillPdfPrepared = finalAlice.filter((r) => r.status === 'pdf_prepared');
    expect(stillPdfPrepared.length).toBe(0);

    // Decisions should match the screenable count.
    const included = finalAlice.filter((r) => r.status === 'rev_included');
    const excluded = finalAlice.filter((r) => r.status === 'rev_excluded');
    expect(included.length + excluded.length).toBe(screenable.length);
    if (screenable.length >= 2) {
      expect(included.length).toBeGreaterThan(0);
      expect(excluded.length).toBeGreaterThan(0);
    }

    // Bare remote should have dev + both reviewer branches.
    const remoteRefs = execFileSync(
      'git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
      { cwd: barePath, encoding: 'utf-8' },
    ).trim().split('\n');
    expect(remoteRefs).toContain('dev');
    const reviewerBranches = remoteRefs.filter((r) => r.startsWith('review/'));
    // Prescreen left two; screen launches a new pair → 4 total.
    expect(reviewerBranches.length).toBeGreaterThanOrEqual(2);
    expect(reviewerBranches.some((b) => b.includes('alice'))).toBe(true);
    expect(reviewerBranches.some((b) => b.includes('bob'))).toBe(true);

    if (process.env.BUILD_FIXTURES === '1') {
      try {
        await electronApp.close();
      } catch {
        // already closed
      }
      const cache2 = createCache();
      cache2.checkpoint('post-screen', workspace.root);
    }
  });
});
