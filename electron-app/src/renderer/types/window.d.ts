// Window API type declarations for Electron IPC

import type {
  ProgressEvent,
  RPCMethodName,
  RPCParams,
  RPCResult,
} from "./generated/rpc";

export interface ColrevAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  /**
   * Typed overload: when ``method`` is a known RPC method name, both the
   * ``params`` and the returned ``result`` are validated against the
   * backend's Pydantic-derived schema.
   *
   * The generic fallback remains for legacy call sites that haven't been
   * updated; once every caller is typed, we can drop it.
   */
  call: (<M extends RPCMethodName>(
    method: M,
    params: RPCParams<M>,
  ) => Promise<RPCResult<M>>) &
    (<T>(method: string, params: Record<string, unknown>) => Promise<T>);
  stop: () => Promise<{ success: boolean }>;
  onLog: (callback: (msg: string) => void) => () => void;
  onError: (callback: (msg: string) => void) => () => void;
  onClose: (callback: (code: number | null) => void) => () => void;
  /**
   * Subscribe to structured progress events from long-running handlers
   * (search, load, prep, etc.). Replaces regex-parsing of stderr logs.
   */
  onProgress: (callback: (event: ProgressEvent) => void) => () => void;
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

export interface GitHubCollaborator {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface PendingRepoInvitation {
  id: number;
  inviteeLogin: string;
  inviteeAvatarUrl: string;
  permission: string;
  createdAt: string;
}

export interface RepoInvitation {
  id: number;
  repoFullName: string;
  repoUrl: string;
  inviter: string;
  inviterAvatarUrl: string;
  permission: string;
  createdAt: string;
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
  listCollaborators: (params: {
    remoteUrl: string;
  }) => Promise<{ success: boolean; collaborators: GitHubCollaborator[]; error?: string }>;
  addCollaborator: (params: {
    remoteUrl: string;
    username: string;
    permission?: 'pull' | 'push' | 'admin';
  }) => Promise<{ success: boolean; invited?: boolean; error?: string }>;
  listPendingInvitations: (params: {
    remoteUrl: string;
  }) => Promise<{ success: boolean; invitations: PendingRepoInvitation[]; error?: string }>;
  listInvitations: () => Promise<{ success: boolean; invitations: RepoInvitation[]; error?: string }>;
  acceptInvitation: (params: {
    invitationId: number;
  }) => Promise<{ success: boolean; error?: string }>;
  createRelease: (params: {
    remoteUrl: string;
    tagName: string;
    name: string;
    body: string;
    projectPath: string;
  }) => Promise<{ success: boolean; release?: GitHubRelease; error?: string }>;
  deleteRepo: (params: {
    remoteUrl: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export interface AccountInfo {
  login: string;
  name: string | null;
  avatarUrl: string;
  isActive: boolean;
}

export interface AuthAPI {
  getSession: () => Promise<AuthSession | null>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
  listAccounts: () => Promise<AccountInfo[]>;
  switchAccount: (login: string) => Promise<AuthSession | null>;
  removeAccount: (login: string) => Promise<{ success: boolean }>;
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

// --- Merge conflict resolution types ---

export interface MergeConflictItem {
  id: string;
  file: string;
  path: string;
  label: string;
  description?: string;
  localValue: unknown;
  remoteValue: unknown;
  localLabel?: string;
  remoteLabel?: string;
}

export interface MergeAutoMergedChange {
  label: string;
  source: 'local' | 'remote';
}

export interface MergeFileResolution {
  content: string;
  needsResolution: boolean;
}

export interface MergeAnalysis {
  hasConflicts: boolean;
  conflicts: MergeConflictItem[];
  autoMerged: MergeAutoMergedChange[];
  fileResults: Record<string, MergeFileResolution>;
}

export interface MergeConflictResolution {
  id: string;
  choice: 'local' | 'remote';
}

export interface GitAPI {
  fetch: (projectPath: string) => Promise<GitOperationResult>;
  pull: (projectPath: string, ffOnly?: boolean) => Promise<GitOperationResult>;
  push: (projectPath: string) => Promise<GitOperationResult>;
  pushBranch: (projectPath: string, branchName: string) => Promise<GitOperationResult>;
  listBranches: (projectPath: string) => Promise<GitBranchListResult>;
  createBranch: (projectPath: string, name: string, baseBranch?: string) => Promise<GitOperationResult>;
  createLocalBranch: (projectPath: string, name: string, baseRef: string) => Promise<GitOperationResult>;
  deleteLocalBranch: (projectPath: string, name: string) => Promise<GitOperationResult>;
  checkout: (projectPath: string, branchName: string) => Promise<GitOperationResult>;
  merge: (projectPath: string, source: string, ffOnly?: boolean) => Promise<GitOperationResult>;
  log: (projectPath: string, count?: number) => Promise<GitLogResult>;
  dirtyState: (projectPath: string) => Promise<GitDirtyState>;
  abortMerge: (projectPath: string) => Promise<GitOperationResult>;
  hasMergeConflict: (projectPath: string) => Promise<boolean>;
  addAndCommit: (projectPath: string, message: string) => Promise<GitOperationResult>;
  revListCount: (projectPath: string, from: string, to: string) => Promise<{ success: boolean; count: number; error?: string }>;
  analyzeDivergence: (projectPath: string) => Promise<{ success: boolean; analysis?: MergeAnalysis; error?: string }>;
  applyMerge: (projectPath: string, resolutions: MergeConflictResolution[], analysis: MergeAnalysis) => Promise<{ success: boolean; pushFailed?: boolean; error?: string }>;
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
