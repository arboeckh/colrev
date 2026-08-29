/**
 * The single owner of git facts for a project (WP-07 §2).
 *
 * Before this, the same facts existed in four places — the Python
 * `get_git_status` response, `projects.currentGitStatus`, the renderer `git`
 * store's own refs, and `pendingChanges`' independent copy — each refreshed by
 * a different caller, so guards like `canPush` acted on whichever copy had
 * refreshed last. Now one snapshot per project is built here, under the git
 * mutex, and pushed to the renderer; every consumer subscribes to it.
 */

import * as path from 'path';

export interface StagedRecordChange {
  recordId: string;
  changeType: string;
}

export interface LastCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface GitStateSnapshot {
  projectId: string;
  branch: string;
  ahead: number;
  behind: number;
  /** local main vs origin/main — independent of the checked-out branch. */
  mainAhead: number;
  mainBehind: number;
  isClean: boolean;
  remoteUrl: string | null;
  hasMergeConflict: boolean;
  uncommittedChanges: number;
  modifiedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  stagedRecordChanges: StagedRecordChange[];
  lastCommit: LastCommit | null;
  /** ms since epoch; lets the renderer tell a stale snapshot from a fresh one. */
  refreshedAt: number;
}

/** Shape of the Python `get_git_status` response this reads. */
interface GitStatusRpcResponse {
  success?: boolean;
  git?: {
    branch?: string;
    ahead?: number;
    behind?: number;
    main_ahead?: number;
    main_behind?: number;
    is_clean?: boolean;
    remote_url?: string | null;
    uncommitted_changes?: number;
    modified_files?: string[];
    staged_files?: string[];
    untracked_files?: string[];
    staged_record_changes?: { record_id: string; change_type: string }[];
    last_commit?: {
      hash: string;
      short_hash: string;
      message: string;
      author: string;
      timestamp: string;
    } | null;
  } | null;
}

export interface GitStateDeps {
  /** Direct RPC call — the caller already holds the git mutex. */
  callBackend<T>(method: string, params: Record<string, unknown>): Promise<T>;
  hasMergeConflict(projectPath: string): Promise<boolean>;
  /** Push the new snapshot to the renderer. */
  emit(snapshot: GitStateSnapshot): void;
  now?: () => number;
}

/**
 * Remove `user:token@` from a remote URL. Tokens reach the URL when a clone
 * was authenticated the old way; they must never reach the renderer or a log.
 */
export function stripUrlUserinfo(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@]*@/i, '$1');
}

export class GitStateManager {
  private readonly snapshots = new Map<string, GitStateSnapshot>();

  constructor(private readonly deps: GitStateDeps) {}

  get(projectId: string): GitStateSnapshot | null {
    return this.snapshots.get(projectId) ?? null;
  }

  forget(projectId: string): void {
    this.snapshots.delete(projectId);
  }

  /**
   * Rebuild the snapshot for one project and push it to the renderer.
   *
   * Throws if the backend call fails — the cached snapshot is left in place so
   * a transient failure doesn't blank the UI; the caller reports staleness.
   */
  async refresh(projectId: string, projectPath: string): Promise<GitStateSnapshot> {
    const [response, hasMergeConflict] = await Promise.all([
      this.deps.callBackend<GitStatusRpcResponse>('get_git_status', {
        // The RPC layer resolves projects as `<base_path>/<project_id>`.
        // Renderer calls get this injected by the backend store; a
        // main-process call has to supply it itself.
        base_path: path.dirname(projectPath),
        project_id: projectId,
      }),
      // Best-effort: a repo mid-rebase can fail this read without invalidating
      // everything else in the snapshot.
      this.deps.hasMergeConflict(projectPath).catch(() => false),
    ]);

    const git = response?.git;
    if (!git) {
      throw new Error(`get_git_status returned no git state for "${projectId}"`);
    }

    const snapshot: GitStateSnapshot = {
      projectId,
      branch: git.branch ?? 'main',
      ahead: git.ahead ?? 0,
      behind: git.behind ?? 0,
      mainAhead: git.main_ahead ?? 0,
      mainBehind: git.main_behind ?? 0,
      isClean: git.is_clean ?? true,
      remoteUrl: git.remote_url ? stripUrlUserinfo(git.remote_url) : null,
      hasMergeConflict,
      uncommittedChanges: git.uncommitted_changes ?? 0,
      modifiedFiles: git.modified_files ?? [],
      stagedFiles: git.staged_files ?? [],
      untrackedFiles: git.untracked_files ?? [],
      stagedRecordChanges: (git.staged_record_changes ?? []).map((c) => ({
        recordId: c.record_id,
        changeType: c.change_type,
      })),
      lastCommit: git.last_commit
        ? {
            hash: git.last_commit.hash,
            shortHash: git.last_commit.short_hash,
            message: git.last_commit.message,
            author: git.last_commit.author,
            timestamp: git.last_commit.timestamp,
          }
        : null,
      refreshedAt: (this.deps.now ?? Date.now)(),
    };

    this.snapshots.set(projectId, snapshot);
    this.deps.emit(snapshot);
    return snapshot;
  }
}
