import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
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
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');
const BACKEND_TIMEOUT = 45_000;

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
    new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS })
      .load('post-preprocessing', ws.root);
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = ALICE.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
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

async function activeLogin(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const pinia = (self as any).__pinia__;
    return pinia?._s.get('auth')?.user?.login ?? null;
  });
}

async function waitForActiveLogin(window: Page, login: string, timeout = 60_000) {
  await window.waitForFunction(
    (expected) => {
      const pinia = (self as any).__pinia__;
      return pinia?._s.get('auth')?.user?.login === expected;
    },
    login,
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
  await window.waitForFunction(() => {
    const pinia = (self as any).__pinia__;
    return !!pinia?._s.get('projects')?.currentProject?.path;
  }, { timeout: 60_000 });
}

async function boundState(window: Page) {
  return window.evaluate(() => {
    const pinia = (self as any).__pinia__;
    return {
      projectPath: pinia?._s.get('projects')?.currentProject?.path as string,
      basePath: pinia?._s.get('backend')?.basePath as string,
      mdProcessed: pinia?._s.get('projects')?.currentProject?.status?.overall
        ?.md_processed as number,
    };
  });
}

/**
 * Account switching through the REAL UserMenu path (not the e2e-only
 * `__test/switchAccount` IPC): the switch must rebind the project list,
 * the backend base path, and the opened project to the new account's
 * scoped clone — the exact wiring class that broke in issue #37 — and
 * signing out of one of two accounts must fall back to the remaining one.
 */
test.describe('account-switching', () => {
  test('user-menu switch rebinds to the account-scoped world; sign-out falls back', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(300_000);

    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // --- Alice's world ------------------------------------------------------
    await openProject(window);
    const alice = await boundState(window);
    expect(alice.projectPath).toContain(`/projects/${ALICE.login}/${DEFAULT_PROJECT_ID}`);
    expect(alice.basePath).toContain(`/projects/${ALICE.login}`);
    expect(alice.mdProcessed).toBe(10);
    await workspace.markPhase(electronApp, 'alice-project-open');

    // --- Switch to bob via the real UserMenu, with the project open ---------
    await window.click('[data-testid="user-menu-trigger"]');
    const bobItem = window.locator(`[data-testid="switch-account-${BOB.login}"]`);
    await bobItem.waitFor({ state: 'visible', timeout: 10_000 });
    // The click triggers router.push('/') + window.location.reload(); the
    // execution context dies mid-click, which Playwright reports as an error.
    await bobItem.click().catch(() => undefined);

    await waitForActiveLogin(window, BOB.login);
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 30_000 });
    await waitForBackendReady(window);
    await workspace.markPhase(electronApp, 'switched-to-bob');

    // auth.json on disk agrees.
    const authAfterSwitch = JSON.parse(
      fs.readFileSync(path.join(workspace.userDataDir, 'auth.json'), 'utf-8'),
    );
    expect(authAfterSwitch.activeLogin).toBe(BOB.login);

    // --- Bob's world is bob's clone, not alice's ----------------------------
    await openProject(window);
    const bob = await boundState(window);
    expect(bob.projectPath).toContain(`/projects/${BOB.login}/${DEFAULT_PROJECT_ID}`);
    expect(bob.basePath).toContain(`/projects/${BOB.login}`);
    // Alice's preprocessing lives only in her clone: same project id, but
    // bob's copy has no processed records. Same id + different content is the
    // proof the rebind actually happened.
    expect(bob.mdProcessed).toBe(0);
    await workspace.markPhase(electronApp, 'bob-project-open');

    // --- Sign out of bob: the app falls back to alice -----------------------
    await window.click('[data-testid="user-menu-trigger"]');
    const signOut = window.locator('[data-testid="sign-out-button"]');
    await signOut.waitFor({ state: 'visible', timeout: 10_000 });
    await signOut.click().catch(() => undefined);

    // Bob's account is removed; alice (the remaining account) becomes active.
    await waitForActiveLogin(window, ALICE.login);
    await expect
      .poll(() => {
        const auth = JSON.parse(
          fs.readFileSync(path.join(workspace.userDataDir, 'auth.json'), 'utf-8'),
        );
        return {
          active: auth.activeLogin,
          logins: auth.accounts.map((a: { user: { login: string } }) => a.user.login),
        };
      }, { timeout: 30_000 })
      .toEqual({ active: ALICE.login, logins: [ALICE.login] });

    // The app lands somewhere alice can work from: authenticated, with her
    // reviews listed.
    await window.waitForSelector('[data-testid="project-row-lit-review"]', {
      timeout: 60_000,
    });
    expect(await activeLogin(window)).toBe(ALICE.login);
    await workspace.markPhase(electronApp, 'signed-out-fallback');
  });
});
