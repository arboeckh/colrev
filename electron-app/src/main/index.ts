import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ColrevBackend } from './colrev-backend';
import { setupGitEnvironment } from './git-env';

let mainWindow: BrowserWindow | null = null;
let backend: ColrevBackend | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
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
