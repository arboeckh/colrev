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

export interface AuthSession {
  user: {
    login: string;
    name: string | null;
    avatarUrl: string;
    email: string | null;
  };
  authenticatedAt: string;
}

export interface DeviceFlowStatus {
  status: 'awaiting_code' | 'polling' | 'success' | 'error' | 'expired';
  userCode?: string;
  verificationUri?: string;
  error?: string;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  owner: string;
  htmlUrl: string;
  description: string | null;
  isPrivate: boolean;
  updatedAt: string;
  cloneUrl: string;
}

export interface GitHubRelease {
  id: number;
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  author: string;
}

export interface GitHubAPI {
  createRepoAndPush: (params: {
    repoName: string;
    projectPath: string;
    isPrivate: boolean;
    description?: string;
  }) => Promise<{ success: boolean; repoUrl?: string; htmlUrl?: string; error?: string }>;
  listColrevRepos: () => Promise<{ success: boolean; repos: GitHubRepo[]; error?: string }>;
  cloneRepo: (params: {
    cloneUrl: string;
    projectId: string;
  }) => Promise<{ success: boolean; error?: string }>;
  listReleases: (params: {
    remoteUrl: string;
  }) => Promise<{ success: boolean; releases: GitHubRelease[]; error?: string }>;
  createRelease: (params: {
    remoteUrl: string;
    tagName: string;
    name: string;
    body: string;
    projectPath: string;
  }) => Promise<{ success: boolean; release?: GitHubRelease; error?: string }>;
}

export interface AuthAPI {
  getSession: () => Promise<AuthSession | null>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
  onAuthUpdate: (callback: (session: AuthSession | null) => void) => () => void;
  onDeviceFlowStatus: (callback: (status: DeviceFlowStatus) => void) => () => void;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  lastCommitDate?: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitOperationResult {
  success: boolean;
  error?: string;
}

export interface GitBranchListResult extends GitOperationResult {
  branches: GitBranchInfo[];
  currentBranch: string;
}

export interface GitLogResult extends GitOperationResult {
  commits: GitLogEntry[];
}

export interface GitDirtyState extends GitOperationResult {
  isDirty: boolean;
  uncommittedCount: number;
  untrackedCount: number;
}

export interface GitAPI {
  fetch: (projectPath: string) => Promise<GitOperationResult>;
  pull: (projectPath: string, ffOnly?: boolean) => Promise<GitOperationResult>;
  push: (projectPath: string) => Promise<GitOperationResult>;
  listBranches: (projectPath: string) => Promise<GitBranchListResult>;
  createBranch: (projectPath: string, name: string, baseBranch?: string) => Promise<GitOperationResult>;
  checkout: (projectPath: string, branchName: string) => Promise<GitOperationResult>;
  merge: (projectPath: string, source: string, ffOnly?: boolean) => Promise<GitOperationResult>;
  log: (projectPath: string, count?: number) => Promise<GitLogResult>;
  dirtyState: (projectPath: string) => Promise<GitDirtyState>;
  abortMerge: (projectPath: string) => Promise<GitOperationResult>;
  hasMergeConflict: (projectPath: string) => Promise<boolean>;
  addAndCommit: (projectPath: string, message: string) => Promise<GitOperationResult>;
  revListCount: (projectPath: string, from: string, to: string) => Promise<{ success: boolean; count: number; error?: string }>;
}

declare global {
  interface Window {
    colrev: ColrevAPI;
    fileOps: FileOpsAPI;
    appInfo: AppInfoAPI;
    auth: AuthAPI;
    github: GitHubAPI;
    git: GitAPI;
  }
}

export {};
