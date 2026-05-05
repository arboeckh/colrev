import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { TestWorkspace } from '../lib/test-workspace';

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

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
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

export { expect } from '@playwright/test';
