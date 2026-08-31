/**
 * Smoke test for the packaged app (also runs against the dev build).
 *
 * Run against a packaged build:
 *   COLREV_TEST_MODE=packaged npx playwright test --project=smoke
 * or via npm:
 *   npm run test:smoke:packaged
 *
 * It deliberately avoids snapshots and heavy seeding: everything it checks
 * must come out of the app under test itself. What it proves, in order:
 *
 *  1. The binary launches and is the flavor we asked for (app.isPackaged).
 *  2. Packaged only: the python bundle shipped inside Contents/Resources.
 *  3. The renderer mounts (asar/vite assets intact).
 *  4. The JSON-RPC backend reaches "running" — for a packaged build this
 *     means the bundled python-build-standalone interpreter booted and
 *     imported colrev with no conda env on the host to fall back on.
 *  5. Creating a review through the UI works end-to-end: the init_project
 *     RPC (bundled colrev), git init + commits (bundled dugite git), and the
 *     push to the fake GitHub bare remote.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { test as baseTest, expect, seedAuth } from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { resolveTestMode } from '../helpers/launch-target';

const MODE = resolveTestMode();
// Cold boot of a packaged app pays Gatekeeper + bundled-python startup costs.
const BACKEND_TIMEOUT = MODE === 'packaged' ? 120_000 : 45_000;

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    // Minimal seed: one authenticated account, no repos. The review the test
    // creates must be produced entirely by the app under test.
    ws.seedRegistry({
      accounts: [{ login: 'alice', name: 'Alice Smith', avatarUrl: '', token: 'tok-alice' }],
      repos: [],
      collaborators: [],
      invitations: [],
      releases: [],
    });
    seedAuth(ws.userDataDir, 'alice', 'tok-alice');

    await use(ws);
  },
});

test.describe(`smoke (${MODE})`, () => {
  test('boots, backend runs, creates a review end-to-end', async ({
    workspace,
    electronApp,
    window,
  }) => {
    // 1. We are testing the binary flavor we think we are.
    const appInfo = await electronApp.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      version: app.getVersion(),
    }));
    expect(appInfo.isPackaged).toBe(MODE === 'packaged');

    // 2. Packaged builds must ship the python bundle in extraResources.
    if (MODE === 'packaged') {
      const bundleDir = path.join(
        appInfo.resourcesPath,
        process.platform === 'win32' ? 'python-win-x64' : 'python-mac-arm64',
      );
      expect(fs.existsSync(bundleDir), `python bundle missing at ${bundleDir}`).toBe(true);
      const gitDir = path.join(appInfo.resourcesPath, 'git');
      expect(fs.existsSync(gitDir), `bundled git missing at ${gitDir}`).toBe(true);
    }

    // 3. Renderer mounts and shows the landing page.
    await window.waitForSelector('#app', { timeout: 30_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 30_000 });

    // 4. The backend (bundled python in packaged mode) reaches "running".
    await window.waitForFunction(
      () => {
        // @ts-expect-error pinia on window
        const pinia = window.__pinia__;
        return pinia?._s.get('backend')?.status === 'running';
      },
      { timeout: BACKEND_TIMEOUT },
    );

    await workspace.markPhase(electronApp, 'backend-running');

    // 5. Create a review through the UI.
    await window.click('[data-testid="new-review-trigger"]');
    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 10_000 });
    await window.fill('[data-testid="project-id-input"]', 'Smoke Review');
    await window.click('[data-testid="submit-create-project"]');

    // Creation ends by navigating into the new project.
    await window.waitForFunction(
      () => location.hash.includes('/project/smoke-review'),
      { timeout: 120_000 },
    );

    await workspace.markPhase(electronApp, 'review-created');

    // 6. Disk truth: the project is a real git repo produced by the app.
    const projectPath = path.join(
      workspace.userDataDir, 'projects', 'alice', 'smoke-review',
    );
    expect(fs.existsSync(path.join(projectPath, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'settings.json'))).toBe(true);

    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: projectPath, encoding: 'utf-8',
    });
    expect(log.trim().length).toBeGreaterThan(0);

    // The app pushed to the fake GitHub bare remote and switched to dev.
    const barePath = workspace.bareRemotePath('alice', 'smoke-review');
    expect(fs.existsSync(barePath), `bare remote missing at ${barePath}`).toBe(true);
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectPath, encoding: 'utf-8',
    }).trim();
    expect(branch).toBe('dev');

    // 7. The RPC trace captured real backend traffic.
    const rpc = fs.readFileSync(workspace.rpcJsonlPath, 'utf-8');
    expect(rpc).toContain('init_project');
  });
});
