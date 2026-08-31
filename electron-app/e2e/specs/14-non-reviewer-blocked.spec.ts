import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import {
  test as baseTest,
  expect,
  SnapshotCache,
  SNAPSHOT_SOURCE_ROOTS,
  switchAccount,
  ALICE,
  BOB,
  DEFAULT_PROJECT_ID,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { seedAccounts, seedCollaborator } from '../lib/seeders';
import { clickWhenEnabled } from '../helpers/test-utils';
import { createDevBranches } from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;

const CAROL = { login: 'carol', token: 'tok-carol' };

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
    new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS })
      .load('post-preprocessing', ws.root);
    createDevBranches(ws);
    // Carol: a collaborator on the repo who is NOT one of the task's reviewers.
    seedAccounts(ws, [ALICE, BOB, CAROL]);
    seedCollaborator(ws, CAROL, `${ALICE.login}/${DEFAULT_PROJECT_ID}`);
    await use(ws);
  },
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
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

async function openProject(window: Page): Promise<void> {
  const projectRow = window.locator('[data-testid="project-row-lit-review"]');
  await projectRow.waitFor({ state: 'visible', timeout: 30_000 });
  await projectRow.click();
  await window.waitForFunction(
    () => location.hash.includes('/project/lit-review'),
    { timeout: 15_000 },
  );
}

/**
 * Managed-review access control: a collaborator who is not one of the task's
 * assigned reviewers must be blocked from the review queue (read-only empty
 * state), must not be switched onto anyone's reviewer branch, and must see
 * who the task actually belongs to.
 */
test.describe('non-reviewer-blocked', () => {
  test('a collaborator outside the task cannot enter the review queue', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    const carolProject = path.join(
      workspace.userDataDir, 'projects', CAROL.login, DEFAULT_PROJECT_ID,
    );

    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // --- Alice launches a prescreen task for alice + bob --------------------
    await openProject(window);
    await waitForBranchEquals(window, 'dev');
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
    await workspace.markPhase(electronApp, 'task-launched');

    // --- Carol takes over the session ---------------------------------------
    await switchAccount(electronApp, CAROL.login);
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 30_000 });
    await waitForBackendReady(window);
    await openProject(window);
    // Fresh collaborator clone: opening it lands carol on dev, where the
    // task manifest is visible.
    await waitForBranchEquals(window, 'dev');
    await workspace.markPhase(electronApp, 'carol-project-open');

    // --- The review queue is blocked for carol ------------------------------
    await window.evaluate(() => {
      location.hash = location.hash.replace(/\/project\/([^/]+).*$/, '/project/$1/prescreen');
    });
    await window.waitForSelector('[data-testid="managed-review-prescreen"]', { timeout: 30_000 });
    await window.waitForSelector('[data-testid="workflow-phase-review"]:not([disabled])', {
      timeout: 60_000,
    });
    await window.click('[data-testid="workflow-phase-review"]');

    // Blocked empty state, naming the actual reviewers.
    await window
      .getByText('Managed prescreen is active')
      .waitFor({ state: 'visible', timeout: 60_000 });
    await window
      .getByText(/assigned to alice and bob/)
      .waitFor({ state: 'visible', timeout: 10_000 });

    // No queue, no decision buttons.
    expect(
      await window.locator('[data-testid="prescreen-btn-include"]').count(),
    ).toBe(0);
    await workspace.markPhase(electronApp, 'carol-blocked');

    // Carol was never moved onto anyone's reviewer branch...
    expect(git(carolProject, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('dev');
    // ...and no reviewer branch was materialized in her clone.
    expect(git(carolProject, ['branch', '--list', 'review/*'])).toBe('');
  });
});
