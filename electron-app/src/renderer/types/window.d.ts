// Window API type declarations for Electron IPC

import type { RpcCallEnvelope } from "../lib/rpc-errors";
import type {
  ProgressEvent,
  RPCMethodName,
  RPCParams,
  RPCResult,
} from "./generated/rpc";

export interface RestartingInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface RpcQueueState {
  inFlight: { method: string; startedAt: number } | null;
  queued: string[];
}

export interface ColrevAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  /**
   * Send a JSON-RPC call: ``params`` and the returned ``result`` are typed
   * from the backend's Pydantic-derived schema. Resolves to an envelope; the
   * backend store unwraps it and rethrows failures as ``RpcError``
   * (structured errors don't survive Electron's IPC serialization as thrown
   * Errors). Renderer code should go through the backend store's
   * `call`/`callUntyped` rather than using this directly.
   */
  call: <M extends RPCMethodName>(
    method: M,
    params: RPCParams<M>,
  ) => Promise<RpcCallEnvelope<RPCResult<M>>>;
  stop: () => Promise<{ success: boolean }>;
  onLog: (callback: (msg: string) => void) => () => void;
  onError: (callback: (msg: string) => void) => () => void;
  onClose: (callback: (code: number | null) => void) => () => void;
  /**
   * Subscribe to structured progress events from long-running handlers
   * (search, load, prep, etc.). Replaces regex-parsing of stderr logs.
   */
  onProgress: (callback: (event: ProgressEvent) => void) => () => void;
  /** Supervised-restart lifecycle after an unexpected backend exit. */
  onRestarting: (callback: (info: RestartingInfo) => void) => () => void;
  onRestarted: (callback: () => void) => () => void;
  onRestartFailed: (callback: () => void) => () => void;
  /** Snapshots of the serial RPC queue (in-flight method + waiting list). */
  onRpcQueue: (callback: (state: RpcQueueState) => void) => () => void;
}

export interface FileOpsAPI {
  saveDialog: (options: {
    defaultName: string;
    content: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  chooseSavePath: (options: {
    defaultName?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  openDialog: (options: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
}

export interface PdfFilesAPI {
  exists: (params: {
    projectId: string;
    relativePath: string;
  }) => Promise<{ exists: boolean }>;
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
  /** `network_error`: GitHub unreachable for several polls (see auth-manager). */
  status: 'awaiting_code' | 'polling' | 'success' | 'error' | 'expired' | 'network_error';
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
  inviteUserSuggestions: (params: {
    remoteUrl: string;
    query: string;
    excludeLogins?: string[];
  }) => Promise<{ success: boolean; suggestions: GitHubCollaborator[]; error?: string }>;
  listPendingInvitations: (params: {
    remoteUrl: string;
  }) => Promise<{ success: boolean; invitations: PendingRepoInvitation[]; error?: string }>;
  listInvitations: () => Promise<{ success: boolean; invitations: RepoInvitation[]; error?: string }>;
  acceptInvitation: (params: {
    invitationId: number;
  }) => Promise<{ success: boolean; error?: string }>;
  declineInvitation: (params: {
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
  getCachedSession: () => Promise<AuthSession | null>;
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

/**
 * The single git snapshot owned by the main process (WP-07 §2).
 * Mirrors `GitStateSnapshot` in `electron-app/src/main/git-state.ts`.
 */
export interface GitStateSnapshot {
  projectId: string;
  branch: string;
  ahead: number;
  behind: number;
  mainAhead: number;
  mainBehind: number;
  isClean: boolean;
  remoteUrl: string | null;
  hasMergeConflict: boolean;
  uncommittedChanges: number;
  modifiedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  stagedRecordChanges: { recordId: string; changeType: string }[];
  lastCommit: {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    timestamp: string;
  } | null;
  refreshedAt: number;
}

export interface GitStateRefreshResult {
  success: boolean;
  error?: string;
  /** On failure this is the last good snapshot, if there is one. */
  state: GitStateSnapshot | null;
}

export interface GitStateAPI {
  refresh: (projectId: string, projectPath: string) => Promise<GitStateRefreshResult>;
  get: (projectId: string) => Promise<GitStateSnapshot | null>;
  onChanged: (callback: (snapshot: GitStateSnapshot) => void) => () => void;
}

export interface GitOperationResult {
  success: boolean;
  error?: string;
}

export interface GitCheckoutResult extends GitOperationResult {
  /** Populated when `error === 'DIRTY_WORKTREE'`. */
  dirty?: { uncommittedCount: number; untrackedCount: number };
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

// --- Merge conflict resolution types (mirror main/merge-flow.ts) ---

export interface MergeConflictItem {
  /** "records:<record_id>" or "settings:<dotted.path>" */
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

export interface MergeBlocker {
  id?: string;
  reason: string;
}

export interface MergeAnalysis {
  hasConflicts: boolean;
  autoMergeable: boolean;
  conflicts: MergeConflictItem[];
  blockers: MergeBlocker[];
}

export interface MergeConflictResolution {
  id: string;
  choice: 'local' | 'remote';
}

export interface GitAPI {
  fetch: (projectPath: string) => Promise<GitOperationResult>;
  pull: (projectPath: string, ffOnly?: boolean) => Promise<GitOperationResult>;
  fastForwardMain: (projectPath: string) => Promise<GitOperationResult>;
  push: (projectPath: string) => Promise<GitOperationResult>;
  pushBranch: (projectPath: string, branchName: string) => Promise<GitOperationResult>;
  listBranches: (projectPath: string) => Promise<GitBranchListResult>;
  createBranch: (projectPath: string, name: string, baseBranch?: string) => Promise<GitOperationResult>;
  createLocalBranch: (projectPath: string, name: string, baseRef: string) => Promise<GitOperationResult>;
  deleteLocalBranch: (projectPath: string, name: string) => Promise<GitOperationResult>;
  checkout: (projectPath: string, branchName: string) => Promise<GitCheckoutResult>;
  merge: (projectPath: string, source: string, ffOnly?: boolean) => Promise<GitOperationResult>;
  log: (projectPath: string, count?: number) => Promise<GitLogResult>;
  dirtyState: (projectPath: string) => Promise<GitDirtyState>;
  abortMerge: (projectPath: string) => Promise<GitOperationResult>;
  hasMergeConflict: (projectPath: string) => Promise<boolean>;
  addAndCommit: (projectPath: string, message: string) => Promise<GitOperationResult>;
  revListCount: (projectPath: string, from: string, to: string) => Promise<{ success: boolean; count: number; error?: string }>;
  analyzeDivergence: (
    projectPath: string,
    projectId: string,
  ) => Promise<{ success: boolean; analysis?: MergeAnalysis; error?: string }>;
  applyMerge: (
    projectPath: string,
    projectId: string,
    resolutions: MergeConflictResolution[],
  ) => Promise<{ success: boolean; pushed?: boolean; pushError?: string; error?: string }>;
}

declare global {
  interface Window {
    colrev: ColrevAPI;
    fileOps: FileOpsAPI;
    pdfFiles: PdfFilesAPI;
    appInfo: AppInfoAPI;
    auth: AuthAPI;
    gitState: GitStateAPI;
    github: GitHubAPI;
    git: GitAPI;
  }
}

export {};
