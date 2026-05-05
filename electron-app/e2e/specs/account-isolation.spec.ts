/**
 * E2E test: per-account project isolation.
 *
 * Seeds Alice and Bob in the fake registry and auth store. Verifies that
 * each account sees only their own repos when switching via the test-only
 * __test/switchAccount IPC.
 */
import { test, expect, seedAuthMulti, switchAccount } from '../fixtures/test-workspace.fixture';

test.describe('account isolation', () => {
  test('each account sees only their own repos after switching', async ({ workspace, electronApp, window }) => {
    // 1. Seed registry with repos for both alice and bob
    workspace.seedRegistry({
      accounts: [
        { login: 'alice', name: 'Alice Smith', avatarUrl: '', token: 'tok-alice' },
        { login: 'bob', name: 'Bob Jones', avatarUrl: '', token: 'tok-bob' },
      ],
      repos: [
        {
          name: 'alice-review',
          fullName: 'alice/alice-review',
          owner: 'alice',
          htmlUrl: 'https://github.com/alice/alice-review',
          description: 'Alice review',
          isPrivate: false,
          updatedAt: '2026-01-15T00:00:00Z',
          cloneUrl: 'https://github.com/alice/alice-review.git',
          isColrev: true,
        },
        {
          name: 'bob-review',
          fullName: 'bob/bob-review',
          owner: 'bob',
          htmlUrl: 'https://github.com/bob/bob-review',
          description: 'Bob review',
          isPrivate: false,
          updatedAt: '2026-02-01T00:00:00Z',
          cloneUrl: 'https://github.com/bob/bob-review.git',
          isColrev: true,
        },
      ],
      collaborators: [],
      invitations: [],
      releases: [],
    });

    // 2. Pre-seed auth with both accounts, alice active
    seedAuthMulti(workspace.userDataDir, [
      { login: 'alice', token: 'tok-alice' },
      { login: 'bob', token: 'tok-bob' },
    ], 'alice');

    // 3. Wait for app to mount
    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });

    // 4. Wait for backend
    await window.waitForFunction(
      () => {
        // @ts-expect-error pinia on window
        const pinia = window.__pinia__;
        if (!pinia) return false;
        const backendStore = pinia._s.get('backend');
        return backendStore?.status === 'running';
      },
      { timeout: 45_000 },
    );

    // 5. Verify alice sees her repos
    const ghSection = window.locator('[data-testid="github-projects-section"]');
    await ghSection.waitFor({ state: 'visible', timeout: 30_000 });

    const aliceRepo = window.locator('[data-testid="github-repo-alice-review"]');
    await aliceRepo.waitFor({ state: 'visible', timeout: 30_000 });

    // 6. Switch to bob
    await switchAccount(electronApp, 'bob');

    // 7. Wait for bob's repos to appear
    const bobRepo = window.locator('[data-testid="github-repo-bob-review"]');
    await bobRepo.waitFor({ state: 'visible', timeout: 30_000 });

    // 8. Verify alice's repo is no longer visible
    await expect(aliceRepo).toHaveCount(0);

    // 9. Switch back to alice
    await switchAccount(electronApp, 'alice');

    // 10. Verify alice sees her repo again
    await aliceRepo.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(bobRepo).toHaveCount(0);

    // 11. Write last state
    workspace.writeLastState({
      activeAccount: 'alice',
      registryPath: workspace.registryPath,
      bareRemotePath: workspace.bareRemoteDir,
      lastRpc: { method: 'account-isolation-complete' },
    });
  });
});
