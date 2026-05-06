import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { TestWorkspace } from '../lib/test-workspace';

const REPO_ROOT = path.join(__dirname, '../..');

/**
 * Canonical inputs to the snapshot hash. Any file or directory listed here
 * invalidates cached fixtures when its bytes change. Keep in sync between
 * build-fixtures.spec.ts and any spec that calls SnapshotCache.load.
 */
export const SNAPSHOT_SOURCE_ROOTS = [
  path.join(REPO_ROOT, 'e2e/lib'),
  path.join(REPO_ROOT, 'e2e/fixtures/data'),
  path.join(REPO_ROOT, 'src/main/auth-manager.ts'),
  path.join(REPO_ROOT, 'src/main/fake-github-registry.ts'),
];

export interface TestWorkspaceFixtures {
  workspace: TestWorkspace;
  electronApp: ElectronApplication;
  window: Page;
}

export const test = base.extend<TestWorkspaceFixtures>({
  workspace: async ({}, use, testInfo) => {
    const safeName = testInfo.title.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 80);
    const ws = new TestWorkspace(safeName);
    await use(ws);

    // Always emit last-state.json from disk after the test, regardless of
    // outcome. Don't touch the Electron page — the process may have exited.
    try {
      let activeAccount: string | null = null;
      const authPath = path.join(ws.userDataDir, 'auth.json');
      if (fs.existsSync(authPath)) {
        const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as {
          activeLogin?: string | null;
        };
        activeAccount = auth.activeLogin ?? null;
      }

      let lastRpc: unknown = null;
      if (fs.existsSync(ws.rpcJsonlPath)) {
        const raw = fs.readFileSync(ws.rpcJsonlPath, 'utf-8').trimEnd();
        if (raw.length > 0) {
          const lines = raw.split('\n');
          const lastLine = lines[lines.length - 1];
          try {
            lastRpc = JSON.parse(lastLine);
          } catch {
            lastRpc = lastLine;
          }
        }
      }

      ws.writeLastState({
        activeAccount,
        registryPath: ws.registryPath,
        bareRemotePath: ws.bareRemoteDir,
        lastRpc,
      });
    } catch {
      // last-state.json must not fail tests
    }
  },

  electronApp: async ({ workspace }, use) => {
    const appPath = path.join(__dirname, '../../dist/main/index.js');

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const condaEnvPath = `${homeDir}/miniforge3/envs/colrev`;
    const condaBinPath = `${condaEnvPath}/bin`;

    const electronApp = await electron.launch({
      args: [appPath, `--user-data-dir=${workspace.userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PATH: `${condaBinPath}:${process.env.PATH}`,
        CONDA_PREFIX: condaEnvPath,
        PYTHONHOME: condaEnvPath,
        COLREV_FAKE_GITHUB_REGISTRY: workspace.registryPath,
      },
    });

    await use(electronApp);

    try {
      await electronApp.close();
    } catch {
      // ignore — process may have already exited
    }
  },

  window: async ({ workspace, electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Suppress the macOS-only keychain explainer dialog. In a fresh userData/
    // its localStorage gate is unset, so validateSessionInBackground() opens
    // the dialog over the landing page on first boot. Set the gate early to
    // prevent it; also click continue if it slipped through before we got
    // here.
    await window.evaluate(() => {
      localStorage.setItem('colrev:keychain-explained', '1');
    });
    await window
      .locator('[data-testid="keychain-explainer-continue"]')
      .click({ timeout: 1000 })
      .catch(() => {});

    const stamp = (type: string, message: string): void => {
      workspace.appendRendererLog(`[${new Date().toISOString()}] [${type}] ${message}`);
    };
    window.on('console', (msg) => stamp(msg.type(), msg.text()));
    window.on('pageerror', (err) => stamp('error', err.stack ?? err.message));

    await use(window);
  },
});

export function seedAuth(
  userDataDir: string,
  login: string,
  token: string,
): void {
  const authPath = path.join(userDataDir, 'auth.json');
  const encryptedToken = Buffer.from(token).toString('base64');
  const data = {
    version: 2,
    activeLogin: login,
    accounts: [
      {
        encryptedToken,
        user: {
          login,
          name: login,
          avatarUrl: '',
          email: `${login}@test.local`,
        },
        authenticatedAt: new Date().toISOString(),
      },
    ],
  };
  fs.writeFileSync(authPath, JSON.stringify(data, null, 2));
}

export function seedAuthMulti(
  userDataDir: string,
  accounts: { login: string; token: string }[],
  activeLogin?: string,
): void {
  const authPath = path.join(userDataDir, 'auth.json');
  const data = {
    version: 2,
    activeLogin: activeLogin ?? accounts[0]?.login ?? '',
    accounts: accounts.map((a) => ({
      encryptedToken: Buffer.from(a.token).toString('base64'),
      user: {
        login: a.login,
        name: a.login,
        avatarUrl: '',
        email: `${a.login}@test.local`,
      },
      authenticatedAt: new Date().toISOString(),
    })),
  };
  fs.writeFileSync(authPath, JSON.stringify(data, null, 2));
}

interface TestWindow {
  __test?: {
    switchAccount: (login: string) => Promise<{ success: boolean; error?: string }>;
  };
}

export async function switchAccount(
  electronApp: ElectronApplication,
  login: string,
): Promise<void> {
  const page = await electronApp.firstWindow();
  const result = await page.evaluate(async (l) => {
    const testApi = (window as unknown as TestWindow).__test;
    if (!testApi) {
      throw new Error('window.__test not available (is COLREV_FAKE_GITHUB_REGISTRY set?)');
    }
    return testApi.switchAccount(l);
  }, login);
  if (!result.success) {
    throw new Error(`switchAccount failed: ${result.error}`);
  }
  // Mirror the UserMenu flow: route to landing, then reload so stores rebind
  // to the new account. Without this, callers stay on whatever page the
  // previous account was on.
  await page.evaluate(() => {
    location.hash = '#/';
    location.reload();
  });
  await page.waitForLoadState('domcontentloaded');
}

export { expect } from '@playwright/test';
export {
  seedAccounts,
  seedBareRemote,
  seedAliceProject,
  seedRecords,
  seedCollaborator,
  ALICE,
  BOB,
  DEFAULT_PROJECT_ID,
  PINNED_DATE,
  pinnedNow,
} from '../lib/seeders';
export type { SeedAccount } from '../lib/seeders';
export { SnapshotCache } from '../lib/snapshot-cache';
export type { SnapshotCacheOptions } from '../lib/snapshot-cache';
