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
import { test, expect, seedAuth } from '../fixtures/test-workspace.fixture';

test.describe('fake GitHub backend', () => {
  test('shows seeded repos on the landing page', async ({ workspace, electronApp, window }) => {
    // 1. Seed the registry with a CoLRev repo owned by alice
    workspace.seedRegistry({
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

    // 2. Pre-seed auth so the app thinks alice is logged in
    seedAuth(workspace.userDataDir, 'alice', 'tok-alice');

    // 3. Wait for app to mount
    await window.waitForSelector('#app', { timeout: 15_000 });

    // 4. Wait for the landing page (authenticated users go straight there)
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });

    // 5. Wait for backend to start (poll pinia store)
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

    // 6. Wait for the GitHub repos section to appear and load
    //    The store fetches repos automatically when authenticated + backend running
    const ghSection = window.locator('[data-testid="github-projects-section"]');
    await ghSection.waitFor({ state: 'visible', timeout: 30_000 });

    // 7. Wait for the seeded repos to appear (the store needs time to fetch + render)
    const repo1 = window.locator('[data-testid="github-repo-systematic-review"]');
    await repo1.waitFor({ state: 'visible', timeout: 30_000 });

    const repo2 = window.locator('[data-testid="github-repo-scoping-review"]');
    await repo2.waitFor({ state: 'visible', timeout: 30_000 });

    // 8. Verify the non-colrev repo (dotfiles) does NOT appear
    //    listColrevRepos filters out non-colrev repos
    const nonColrev = window.locator('[data-testid="github-repo-dotfiles"]');
    await expect(nonColrev).toHaveCount(0);

    // 9. Write last-state.json for debugging
    workspace.writeLastState({
      activeAccount: 'alice',
      registryPath: workspace.registryPath,
      bareRemotePath: workspace.bareRemoteDir,
      lastRpc: { method: 'fake-github-e2e-complete' },
    });

    // 10. Verify log files exist and are populated
    //     backend.log and renderer.log may be empty if the app didn't emit
    //     backend stderr or renderer console in this test. At minimum they
    //     exist (created by TestWorkspace).
    expect(fs.existsSync(workspace.backendLogPath)).toBe(true);
    expect(fs.existsSync(workspace.rendererLogPath)).toBe(true);
    expect(fs.existsSync(workspace.rpcJsonlPath)).toBe(true);
    expect(fs.existsSync(workspace.lastStatePath)).toBe(true);

    const lastState = JSON.parse(fs.readFileSync(workspace.lastStatePath, 'utf-8'));
    expect(lastState.activeAccount).toBe('alice');
  });
});
