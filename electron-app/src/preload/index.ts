import { contextBridge, ipcRenderer } from 'electron';

/**
 * Expose CoLRev API to the renderer process via context bridge.
 * This maintains security by not exposing full Node.js APIs.
 */
contextBridge.exposeInMainWorld('colrev', {
  /**
   * Start the CoLRev backend subprocess.
   */
  start: () => ipcRenderer.invoke('colrev:start'),

  /**
   * Make a JSON-RPC call to the backend.
   */
  call: (method: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke('colrev:call', method, params),

  /**
   * Stop the CoLRev backend.
   */
  stop: () => ipcRenderer.invoke('colrev:stop'),

  /**
   * Subscribe to backend logs.
   */
  onLog: (callback: (msg: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on('colrev:log', handler);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('colrev:log', handler);
  },

  /**
   * Subscribe to backend errors.
   */
  onError: (callback: (msg: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on('colrev:error', handler);
    return () => ipcRenderer.removeListener('colrev:error', handler);
  },

  /**
   * Subscribe to backend close events.
   */
  onClose: (callback: (code: number | null) => void) => {
    const handler = (_: Electron.IpcRendererEvent, code: number | null) => callback(code);
    ipcRenderer.on('colrev:close', handler);
    return () => ipcRenderer.removeListener('colrev:close', handler);
  },
});

/**
 * Expose file operations API.
 */
contextBridge.exposeInMainWorld('fileOps', {
  saveDialog: (options: { defaultName: string; content: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('file:save-dialog', options),
});

/**
 * Expose auth API.
 */
contextBridge.exposeInMainWorld('auth', {
  getSession: () => ipcRenderer.invoke('auth:get-session'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getToken: () => ipcRenderer.invoke('auth:get-token'),

  onAuthUpdate: (callback: (session: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, session: unknown) => callback(session);
    ipcRenderer.on('auth:update', handler);
    return () => ipcRenderer.removeListener('auth:update', handler);
  },

  onDeviceFlowStatus: (callback: (status: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('auth:device-flow-status', handler);
    return () => ipcRenderer.removeListener('auth:device-flow-status', handler);
  },
});

/**
 * Expose GitHub API.
 */
contextBridge.exposeInMainWorld('github', {
  createRepoAndPush: (params: {
    repoName: string;
    projectPath: string;
    isPrivate: boolean;
    description?: string;
  }) => ipcRenderer.invoke('github:create-repo-and-push', params),

  listColrevRepos: () => ipcRenderer.invoke('github:list-colrev-repos'),

  cloneRepo: (params: { cloneUrl: string; projectId: string }) =>
    ipcRenderer.invoke('github:clone-repo', params),

  listReleases: (params: { remoteUrl: string }) =>
    ipcRenderer.invoke('github:list-releases', params),

  createRelease: (params: { remoteUrl: string; tagName: string; name: string; body: string; projectPath: string }) =>
    ipcRenderer.invoke('github:create-release', params),
});

/**
 * Expose Git operations API.
 */
contextBridge.exposeInMainWorld('git', {
  fetch: (projectPath: string) => ipcRenderer.invoke('git:fetch', projectPath),
  pull: (projectPath: string, ffOnly?: boolean) => ipcRenderer.invoke('git:pull', projectPath, ffOnly),
  push: (projectPath: string) => ipcRenderer.invoke('git:push', projectPath),
  listBranches: (projectPath: string) => ipcRenderer.invoke('git:list-branches', projectPath),
  createBranch: (projectPath: string, name: string, baseBranch?: string) =>
    ipcRenderer.invoke('git:create-branch', projectPath, name, baseBranch),
  checkout: (projectPath: string, branchName: string) =>
    ipcRenderer.invoke('git:checkout', projectPath, branchName),
  merge: (projectPath: string, source: string, ffOnly?: boolean) =>
    ipcRenderer.invoke('git:merge', projectPath, source, ffOnly),
  log: (projectPath: string, count?: number) => ipcRenderer.invoke('git:log', projectPath, count),
  dirtyState: (projectPath: string) => ipcRenderer.invoke('git:dirty-state', projectPath),
  abortMerge: (projectPath: string) => ipcRenderer.invoke('git:abort-merge', projectPath),
  hasMergeConflict: (projectPath: string) => ipcRenderer.invoke('git:has-merge-conflict', projectPath),
  addAndCommit: (projectPath: string, message: string) =>
    ipcRenderer.invoke('git:add-and-commit', projectPath, message),
  revListCount: (projectPath: string, from: string, to: string) =>
    ipcRenderer.invoke('git:rev-list-count', projectPath, from, to),
});

/**
 * Expose app info API.
 */
contextBridge.exposeInMainWorld('appInfo', {
  get: () => ipcRenderer.invoke('app:info'),
});
