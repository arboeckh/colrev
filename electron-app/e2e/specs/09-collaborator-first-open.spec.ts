import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
import { createDevBranches } from '../helpers/multi-reviewer';
import type { Page } from '@playwright/test';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');

const BACKEND_TIMEOUT = 45_000;

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

/**
 * Regression: a collaborator who accepts an invite gets a fresh clone of the
 * repo's default branch (`main`), which holds only the init commits — all
 * review work lives on `dev`. Opening the project must land them on `dev`,
 * otherwise the review looks empty ("no progress") forever.
 *
 * The workspace models bob's machine right after the invite-accept clone:
 * no local `dev`, `origin/dev` fetched, HEAD on `main`, bob active.
 */
const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    const cache = new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS });
    cache.load('post-preprocessing', ws.root);
    createDevBranches(ws); // put the preprocessing work on origin/dev

    // Reset bob to "just accepted the invite": a fresh default-branch clone.
    const bobProject = path.join(ws.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID);
    const barePath = ws.bareRemotePath(ALICE.login, DEFAULT_PROJECT_ID);
    fs.rmSync(bobProject, { recursive: true, force: true });
    execFileSync('git', ['-C', barePath, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
      stdio: 'pipe',
    });
    execFileSync('git', ['clone', barePath, bobProject], { stdio: 'pipe' });

    // Bob is the active account when the app launches.
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as {
      activeLogin: string;
      accounts: { user: { login: string } }[];
    };
    if (!auth.accounts.some((a) => a.user.login === BOB.login)) {
      throw new Error('post-preprocessing snapshot is missing the bob account');
    }
    auth.activeLogin = BOB.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

    await use(ws);
  },
});

test.describe('collaborator-first-open', () => {
  test('fresh collaborator clone lands on dev when the project is opened', async ({
    workspace,
    window,
  }) => {
    test.setTimeout(180_000);

    const bobProject = path.join(
      workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
    );
    const currentBranch = () =>
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: bobProject, stdio: 'pipe',
      }).toString().trim();

    expect(currentBranch()).toBe('main'); // precondition: fresh clone

    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // The review must be listed for bob at all.
    const projectRow = window.locator(`[data-testid="project-row-${DEFAULT_PROJECT_ID}"]`);
    await projectRow.waitFor({ state: 'visible', timeout: 30_000 });
    await projectRow.click();

    await window.waitForFunction(
      () => location.hash.includes(`/project/lit-review`),
      { timeout: 15_000 },
    );

    // Opening the project must move the clone onto the working branch.
    await expect
      .poll(currentBranch, { timeout: 45_000, intervals: [1_000] })
      .toBe('dev');

    // And the UI must reflect dev's content, not main's empty tree.
    await window.waitForFunction(
      () => {
        // @ts-expect-error pinia on window
        const pinia = window.__pinia__;
        const g = pinia?._s.get('git');
        return g && g.currentBranch === 'dev';
      },
      { timeout: 30_000 },
    );
  });
});
