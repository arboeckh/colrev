import { app, BrowserWindow, dialog, protocol, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  ColrevBackend,
  RpcError,
  RPC_TRANSPORT_NOT_RUNNING,
  serializeRpcError,
} from './colrev-backend';
import { setupGitEnvironment } from './git-env';
import { AuthManager } from './auth-manager';
import { AccountScopedProjectPaths } from './account-scoped-project-paths';

// Allow running multiple instances with separate data directories via COLREV_USER env var
// Usage: COLREV_USER=alice npm run dev  /  COLREV_USER=bob npm run dev
if (process.env.COLREV_USER) {
  app.setPath('userData', path.join(app.getPath('userData') + '-' + process.env.COLREV_USER));
}
import { getGitHubClient } from './github-client-factory';
import { resolveBackendLaunch } from './backend-launcher';
import { createGitHandlers, realGitOps } from './ipc/git-handlers';
import { createGitHubHandlers, realGitHubGitOps } from './ipc/github-handlers';
import { createAppHandlers } from './ipc/app-handlers';
import { isLockFreeRpcMethod, registerHandlers } from './ipc/registry';
import { withGitLock } from './gitMutex';

// Register custom protocol scheme before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'colrev-pdf',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let backend: ColrevBackend | null = null;
const authManager = new AuthManager();
const projectPaths = new AccountScopedProjectPaths(app.getPath('userData'));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'ColRev',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Maximize the window on startup
  mainWindow.maximize();

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // Dev tools can be opened manually with Cmd+Option+I / Ctrl+Shift+I
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open external links in the system browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Backend lifecycle -----------------------------------------------------

function forwardBackendEvents(b: ColrevBackend): void {
  b.on('log', (msg) => mainWindow?.webContents.send('colrev:log', msg));
  b.on('error', (err) => mainWindow?.webContents.send('colrev:error', err.message));
  // Do NOT null the backend on 'close': an unexpected exit triggers a
  // supervised restart inside ColrevBackend. It is only discarded on explicit
  // stop or when the supervisor gives up.
  b.on('close', (code) => mainWindow?.webContents.send('colrev:close', code));
  b.on('progress', (event) => mainWindow?.webContents.send('colrev:progress', event));
  b.on('restarting', (info) => mainWindow?.webContents.send('colrev:restarting', info));
  b.on('restarted', () => mainWindow?.webContents.send('colrev:restarted'));
  b.on('restart-failed', () => {
    backend = null;
    mainWindow?.webContents.send('colrev:restart-failed');
  });
  b.on('rpc-queue', (state) => mainWindow?.webContents.send('colrev:rpc-queue', state));
}

async function startBackend(): Promise<{ success: boolean; message?: string; error?: string }> {
  if (backend) return { success: true, message: 'Already running' };

  try {
    const launch = resolveBackendLaunch({
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      gitEnv: setupGitEnvironment(),
      userDataDir: app.getPath('userData'),
      env: process.env,
    });

    backend = new ColrevBackend(launch.command, launch.args, launch.env);
    forwardBackendEvents(backend);
    await backend.start();
    return { success: true };
  } catch (err) {
    backend?.stop();
    backend = null;
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Forward one RPC to the Python backend.
 *
 * Returns an envelope instead of throwing: Electron strips custom Error
 * properties at the IPC boundary, and the renderer needs the structured
 * {code, message, data, method} to branch on error codes.
 */
async function callRpc(method: string, params: Record<string, unknown>) {
  try {
    if (!backend) {
      throw new RpcError('Backend not running', RPC_TRANSPORT_NOT_RUNNING, method);
    }
    const result = isLockFreeRpcMethod(method)
      ? await backend.call(method, params)
      : // Lock-retry lives in the Python dispatcher (see
        // colrev/ui_jsonrpc/framework/dispatcher.py); don't double-retry here.
        await withGitLock(`rpc:${method}`, () => backend!.call(method, params));
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: serializeRpcError(err) };
  }
}

// --- Dialog + file handlers ------------------------------------------------

interface DialogFilters {
  filters?: { name: string; extensions: string[] }[];
}

async function chooseSavePath(options: DialogFilters & { defaultName?: string }) {
  if (!mainWindow) return { success: false, error: 'No window' };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: options.defaultName,
    filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };
  return { success: true, filePath: result.filePath };
}

async function saveFileDialog(options: DialogFilters & { defaultName: string; content: string }) {
  const chosen = await chooseSavePath(options);
  if (!chosen.success || !chosen.filePath) return chosen;
  fs.writeFileSync(chosen.filePath, options.content, 'utf-8');
  return chosen;
}

async function openFileDialog(options: DialogFilters & { title?: string }) {
  if (!mainWindow) return { success: false, error: 'No window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title,
    properties: ['openFile'],
    filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  return { success: true, filePath: result.filePaths[0] };
}

/**
 * Resolve a project-relative path inside the active account's projects root,
 * refusing anything that escapes it. Shared by `pdf:exists` and the
 * `colrev-pdf://` protocol handler.
 */
function resolveAccountFile(projectId: string, relativePath: string): string | null {
  const login = authManager.getActiveLogin();
  if (!login) return null;
  const accountRoot = projectPaths.projectsRootForAccount(login);
  const filePath = path.resolve(accountRoot, projectId, relativePath);
  return filePath.startsWith(path.resolve(accountRoot)) ? filePath : null;
}

function pdfExists(params: { projectId: string; relativePath: string }) {
  if (!params?.projectId || !params?.relativePath) return { exists: false };
  const filePath = resolveAccountFile(params.projectId, params.relativePath);
  return { exists: filePath !== null && fs.existsSync(filePath) };
}

function appInfo() {
  const login = authManager.getActiveLogin();
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    version: app.getVersion(),
    projectsPath: login
      ? projectPaths.projectsRootForAccount(login)
      : projectPaths.projectsRoot,
  };
}

// --- Registration ----------------------------------------------------------

function setupIPC() {
  authManager.setAuthUpdateCallback((session) => {
    mainWindow?.webContents.send('auth:update', session);
  });
  authManager.setDeviceFlowCallback((status) => {
    mainWindow?.webContents.send('auth:device-flow-status', status);
  });

  registerHandlers([
    ...createAppHandlers({
      startBackend,
      stopBackend: async () => {
        backend?.stop();
        backend = null;
        return { success: true };
      },
      callRpc,
      saveFileDialog,
      chooseSavePath,
      openFileDialog,
      pdfExists,
      appInfo,
      auth: authManager,
      includeTestHandlers: !!process.env.COLREV_FAKE_GITHUB_REGISTRY,
    }),
    ...createGitHandlers({
      git: realGitOps,
      getToken: () => authManager.getToken(),
      callBackend: <T,>(method: string, params: Record<string, unknown>) => {
        if (!backend) return Promise.reject(new Error('Backend not running'));
        return backend.call<T>(method, params);
      },
    }),
    ...createGitHubHandlers({
      gh: getGitHubClient(),
      getToken: () => authManager.getToken(),
      getActiveLogin: () => authManager.getActiveLogin(),
      projectsRootForAccount: (login) => projectPaths.projectsRootForAccount(login),
      git: realGitHubGitOps,
      fs,
    }),
  ]);
}

app.whenReady().then(() => {
  // Configure dugite's git binary path before any dugite call. This sets
  // LOCAL_GIT_DIRECTORY on process.env so github:* / git:* IPC handlers work
  // regardless of whether the Python backend has been started yet.
  setupGitEnvironment();

  // Register colrev-pdf:// protocol handler for serving PDFs from project directories
  // URL format: colrev-pdf://pdf/<project-id>/<relative-path>
  protocol.handle('colrev-pdf', (request) => {
    const url = new URL(request.url);
    // With standard protocol, "pdf" in colrev-pdf://pdf/... is the hostname
    // pathname: /<project-id>/<relative-path>
    const parts = url.pathname.split('/').filter(Boolean);
    // parts[0] = projectId, parts[1...] = relative path
    if (url.hostname !== 'pdf' || parts.length < 2) {
      return new Response('Invalid PDF URL', { status: 400 });
    }

    const projectId = decodeURIComponent(parts[0]);
    const relativePath = parts.slice(1).map(decodeURIComponent).join('/');
    const filePath = resolveAccountFile(projectId, relativePath);
    if (!filePath) {
      return new Response('Access denied', { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      console.warn(
        `[pdf-debug] 404 for ${request.url} -> resolved=${filePath} (projectId=${projectId}, relativePath=${relativePath})`,
      );
      return new Response('PDF not found', { status: 404 });
    }

    return net.fetch(`file://${filePath}`);
  });

  setupIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  backend?.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  backend?.stop();
});
