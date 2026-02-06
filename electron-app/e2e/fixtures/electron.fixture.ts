import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

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

/**
 * Extended Playwright test with Electron-specific fixtures
 *
 * The Electron app when not packaged (app.isPackaged = false) will use
 * `python main.py` to start the JSON-RPC backend.
 *
 * The fixture automatically configures PATH to use the colrev conda environment.
 * If tests fail with Python errors, verify the conda path in this file.
 */
export const test = base.extend<ElectronFixtures>({
  // Launch Electron app
  electronApp: async ({}, use) => {
    const appPath = path.join(__dirname, '../../dist/main/index.js');

    // Get conda path - using miniforge3 (update this if your conda is elsewhere)
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const condaEnvPath = `${homeDir}/miniforge3/envs/colrev`;
    const condaBinPath = `${condaEnvPath}/bin`;

    // Use production mode to load from built files (not dev server)
    // The app will still use python main.py because app.isPackaged is false
    const electronApp = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        // Add conda env to PATH so python resolves to the colrev env
        PATH: `${condaBinPath}:${process.env.PATH}`,
        // Set CONDA_PREFIX to help any conda-aware scripts
        CONDA_PREFIX: condaEnvPath,
        // Ensure Python uses the right environment
        PYTHONHOME: condaEnvPath,
      },
    });

    await use(electronApp);
    await electronApp.close();
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
