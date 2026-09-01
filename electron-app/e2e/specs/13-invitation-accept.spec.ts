import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import {
  test as baseTest,
  expect,
  ALICE,
  BOB,
  DEFAULT_PROJECT_ID,
} from '../fixtures/test-workspace.fixture';
import { TestWorkspace } from '../lib/test-workspace';
import { seedAccounts, seedAliceProject } from '../lib/seeders';
import type { Page } from '@playwright/test';

const BACKEND_TIMEOUT = 45_000;

const test = baseTest.extend({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
    seedAccounts(ws, [ALICE, BOB]);
    seedAliceProject(ws);

    // The review has work on dev (the branch collaborators must land on).
    const aliceProject = path.join(ws.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID);
    git(aliceProject, ['checkout', '-b', 'dev']);
    git(aliceProject, ['commit', '--allow-empty', '-m', 'work on dev']);
    git(aliceProject, ['push', '-u', 'origin', 'dev']);
    git(aliceProject, ['checkout', 'main']);

    // Alice invited bob (registry-level; the invite-sending UI is the
    // owner's side — this spec is the invitee's).
    const registryPath = path.join(ws.root, 'registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    registry.invitations.push({
      id: 1,
      repoFullName: `${ALICE.login}/${DEFAULT_PROJECT_ID}`,
      repoUrl: ws.bareRemotePath(ALICE.login, DEFAULT_PROJECT_ID),
      inviterLogin: ALICE.login,
      inviteeLogin: BOB.login,
      inviteeAvatarUrl: '',
      permission: 'push',
      createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    // Bob is the signed-in user.
    const authPath = path.join(ws.userDataDir, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    auth.activeLogin = BOB.login;
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));

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

/**
 * The collaborator's onboarding driven through the UI: a pending invitation
 * on the landing page, Accept clones the repo into the invitee's
 * account-scoped root and registers the project, and opening it lands on
 * dev. (Spec 09 covers the dev-landing branch logic against a hand-made
 * clone; this covers the accept -> clone -> register path that produces it.)
 */
test.describe('invitation-accept', () => {
  test('accepting an invitation clones the review and opens on dev', async ({
    workspace,
    electronApp,
    window,
  }) => {
    test.setTimeout(240_000);

    const bobProject = path.join(
      workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
    );

    await window.waitForSelector('#app', { timeout: 15_000 });
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 15_000 });
    await waitForBackendReady(window);

    // --- The invitation is offered ------------------------------------------
    const invitations = window.locator('[data-testid="pending-invitations"]');
    await invitations.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(invitations).toContainText(`${ALICE.login}/${DEFAULT_PROJECT_ID}`);
    await expect(invitations).toContainText(`Invited by ${ALICE.login}`);
    expect(fs.existsSync(bobProject)).toBe(false);
    await workspace.markPhase(electronApp, 'invitation-visible');

    // --- Accept: clone + register -------------------------------------------
    await window.click('[data-testid="accept-invitation"]');

    const projectRow = window.locator('[data-testid="project-row-lit-review"]');
    await projectRow.waitFor({ state: 'visible', timeout: 60_000 });
    await invitations.waitFor({ state: 'detached', timeout: 30_000 });

    // The clone landed in BOB's account-scoped root, wired to the remote.
    expect(fs.existsSync(path.join(bobProject, '.git'))).toBe(true);
    expect(git(bobProject, ['remote', 'get-url', 'origin'])).toBe(
      workspace.bareRemotePath(ALICE.login, DEFAULT_PROJECT_ID),
    );

    // Registry: invitation consumed, bob is a collaborator now.
    const registry = JSON.parse(
      fs.readFileSync(path.join(workspace.root, 'registry.json'), 'utf-8'),
    );
    expect(registry.invitations).toHaveLength(0);
    expect(
      registry.collaborators.some(
        (c: { repoFullName: string; login: string }) =>
          c.repoFullName === `${ALICE.login}/${DEFAULT_PROJECT_ID}` &&
          c.login === BOB.login,
      ),
    ).toBe(true);
    await workspace.markPhase(electronApp, 'accepted-and-cloned');

    // --- Opening the fresh clone lands on dev, not main ---------------------
    await projectRow.click();
    await window.waitForFunction(
      () => location.hash.includes('/project/lit-review'),
      { timeout: 15_000 },
    );
    await expect
      .poll(() => git(bobProject, ['rev-parse', '--abbrev-ref', 'HEAD']), {
        timeout: 45_000,
      })
      .toBe('dev');
    await workspace.markPhase(electronApp, 'opened-on-dev');
  });
});
