/**
 * E2E test: fake GitHub backend with TestWorkspace.
 *
 * Launches the app with COLREV_FAKE_GITHUB_REGISTRY pointing at a seeded
 * registry, authenticates via pre-seeded auth.json, and verifies that
 * the seeded CoLRev repos appear in the GitHub repos listing on the
 * landing page.
 *
 * Also verifies that the TestWorkspace log files are populated after
 * the test run.
 */
import * as fs from 'fs';
import { test as baseTest, expect, seedAuth } from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';

// Override `workspace` to seed registry + auth.json BEFORE Electron launches.
// `electronApp` depends on `workspace`, so any work done before `use(ws)` is
// visible to the app at startup. Seeding inside the test body would race the
// renderer, which mounts on the login screen and never re-queries auth.
const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);

    ws.seedRegistry({
      accounts: [
        { login: 'alice', name: 'Alice Smith', avatarUrl: '', token: 'tok-alice' },
      ],
      repos: [
        {
          name: 'systematic-review',
          fullName: 'alice/systematic-review',
          owner: 'alice',
          htmlUrl: 'https://github.com/alice/systematic-review',
          description: 'A systematic literature review',
          isPrivate: false,
          updatedAt: '2026-01-15T00:00:00Z',
          cloneUrl: 'https://github.com/alice/systematic-review.git',
          isColrev: true,
        },
        {
          name: 'scoping-review',
          fullName: 'alice/scoping-review',
          owner: 'alice',
          htmlUrl: 'https://github.com/alice/scoping-review',
          description: 'A scoping review',
          isPrivate: false,
          updatedAt: '2026-02-01T00:00:00Z',
          cloneUrl: 'https://github.com/alice/scoping-review.git',
          isColrev: true,
        },
        {
          name: 'dotfiles',
          fullName: 'alice/dotfiles',
          owner: 'alice',
          htmlUrl: 'https://github.com/alice/dotfiles',
          description: 'My dotfiles',
          isPrivate: true,
          updatedAt: '2026-01-10T00:00:00Z',
          cloneUrl: 'https://github.com/alice/dotfiles.git',
          isColrev: false,
        },
      ],
      collaborators: [],
      invitations: [],
      releases: [],
    });

    seedAuth(ws.userDataDir, 'alice', 'tok-alice');

    await use(ws);
  },
});

test.describe('fake GitHub backend', () => {
  test('shows seeded repos on the landing page', async ({ workspace, electronApp, window }) => {
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });

    const backendReady = await window.waitForFunction(
      () => {
        // @ts-expect-error pinia on window
        const pinia = window.__pinia__;
        if (!pinia) return false;
        const backendStore = pinia._s.get('backend');
        return backendStore?.status === 'running';
      },
      { timeout: 45_000 },
    );
    expect(backendReady).toBeTruthy();

    const ghSection = window.locator('[data-testid="github-projects-section"]');
    await ghSection.waitFor({ state: 'visible', timeout: 30_000 });

    const repo1 = window.locator('[data-testid="github-repo-systematic-review"]');
    await repo1.waitFor({ state: 'visible', timeout: 30_000 });

    const repo2 = window.locator('[data-testid="github-repo-scoping-review"]');
    await repo2.waitFor({ state: 'visible', timeout: 30_000 });

    const nonColrev = window.locator('[data-testid="github-repo-dotfiles"]');
    await expect(nonColrev).toHaveCount(0);

    workspace.writeLastState({
      activeAccount: 'alice',
      registryPath: workspace.registryPath,
      bareRemotePath: workspace.bareRemoteDir,
      lastRpc: { method: 'fake-github-e2e-complete' },
    });

    expect(fs.existsSync(workspace.backendLogPath)).toBe(true);
    expect(fs.existsSync(workspace.rendererLogPath)).toBe(true);
    expect(fs.existsSync(workspace.rpcJsonlPath)).toBe(true);
    expect(fs.existsSync(workspace.lastStatePath)).toBe(true);

    const lastState = JSON.parse(fs.readFileSync(workspace.lastStatePath, 'utf-8'));
    expect(lastState.activeAccount).toBe('alice');
  });
});
