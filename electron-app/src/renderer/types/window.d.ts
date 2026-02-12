// Window API type declarations for Electron IPC

export interface ColrevAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  call: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
  stop: () => Promise<{ success: boolean }>;
  onLog: (callback: (msg: string) => void) => () => void;
  onError: (callback: (msg: string) => void) => () => void;
  onClose: (callback: (code: number | null) => void) => () => void;
}

export interface FileOpsAPI {
  saveDialog: (options: {
    defaultName: string;
    content: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
}

export interface AppInfoAPI {
  get: () => Promise<{
    isPackaged: boolean;
    resourcesPath: string;
    appPath: string;
    version: string;
    projectsPath: string;
  }>;
}

declare global {
  interface Window {
    colrev: ColrevAPI;
    fileOps: FileOpsAPI;
    appInfo: AppInfoAPI;
  }
}

export {};
