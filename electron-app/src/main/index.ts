import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ColrevBackend } from './colrev-backend';
import { setupGitEnvironment } from './git-env';
import { AuthManager } from './auth-manager';

// Allow running multiple instances with separate data directories via COLREV_USER env var
// Usage: COLREV_USER=alice npm run dev  /  COLREV_USER=bob npm run dev
if (process.env.COLREV_USER) {
  app.setPath('userData', path.join(app.getPath('userData') + '-' + process.env.COLREV_USER));
}
import {
  createRepoAndPush,
  listColrevRepos,
  parseOwnerRepo,
  listReleases,
  createGitHubRelease,
  listRepoCollaborators,
  addRepoCollaborator,
  listRepoInvitations,
  acceptRepoInvitation,
  listPendingRepoInvitations,
  deleteGitHubRepo,
} from './github-manager';
import {
  gitFetch,
  gitPull,
  gitPush,
  gitPushBranch,
  gitListBranches,
  gitCreateBranch,
  gitCreateLocalBranch,
  gitDeleteLocalBranch,
  gitCheckout,
  gitMerge,
  gitLog,
  gitGetDirtyState,
  gitAbortMerge,
  gitHasMergeConflict,
  gitClone,
  gitCreateTag,
  gitPushTags,
  gitRevListCount,
  gitAddAndCommit,
  gitMergeBase,
  gitShowFile,
  gitDiffNameOnly,
  gitMergeNoCommit,
  gitStageAndCommitMerge,
} from './git-manager';
import {
  analyzeDivergence,
  applyResolutions,
  type MergeAnalysis,
  type ConflictResolution,
} from './semantic-merge';

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
  ipcMain.handle('auth:list-accounts', () => authManager.listAccounts());
  ipcMain.handle('auth:switch-account', (_, login: string) => authManager.switchAccount(login));
  ipcMain.handle('auth:remove-account', (_, login: string) => {
    authManager.removeAccount(login);
    return { success: true };
  });

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

  ipcMain.handle('git:push-branch', async (_, projectPath: string, branchName: string) => {
    const token = authManager.getToken();
    return gitPushBranch(projectPath, branchName, token);
  });

  ipcMain.handle('git:list-branches', async (_, projectPath: string) => {
    return gitListBranches(projectPath);
  });

  ipcMain.handle('git:create-branch', async (_, projectPath: string, name: string, baseBranch?: string) => {
    return gitCreateBranch(projectPath, name, baseBranch);
  });

  ipcMain.handle('git:create-local-branch', async (_, projectPath: string, name: string, baseRef: string) => {
    return gitCreateLocalBranch(projectPath, name, baseRef);
  });

  ipcMain.handle('git:delete-local-branch', async (_, projectPath: string, name: string) => {
    return gitDeleteLocalBranch(projectPath, name);
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

  ipcMain.handle('git:add-and-commit', async (_, projectPath: string, message: string) => {
    return gitAddAndCommit(projectPath, message);
  });

  ipcMain.handle('git:rev-list-count', async (_, projectPath: string, from: string, to: string) => {
    return gitRevListCount(projectPath, from, to);
  });

  // --- Conflict resolution handlers ---

  ipcMain.handle('git:analyze-divergence', async (_, projectPath: string) => {
    try {
      // 1. Find merge base
      const baseResult = await gitMergeBase(projectPath, 'HEAD', 'origin/dev');
      if (!baseResult.success || !baseResult.commitHash) {
        return { success: false, error: baseResult.error || 'No common ancestor found' };
      }
      const baseHash = baseResult.commitHash;

      // 2. Find files changed on each side
      const [localDiff, remoteDiff] = await Promise.all([
        gitDiffNameOnly(projectPath, baseHash, 'HEAD'),
        gitDiffNameOnly(projectPath, baseHash, 'origin/dev'),
      ]);

      if (!localDiff.success || !remoteDiff.success) {
        return { success: false, error: 'Failed to determine changed files' };
      }

      // 3. Run semantic analysis
      const analysis = await analyzeDivergence({
        projectPath,
        baseHash,
        localChangedFiles: localDiff.files,
        remoteChangedFiles: remoteDiff.files,
        getFileContent: async (ref: string, filePath: string) => {
          const result = await gitShowFile(projectPath, ref, filePath);
          return result.success ? (result.content ?? null) : null;
        },
      });

      return { success: true, analysis };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Analysis failed' };
    }
  });

  ipcMain.handle(
    'git:apply-merge',
    async (
      _,
      projectPath: string,
      resolutions: ConflictResolution[],
      analysisJson: MergeAnalysis,
    ) => {
      const token = authManager.getToken();
      console.log('[apply-merge] Starting with', resolutions.length, 'resolutions, files:', Object.keys(analysisJson.fileResults || {}));

      try {
        // 1. Read local and remote files for resolution
        const localFiles: Record<string, string> = {};
        const remoteFiles: Record<string, string> = {};

        for (const filePath of Object.keys(analysisJson.fileResults)) {
          const [localResult, remoteResult] = await Promise.all([
            gitShowFile(projectPath, 'HEAD', filePath),
            gitShowFile(projectPath, 'origin/dev', filePath),
          ]);
          if (localResult.success && localResult.content) localFiles[filePath] = localResult.content;
          if (remoteResult.success && remoteResult.content) remoteFiles[filePath] = remoteResult.content;
        }

        // 2. Compute resolved file contents
        const resolvedFiles = applyResolutions(analysisJson, resolutions, localFiles, remoteFiles);
        console.log('[apply-merge] Resolved files:', Object.keys(resolvedFiles));

        // 3. Start the merge (no-commit so we can write resolved files)
        const mergeResult = await gitMergeNoCommit(projectPath, 'origin/dev');
        console.log('[apply-merge] Merge result:', mergeResult);
        if (!mergeResult.success) {
          await gitAbortMerge(projectPath);
          return { success: false, error: mergeResult.error || 'Merge failed' };
        }

        // 4. Write resolved files to disk
        const filesToStage: string[] = [];
        for (const [filePath, content] of Object.entries(resolvedFiles)) {
          const fullPath = path.join(projectPath, filePath);
          // Ensure directory exists
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(fullPath, content, 'utf-8');
          filesToStage.push(filePath);
        }

        // 5. Stage and commit
        const commitResult = await gitStageAndCommitMerge(
          projectPath,
          filesToStage,
          'Sync: merge remote changes',
        );
        if (!commitResult.success) {
          await gitAbortMerge(projectPath);
          return { success: false, error: commitResult.error || 'Commit failed' };
        }

        // 6. Push
        const pushResult = await gitPush(projectPath, token);
        if (!pushResult.success) {
          // Merge succeeded locally but push failed — not fatal, user can retry
          return { success: true, pushFailed: true };
        }

        return { success: true };
      } catch (err) {
        // Abort merge on any unexpected error
        await gitAbortMerge(projectPath);
        return { success: false, error: err instanceof Error ? err.message : 'Merge failed' };
      }
    },
  );

  // GitHub: list releases
  ipcMain.handle('github:list-releases', async (_, params: { remoteUrl: string }) => {
    const token = authManager.getToken();
    if (!token) return { success: false, error: 'Not authenticated', releases: [] };
    const parsed = parseOwnerRepo(params.remoteUrl);
    if (!parsed) return { success: false, error: 'Not a GitHub URL', releases: [] };
    try {
      const releases = await listReleases(token, parsed.owner, parsed.repo);
      return { success: true, releases };
    } catch (err) {
      return { success: false, releases: [], error: err instanceof Error ? err.message : 'Failed to list releases' };
    }
  });

  ipcMain.handle('github:list-collaborators', async (_, params: { remoteUrl: string }) => {
    const token = authManager.getToken();
    if (!token) return { success: false, error: 'Not authenticated', collaborators: [] };
    const parsed = parseOwnerRepo(params.remoteUrl);
    if (!parsed) return { success: false, error: 'Not a GitHub URL', collaborators: [] };
    try {
      const collaborators = await listRepoCollaborators(token, parsed.owner, parsed.repo);
      return { success: true, collaborators };
    } catch (err) {
      return {
        success: false,
        collaborators: [],
        error: err instanceof Error ? err.message : 'Failed to list collaborators',
      };
    }
  });

  ipcMain.handle(
    'github:add-collaborator',
    async (_, params: { remoteUrl: string; username: string; permission?: 'pull' | 'push' | 'admin' }) => {
      const token = authManager.getToken();
      if (!token) return { success: false, error: 'Not authenticated' };
      const parsed = parseOwnerRepo(params.remoteUrl);
      if (!parsed) return { success: false, error: 'Not a GitHub URL' };
      try {
        return await addRepoCollaborator(
          token,
          parsed.owner,
          parsed.repo,
          params.username,
          params.permission ?? 'push',
        );
      } catch (err) {
        return {
          success: false,
          invited: false,
          error: err instanceof Error ? err.message : 'Failed to add collaborator',
        };
      }
    },
  );

  ipcMain.handle('github:list-pending-invitations', async (_, params: { remoteUrl: string }) => {
    const token = authManager.getToken();
    if (!token) return { success: false, error: 'Not authenticated', invitations: [] };
    const parsed = parseOwnerRepo(params.remoteUrl);
    if (!parsed) return { success: false, error: 'Not a GitHub URL', invitations: [] };
    try {
      const invitations = await listPendingRepoInvitations(token, parsed.owner, parsed.repo);
      return { success: true, invitations };
    } catch (err) {
      return {
        success: false,
        invitations: [],
        error: err instanceof Error ? err.message : 'Failed to list pending invitations',
      };
    }
  });

  ipcMain.handle('github:list-invitations', async () => {
    const token = authManager.getToken();
    if (!token) return { success: false, error: 'Not authenticated', invitations: [] };
    try {
      const invitations = await listRepoInvitations(token);
      return { success: true, invitations };
    } catch (err) {
      return {
        success: false,
        invitations: [],
        error: err instanceof Error ? err.message : 'Failed to list invitations',
      };
    }
  });

  ipcMain.handle('github:accept-invitation', async (_, params: { invitationId: number }) => {
    const token = authManager.getToken();
    if (!token) return { success: false, error: 'Not authenticated' };
    try {
      return await acceptRepoInvitation(token, params.invitationId);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to accept invitation',
      };
    }
  });

  // GitHub: delete a repository
  ipcMain.handle('github:delete-repo', async (_, params: { remoteUrl: string }) => {
    const token = authManager.getToken();
    if (!token) return { success: false, error: 'Not authenticated' };
    const parsed = parseOwnerRepo(params.remoteUrl);
    if (!parsed) return { success: false, error: 'Not a GitHub URL' };
    try {
      return await deleteGitHubRepo(token, parsed.owner, parsed.repo);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete repository',
      };
    }
  });

  // GitHub: create release (tag + push tags + GitHub release)
  ipcMain.handle(
    'github:create-release',
    async (_, params: { remoteUrl: string; tagName: string; name: string; body: string; projectPath: string }) => {
      const token = authManager.getToken();
      if (!token) return { success: false, error: 'Not authenticated' };
      const parsed = parseOwnerRepo(params.remoteUrl);
      if (!parsed) return { success: false, error: 'Not a GitHub URL' };

      // 1. Create local tag
      const tagResult = await gitCreateTag(params.projectPath, params.tagName, params.name);
      if (!tagResult.success) return tagResult;

      // 2. Push tags to remote
      const pushResult = await gitPushTags(params.projectPath, token);
      if (!pushResult.success) return pushResult;

      // 3. Create GitHub release
      const releaseResult = await createGitHubRelease(token, parsed.owner, parsed.repo, {
        tagName: params.tagName,
        name: params.name,
        body: params.body,
      });
      return releaseResult;
    },
  );

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
