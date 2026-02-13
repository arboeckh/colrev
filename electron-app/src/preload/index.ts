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
 * Expose app info API.
 */
contextBridge.exposeInMainWorld('appInfo', {
  get: () => ipcRenderer.invoke('app:info'),
});
