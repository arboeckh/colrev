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
import { createDevBranches } from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
    new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS })
      .load('post-preprocessing', ws.root);
    createDevBranches(ws);
    await use(ws);
  },
});

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

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

async function currentBranch(window: Page): Promise<string> {
  return window.evaluate(() => {
    const pinia = (self as any).__pinia__;
    return pinia?._s.get('git')?.currentBranch as string;
  });
}

async function waitForBranchEquals(window: Page, name: string, timeout = 30_000) {
  await window.waitForFunction(
    (expected) => {
      const pinia = (self as any).__pinia__;
      return pinia?._s.get('git')?.currentBranch === expected;
    },
    name,
    { timeout },
  );
}

async function waitForBranchPrefix(window: Page, prefix: string, timeout = 30_000) {
  await window.waitForFunction(
    (expected) => {
      const branch = (self as any).__pinia__?._s.get('git')?.currentBranch as string | undefined;
      return typeof branch === 'string' && branch.startsWith(expected);
    },
    prefix,
    { timeout },
  );
}

/**
 * WP-07 §1 regression: a dirty working tree must never be silently stashed or
 * carried across a branch switch. `git:checkout` refuses, the renderer asks,
 * and the reviewer's decisions survive the round trip.
 */
test.describe('branch-switch-safety', () => {
  test('decisions survive a branch switch triggered mid-queue', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    const aliceProjectPath = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );

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
    await waitForBranchEquals(window, 'dev');

    // --- Launch a managed prescreen task so a reviewer branch exists --------
    await window.evaluate(() => {
      location.hash = location.hash.replace(/\/project\/([^/]+).*$/, '/project/$1/prescreen');
    });
    await window.waitForSelector('[data-testid="managed-review-prescreen"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="reviewer-a-selector"]', { timeout: 30_000 });

    await window.click('[data-testid="reviewer-a-selector"] button[role="combobox"]');
    await window.waitForSelector('[data-testid="reviewer-option-alice"]', { timeout: 5_000 });
    await window.click('[data-testid="reviewer-option-alice"]');
    await window.click('[data-testid="reviewer-b-selector"] button[role="combobox"]');
    await window.waitForSelector('[data-testid="reviewer-option-bob"]', { timeout: 5_000 });
    await window.click('[data-testid="reviewer-option-bob"]');

    await clickWhenEnabled(window, '[data-testid="launch-managed-task-btn"]', 10_000);
    await window.waitForSelector('[data-testid="workflow-phase-review"]:not([disabled])', {
      timeout: 60_000,
    });

    // --- Enter the queue (auto-switches onto the reviewer branch) -----------
    await window.click('[data-testid="workflow-phase-review"]');
    await window.waitForSelector('[data-testid="prescreen-page"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 30_000 });
    await waitForBranchPrefix(window, 'review/');

    const reviewerBranch = await currentBranch(window);
    const firstRecordId = (
      await window.textContent('[data-testid="prescreen-record-id"]')
    )?.trim();
    expect(firstRecordId).toBeTruthy();

    // --- One decision: leaves records.bib dirty by design -------------------
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 60_000);
    await window.waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-testid="prescreen-record-id"]');
        const txt = (el?.textContent ?? '').trim();
        return txt.length > 0 && txt !== prev;
      },
      firstRecordId,
      { timeout: 60_000 },
    );

    expect(git(aliceProjectPath, ['status', '--porcelain'])).not.toBe('');
    await workspace.markPhase(electronApp, 'decision-made-tree-dirty');

    // --- Trigger a branch switch: leaving a managedReviewKind route makes
    //     the router guard switch review/* -> dev.
    await window.evaluate(() => {
      location.hash = location.hash.replace(/\/project\/([^/]+).*$/, '/project/$1');
    });

    // The switch is refused, not stashed: the dialog asks what to do.
    await window.waitForSelector('[data-testid="branch-switch-blocked-dialog"]', {
      timeout: 30_000,
    });
    expect(await currentBranch(window)).toBe(reviewerBranch);
    expect(git(aliceProjectPath, ['stash', 'list'])).toBe('');
    expect(git(aliceProjectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(reviewerBranch);

    await workspace.markPhase(electronApp, 'switch-blocked');

    // --- "Save my changes, then switch" commits, then switches --------------
    await clickWhenEnabled(window, '[data-testid="branch-switch-blocked-save"]', 10_000);
    await waitForBranchEquals(window, 'dev', 60_000);

    // Nothing was ever stashed, and the decision is committed on the
    // reviewer branch rather than stranded.
    expect(git(aliceProjectPath, ['stash', 'list'])).toBe('');
    expect(git(aliceProjectPath, ['status', '--porcelain'])).toBe('');
    const reviewerHeadFiles = git(aliceProjectPath, [
      'show', '--name-only', '--format=', reviewerBranch,
    ]);
    expect(reviewerHeadFiles).toContain('records.bib');

    await workspace.markPhase(electronApp, 'saved-and-switched');

    // --- Back into the queue: the decided record is not served again --------
    await window.evaluate(() => {
      location.hash = location.hash.replace(/\/project\/([^/]+).*$/, '/project/$1/prescreen');
    });
    await window.waitForSelector('[data-testid="managed-review-prescreen"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="workflow-phase-review"]:not([disabled])', {
      timeout: 30_000,
    });
    await window.click('[data-testid="workflow-phase-review"]');
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 60_000 });
    await waitForBranchPrefix(window, 'review/', 60_000);

    const resumedRecordId = (
      await window.textContent('[data-testid="prescreen-record-id"]')
    )?.trim();
    expect(resumedRecordId).not.toBe(firstRecordId);

    await workspace.markPhase(electronApp, 'queue-resumed');
  });
});
