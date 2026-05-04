import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Debug log entry structure - matches the Pinia debug store
 */
export interface DebugLogEntry {
  id: string;
  type: 'rpc-request' | 'rpc-response' | 'error' | 'backend' | 'info';
  message: string;
  data?: unknown;
  timestamp: string;
  duration?: number;
  requestId?: string;
}

/**
 * Debug data returned from the app's Pinia stores
 */
export interface DebugData {
  logs: DebugLogEntry[];
  backendLogs: string[];
  backendStatus: 'stopped' | 'starting' | 'running' | 'error';
  hasErrors: boolean;
}

/**
 * Custom test fixtures for Electron E2E testing
 */
type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
  getDebugData: () => Promise<DebugData>;
  getRpcLogs: () => Promise<DebugLogEntry[]>;
  waitForRpcResponse: (method?: string, timeout?: number) => Promise<DebugLogEntry | null>;
  clearDebugLogs: () => Promise<void>;
  waitForBackend: (timeout?: number) => Promise<boolean>;
};

type TestMode = 'dev' | 'packaged';

/**
 * Resolve the packaged .app executable path for the current platform/arch.
 * Throws with a clear hint if the app hasn't been built yet.
 */
function resolvePackagedAppExecutable(): string {
  const repoRoot = path.join(__dirname, '../..');
  const releaseDir = path.join(repoRoot, 'release');

  if (process.platform === 'darwin') {
    const archDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    const exe = path.join(releaseDir, archDir, 'ColRev.app/Contents/MacOS/ColRev');
    if (!fs.existsSync(exe)) {
      throw new Error(
        `Packaged app not found at:\n  ${exe}\n` +
        `Run 'npm run build:fast' (or 'npm run release:mac:unsigned') first.`
      );
    }
    return exe;
  }

  if (process.platform === 'linux') {
    // electron-builder AppImage isn't directly executable as a Playwright executablePath;
    // for now, point at the linux-unpacked binary if it exists.
    const exe = path.join(releaseDir, 'linux-unpacked', 'colrev');
    if (!fs.existsSync(exe)) {
      throw new Error(
        `Packaged app not found at ${exe}. Run 'npm run build:fast --platform linux' first.`
      );
    }
    return exe;
  }

  if (process.platform === 'win32') {
    const exe = path.join(releaseDir, 'win-unpacked', 'ColRev.exe');
    if (!fs.existsSync(exe)) {
      throw new Error(
        `Packaged app not found at ${exe}. Run 'npm run build:fast --platform win' first.`
      );
    }
    return exe;
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

/**
 * Extended Playwright test with Electron-specific fixtures
 *
 * Mode is selected via COLREV_TEST_MODE:
 *   - 'dev'      (default): launch unpacked dist/main/index.js with `python main.py`
 *                as the JSON-RPC backend (uses conda env in PATH).
 *   - 'packaged': launch the built .app with the bundled PyInstaller binary.
 *                Run `npm run build:fast` first.
 *
 * Both modes use a per-test temporary --user-data-dir so tests never touch
 * the user's real Application Support directory.
 */
export const test = base.extend<ElectronFixtures>({
  // Launch Electron app
  electronApp: async ({}, use) => {
    const mode = ((process.env.COLREV_TEST_MODE as TestMode | undefined) ?? 'dev') as TestMode;

    // Per-test isolated user-data directory. Removed after test ends.
    const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-e2e-'));
    const userDataArg = `--user-data-dir=${tmpUserData}`;

    let electronApp: ElectronApplication;

    if (mode === 'packaged') {
      const executablePath = resolvePackagedAppExecutable();
      electronApp = await electron.launch({
        executablePath,
        args: [userDataArg],
        env: {
          ...process.env,
        },
      });
    } else {
      const appPath = path.join(__dirname, '../../dist/main/index.js');

      // Conda env for `python -m colrev.ui_jsonrpc.server` resolution in dev mode
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const condaEnvPath = `${homeDir}/miniforge3/envs/colrev`;
      const condaBinPath = `${condaEnvPath}/bin`;

      electronApp = await electron.launch({
        args: [appPath, userDataArg],
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PATH: `${condaBinPath}:${process.env.PATH}`,
          CONDA_PREFIX: condaEnvPath,
          PYTHONHOME: condaEnvPath,
        },
      });
    }

    await use(electronApp);

    try {
      await electronApp.close();
    } catch {
      // ignore — process may have already exited
    }

    // Clean up temp user-data dir.
    if (fs.existsSync(tmpUserData)) {
      fs.rmSync(tmpUserData, { recursive: true, force: true });
    }
  },

  // Get the first window (renderer process)
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Wait for the app to be ready (Vue mounted)
    await window.waitForLoadState('domcontentloaded');

    await use(window);
  },

  // Get all debug data from Pinia stores
  getDebugData: async ({ window }, use) => {
    const getDebugData = async (): Promise<DebugData> => {
      return await window.evaluate(() => {
        // @ts-expect-error Accessing exposed Pinia
        const pinia = window.__pinia__;
        if (!pinia) {
          return {
            logs: [],
            backendLogs: [],
            backendStatus: 'stopped' as const,
            hasErrors: false,
          };
        }

        const debugStore = pinia._s.get('debug');
        const backendStore = pinia._s.get('backend');

        return {
          logs: debugStore?.logs || [],
          backendLogs: backendStore?.logs || [],
          backendStatus: backendStore?.status || 'stopped',
          hasErrors: debugStore?.hasErrors || false,
        };
      });
    };
    await use(getDebugData);
  },

  // Get only RPC request/response logs
  getRpcLogs: async ({ getDebugData }, use) => {
    const getRpcLogs = async (): Promise<DebugLogEntry[]> => {
      const data = await getDebugData();
      return data.logs.filter(
        (log) => log.type === 'rpc-request' || log.type === 'rpc-response' || log.type === 'error'
      );
    };
    await use(getRpcLogs);
  },

  // Wait for a specific RPC response
  waitForRpcResponse: async ({ getDebugData }, use) => {
    const waitForRpcResponse = async (method?: string, timeout = 10000): Promise<DebugLogEntry | null> => {
      const startTime = Date.now();
      let lastLogCount = 0;

      while (Date.now() - startTime < timeout) {
        const data = await getDebugData();
        const rpcResponses = data.logs.filter((log) => log.type === 'rpc-response');

        // Check for new responses since last check
        if (rpcResponses.length > lastLogCount) {
          const newResponses = rpcResponses.slice(lastLogCount);
          lastLogCount = rpcResponses.length;

          // If method specified, look for matching response
          if (method) {
            const match = newResponses.find((log) => log.message.includes(method));
            if (match) return match;
          } else {
            // Return the latest response
            return newResponses[newResponses.length - 1];
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return null;
    };
    await use(waitForRpcResponse);
  },

  // Clear debug logs
  clearDebugLogs: async ({ window }, use) => {
    const clearDebugLogs = async (): Promise<void> => {
      await window.evaluate(() => {
        // @ts-expect-error Accessing exposed Pinia
        const pinia = window.__pinia__;
        if (pinia) {
          const debugStore = pinia._s.get('debug');
          const backendStore = pinia._s.get('backend');
          debugStore?.clear?.();
          backendStore?.clearLogs?.();
        }
      });
    };
    await use(clearDebugLogs);
  },

  // Wait for backend to be running
  waitForBackend: async ({ getDebugData }, use) => {
    const waitForBackend = async (timeout = 30000): Promise<boolean> => {
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const data = await getDebugData();
        if (data.backendStatus === 'running') {
          return true;
        }
        if (data.backendStatus === 'error') {
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      return false;
    };
    await use(waitForBackend);
  },
});

export { expect } from '@playwright/test';
