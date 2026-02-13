import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ColrevBackend } from './colrev-backend';
import { setupGitEnvironment } from './git-env';
import { AuthManager } from './auth-manager';
import { createRepoAndPush, listColrevRepos } from './github-manager';
import {
  gitFetch,
  gitPull,
  gitPush,
  gitListBranches,
  gitCreateBranch,
  gitCheckout,
  gitMerge,
  gitLog,
  gitGetDirtyState,
  gitAbortMerge,
  gitHasMergeConflict,
  gitClone,
} from './git-manager';

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Setup IPC handlers
function setupIPC() {
  // Start the CoLRev backend
  ipcMain.handle('colrev:start', async () => {
    if (backend) {
      return { success: true, message: 'Already running' };
    }

    try {
      // Setup Git environment from dugite
      const gitEnv = setupGitEnvironment();

      // Determine colrev-jsonrpc path
      // In dev mode, use Python module directly for faster iteration
      // In packaged mode, use the bundled executable
      const isDev = !app.isPackaged;

      let colrevPath: string;
      let colrevArgs: string[];

      if (isDev) {
        // Use Python to run main.py directly
        colrevPath = 'python';
        colrevArgs = [path.join(__dirname, '../../../main.py')];
      } else {
        colrevPath = path.join(process.resourcesPath, 'colrev-jsonrpc');
        colrevArgs = [];
      }

      backend = new ColrevBackend(colrevPath, colrevArgs, gitEnv);

      // Forward events to renderer
      backend.on('log', (msg) => {
        mainWindow?.webContents.send('colrev:log', msg);
      });
      backend.on('error', (err) => {
        mainWindow?.webContents.send('colrev:error', err.message);
      });
      backend.on('close', (code) => {
        mainWindow?.webContents.send('colrev:close', code);
        backend = null;
      });

      await backend.start();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  // Make RPC call
  ipcMain.handle('colrev:call', async (_, method: string, params: Record<string, unknown>) => {
    if (!backend) {
      throw new Error('Backend not running');
    }
    return backend.call(method, params);
  });

  // Stop backend
  ipcMain.handle('colrev:stop', async () => {
    if (backend) {
      backend.stop();
      backend = null;
    }
    return { success: true };
  });

  // Save file dialog
  ipcMain.handle(
    'file:save-dialog',
    async (_, options: { defaultName: string; content: string; filters?: { name: string; extensions: string[] }[] }) => {
      if (!mainWindow) return { success: false, error: 'No window' };

      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: options.defaultName,
        filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(result.filePath, options.content, 'utf-8');
      return { success: true, filePath: result.filePath };
    },
  );

  // Auth handlers
  authManager.setAuthUpdateCallback((session) => {
    mainWindow?.webContents.send('auth:update', session);
  });
  authManager.setDeviceFlowCallback((status) => {
    mainWindow?.webContents.send('auth:device-flow-status', status);
  });

  ipcMain.handle('auth:get-session', () => authManager.getSession());
  ipcMain.handle('auth:login', () => authManager.startDeviceFlow());
  ipcMain.handle('auth:logout', () => authManager.logout());
  ipcMain.handle('auth:get-token', () => authManager.getToken());

  // GitHub handlers
  ipcMain.handle(
    'github:create-repo-and-push',
    async (
      _,
      params: { repoName: string; projectPath: string; isPrivate: boolean; description?: string },
    ) => {
      const token = authManager.getToken();
      if (!token) return { success: false, error: 'Not authenticated' };
      return createRepoAndPush({ token, ...params });
    },
  );

  // GitHub: list CoLRev repos
  ipcMain.handle('github:list-colrev-repos', async () => {
    const token = authManager.getToken();
    if (!token) return { success: false, error: 'Not authenticated', repos: [] };
    try {
      const repos = await listColrevRepos(token);
      return { success: true, repos };
    } catch (err) {
      return {
        success: false,
        repos: [],
        error: err instanceof Error ? err.message : 'Failed to list repos',
      };
    }
  });

  // GitHub: clone a repo into the projects directory
  ipcMain.handle(
    'github:clone-repo',
    async (_, params: { cloneUrl: string; projectId: string }) => {
      const token = authManager.getToken();
      const projectsPath = path.join(app.getPath('userData'), 'projects');

      // Ensure projects directory exists
      if (!fs.existsSync(projectsPath)) {
        fs.mkdirSync(projectsPath, { recursive: true });
      }

      const targetPath = path.join(projectsPath, params.projectId);

      // Validate target doesn't already exist
      if (fs.existsSync(targetPath)) {
        return { success: false, error: 'Project directory already exists' };
      }

      return gitClone(params.cloneUrl, targetPath, token);
    },
  );

  // Git operation handlers
  ipcMain.handle('git:fetch', async (_, projectPath: string) => {
    const token = authManager.getToken();
    return gitFetch(projectPath, token);
  });

  ipcMain.handle('git:pull', async (_, projectPath: string, ffOnly?: boolean) => {
    const token = authManager.getToken();
    return gitPull(projectPath, token, ffOnly ?? true);
  });

  ipcMain.handle('git:push', async (_, projectPath: string) => {
    const token = authManager.getToken();
    return gitPush(projectPath, token);
  });

  ipcMain.handle('git:list-branches', async (_, projectPath: string) => {
    return gitListBranches(projectPath);
  });

  ipcMain.handle('git:create-branch', async (_, projectPath: string, name: string, baseBranch?: string) => {
    return gitCreateBranch(projectPath, name, baseBranch);
  });

  ipcMain.handle('git:checkout', async (_, projectPath: string, branchName: string) => {
    return gitCheckout(projectPath, branchName);
  });

  ipcMain.handle('git:merge', async (_, projectPath: string, source: string, ffOnly?: boolean) => {
    return gitMerge(projectPath, source, ffOnly ?? true);
  });

  ipcMain.handle('git:log', async (_, projectPath: string, count?: number) => {
    return gitLog(projectPath, count);
  });

  ipcMain.handle('git:dirty-state', async (_, projectPath: string) => {
    return gitGetDirtyState(projectPath);
  });

  ipcMain.handle('git:abort-merge', async (_, projectPath: string) => {
    return gitAbortMerge(projectPath);
  });

  ipcMain.handle('git:has-merge-conflict', async (_, projectPath: string) => {
    return gitHasMergeConflict(projectPath);
  });

  // Get app info
  ipcMain.handle('app:info', () => {
    // Use app's userData folder (~/Library/Application Support/AppName on macOS)
    const projectsPath = path.join(app.getPath('userData'), 'projects');

    return {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      version: app.getVersion(),
      projectsPath, // Writable path for CoLRev projects
    };
  });
}

app.whenReady().then(() => {
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
    const projectsPath = path.join(app.getPath('userData'), 'projects');
    const filePath = path.resolve(projectsPath, projectId, relativePath);

    // Security: verify resolved path stays within projects directory
    if (!filePath.startsWith(path.resolve(projectsPath))) {
      return new Response('Access denied', { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
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
