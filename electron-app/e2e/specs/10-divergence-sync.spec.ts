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
  BOB,
  DEFAULT_PROJECT_ID,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { clickWhenEnabled } from '../helpers/test-utils';
import { createDevBranches } from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;

const ALICE_OBJECTIVES = 'Assess sotatercept efficacy (alice edition)';
const BOB_OBJECTIVES = 'Assess sotatercept safety (bob edition)';

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
    new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS })
      .load('post-preprocessing', ws.root);
    createDevBranches(ws);

    // The snapshot may leave either account active; this spec drives alice.
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = ALICE.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

    // Bob (out of band, before the app boots): change the review objectives
    // on dev and push. This is the "collaborator saved first" half of the
    // divergence; alice will change the SAME field so the semantic merge has
    // a genuine both-changed conflict rather than an auto-mergeable delta.
    const bobProject = path.join(ws.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID);
    const settingsPath = path.join(bobProject, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    settings.screen.explanation = BOB_OBJECTIVES;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
    git(bobProject, ['add', 'settings.json']);
    git(bobProject, ['commit', '-m', 'bob: update objectives']);
    git(bobProject, ['push', 'origin', 'dev']);

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

/**
 * The full two-sided divergence flow, driven end to end through the UI:
 * bob pushed first; alice edits the same field, tries to push, is told to
 * pull first (with a working "Pull now" toast action), the pull detects the
 * divergence, the semantic merge surfaces a field-level conflict dialog,
 * and resolving it produces a real merge commit that reaches the remote —
 * after which bob can fast-forward and sees alice's resolution.
 */
test.describe('divergence-sync', () => {
  test('push rejection, pull-now, conflict dialog, merged and pushed', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    const aliceProject = path.join(
      workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
    );
    const bobProject = path.join(
      workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
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
    await workspace.markPhase(electronApp, 'project-open');

    // --- Alice edits the same field through the UI --------------------------
    await window.evaluate(() => {
      location.hash = location.hash.replace(/\/project\/([^/]+).*$/, '/project/$1/review-definition');
    });
    // The objectives editor is a tiptap contenteditable, not a native textarea.
    const objectivesInput = window.locator(
      '[data-testid="objectives-textarea"] [contenteditable="true"]',
    );
    await objectivesInput.waitFor({ state: 'visible', timeout: 30_000 });
    await objectivesInput.fill(ALICE_OBJECTIVES);
    await clickWhenEnabled(window, '[data-testid="save-definition-btn"]', 10_000);

    // The save stages settings.json; the push button lights up once the
    // invalidation seam reports the pending change.
    await window.waitForSelector('[data-testid="push-button"]:not([disabled])', {
      timeout: 30_000,
    });
    await workspace.markPhase(electronApp, 'alice-edited');

    // --- Push: auto-commits, then the remote rejects the non-fast-forward ---
    await window.click('[data-testid="push-button"]');
    const toast = window.getByText('Pull first', { exact: true });
    await toast.waitFor({ state: 'visible', timeout: 60_000 });

    // The rejection did not lose alice's work: it is committed locally.
    expect(git(aliceProject, ['status', '--porcelain'])).toBe('');
    const localSettings = JSON.parse(
      fs.readFileSync(path.join(aliceProject, 'settings.json'), 'utf-8'),
    );
    expect(localSettings.screen.explanation).toContain(ALICE_OBJECTIVES);
    await workspace.markPhase(electronApp, 'push-rejected');

    // --- The toast's "Pull now" action drives the pull ----------------------
    await window.getByRole('button', { name: 'Pull now' }).click();

    // ff-only pull fails as DIVERGED -> semantic analysis -> conflict dialog
    // with the field-level both-changed conflict.
    await window.waitForSelector('[data-testid="conflict-resolution-dialog"]', {
      timeout: 60_000,
    });
    const cards = window.locator('[data-testid="conflict-card"]');
    await expect(cards).toHaveCount(1, { timeout: 10_000 });
    await expect(cards.first()).toContainText(ALICE_OBJECTIVES);
    await expect(cards.first()).toContainText(BOB_OBJECTIVES);
    await workspace.markPhase(electronApp, 'conflict-dialog');

    // Apply is gated until every conflict has a choice.
    expect(
      await window.locator('[data-testid="conflict-apply-btn"]').isDisabled(),
    ).toBe(true);

    // --- Keep alice's version, apply ---------------------------------------
    await window.click('[data-testid="conflict-choice-local"]');
    await clickWhenEnabled(window, '[data-testid="conflict-apply-btn"]', 10_000);
    await window.waitForSelector('[data-testid="conflict-resolution-dialog"]', {
      state: 'detached',
      timeout: 120_000,
    });
    await workspace.markPhase(electronApp, 'merge-applied');

    // --- The merge is real and it reached the remote ------------------------
    await expect
      .poll(() => git(aliceProject, ['status', '--porcelain']), { timeout: 30_000 })
      .toBe('');

    // A genuine 2-parent merge commit on alice's dev...
    const mergeParents = git(aliceProject, ['rev-list', '--parents', '-1', 'dev'])
      .split(' ');
    expect(mergeParents.length).toBe(3);

    // ...pushed to the shared remote (local dev == origin/dev on the bare repo)
    const bare = workspace.bareRemotePath(ALICE.login, DEFAULT_PROJECT_ID);
    await expect
      .poll(() => git(bare, ['rev-parse', 'dev']), { timeout: 60_000 })
      .toBe(git(aliceProject, ['rev-parse', 'dev']));

    // The resolution kept alice's value.
    const merged = JSON.parse(
      fs.readFileSync(path.join(aliceProject, 'settings.json'), 'utf-8'),
    );
    expect(merged.screen.explanation).toContain(ALICE_OBJECTIVES);
    expect(merged.screen.explanation).not.toContain(BOB_OBJECTIVES);

    // --- Bob fast-forwards and sees the resolution --------------------------
    git(bobProject, ['fetch', 'origin']);
    git(bobProject, ['merge', 'origin/dev', '--ff-only']);
    const bobSettings = JSON.parse(
      fs.readFileSync(path.join(bobProject, 'settings.json'), 'utf-8'),
    );
    expect(bobSettings.screen.explanation).toContain(ALICE_OBJECTIVES);

    await workspace.markPhase(electronApp, 'converged');
  });
});
