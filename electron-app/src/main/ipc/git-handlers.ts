import * as path from 'path';
import type {
  GitBranchListResult,
  GitCheckoutResult,
  GitDirtyState,
  GitLogResult,
  GitResult,
} from '../git-manager';
import {
  gitAbortMerge,
  gitAddAndCommit,
  gitCheckout,
  gitCreateBranch,
  gitCreateLocalBranch,
  gitDeleteLocalBranch,
  gitFastForwardMain,
  gitFetch,
  gitGetBranchAndUpstream,
  gitGetDirtyState,
  gitHasMergeConflict,
  gitListBranches,
  gitLog,
  gitMerge,
  gitPull,
  gitPush,
  gitPushBranch,
  gitRevListCount,
} from '../git-manager';
import {
  analyzeDivergenceFlow,
  applyMergeFlow,
  type MergeConflictResolution,
  type MergeFlowDeps,
} from '../merge-flow';
import type { GitStateSnapshot } from '../git-state';
import { defineHandler, type IpcHandlerSpec } from './registry';

/**
 * The git-manager surface the handlers use, as an injectable seam. Handler
 * behaviour (argument marshalling, token plumbing, merge-flow wiring) is then
 * testable against a fake without spawning git.
 */
export interface GitOps {
  fetch(projectPath: string, token: string | null): Promise<GitResult>;
  pull(projectPath: string, token: string | null, ffOnly: boolean): Promise<GitResult>;
  fastForwardMain(projectPath: string, token: string | null): Promise<GitResult>;
  push(projectPath: string, token: string | null): Promise<GitResult>;
  pushBranch(projectPath: string, branchName: string, token: string | null): Promise<GitResult>;
  listBranches(projectPath: string): Promise<GitBranchListResult>;
  createBranch(projectPath: string, name: string, baseBranch?: string): Promise<GitResult>;
  createLocalBranch(projectPath: string, name: string, baseRef: string): Promise<GitResult>;
  deleteLocalBranch(projectPath: string, name: string): Promise<GitResult>;
  checkout(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  merge(projectPath: string, source: string, ffOnly: boolean): Promise<GitResult>;
  log(projectPath: string, count?: number): Promise<GitLogResult>;
  dirtyState(projectPath: string): Promise<GitDirtyState>;
  abortMerge(projectPath: string): Promise<GitResult>;
  hasMergeConflict(projectPath: string): Promise<boolean>;
  addAndCommit(projectPath: string, message: string): Promise<GitResult>;
  revListCount(
    projectPath: string,
    from: string,
    to: string,
  ): Promise<{ success: boolean; count: number; error?: string }>;
  getBranchAndUpstream: MergeFlowDeps['getBranchAndUpstream'];
}

/** The real dugite-backed implementation. */
export const realGitOps: GitOps = {
  fetch: gitFetch,
  pull: gitPull,
  fastForwardMain: gitFastForwardMain,
  push: gitPush,
  pushBranch: gitPushBranch,
  listBranches: gitListBranches,
  createBranch: gitCreateBranch,
  createLocalBranch: gitCreateLocalBranch,
  deleteLocalBranch: gitDeleteLocalBranch,
  checkout: gitCheckout,
  merge: gitMerge,
  log: gitLog,
  dirtyState: gitGetDirtyState,
  abortMerge: gitAbortMerge,
  hasMergeConflict: gitHasMergeConflict,
  addAndCommit: gitAddAndCommit,
  revListCount: gitRevListCount,
  getBranchAndUpstream: gitGetBranchAndUpstream,
};

export interface GitHandlerDeps {
  git: GitOps;
  getToken(): string | null;
  /**
   * Rebuild and broadcast the project's git snapshot. Called after every
   * mutating handler, while the mutex is still held, so the renderer's view of
   * branch/ahead/behind/cleanliness can never lag a repo write.
   */
  refreshGitState(projectId: string, projectPath: string): Promise<GitStateSnapshot | null>;
  /** Last snapshot built for this project, if any. Pure cache read. */
  getGitState(projectId: string): GitStateSnapshot | null;
  /**
   * Call a backend RPC directly, bypassing `colrev:call`. The handler already
   * holds the git mutex, so going through `colrev:call` would deadlock.
   */
  callBackend<T>(method: string, params: Record<string, unknown>): Promise<T>;
}

/**
 * Every `git:*` IPC handler.
 *
 * All of them are lock-held: these are reads and writes of mutable repository
 * state, and a read that races a Python-side commit returns a view that never
 * existed. Queue visibility (WP-02) is what makes that acceptable in the UI.
 */
export function createGitHandlers(deps: GitHandlerDeps): IpcHandlerSpec[] {
  const { git, getToken } = deps;

  const mergeFlowDeps = (projectPath: string): MergeFlowDeps => ({
    getBranchAndUpstream: git.getBranchAndUpstream,
    // The RPC layer resolves projects as `<base_path>/<project_id>`.
    callBackend: <T>(method: string, params: Record<string, unknown>) =>
      deps.callBackend<T>(method, { base_path: path.dirname(projectPath), ...params }),
    push: (p: string) => git.push(p, getToken()),
  });

  /** Read-only handler: leaves the snapshot alone. */
  const handler = (
    channel: string,
    fn: (...args: never[]) => Promise<unknown>,
  ): IpcHandlerSpec =>
    defineHandler({
      channel,
      handler: (_event, ...args) => fn(...(args as never[])),
    });

  /**
   * Mutating handler: refreshes the git snapshot afterwards, still under the
   * mutex. The project id is the directory name — the same convention the RPC
   * layer uses to resolve `<base_path>/<project_id>`.
   */
  const mutating = (
    channel: string,
    fn: (...args: never[]) => Promise<unknown>,
  ): IpcHandlerSpec =>
    defineHandler({
      channel,
      handler: async (_event, ...args) => {
        const result = await fn(...(args as never[]));
        const projectPath = args[0];
        if (typeof projectPath === 'string') {
          // Never let a snapshot refresh turn a successful git op into a
          // failure; staleness is reported through the seam instead.
          await deps
            .refreshGitState(path.basename(projectPath), projectPath)
            .catch(() => null);
        }
        return result;
      },
    });

  return [
    mutating('git:fetch', (projectPath: string) => git.fetch(projectPath, getToken())),
    mutating('git:pull', (projectPath: string, ffOnly?: boolean) =>
      git.pull(projectPath, getToken(), ffOnly ?? true),
    ),
    mutating('git:fast-forward-main', (projectPath: string) =>
      git.fastForwardMain(projectPath, getToken()),
    ),
    mutating('git:push', (projectPath: string) => git.push(projectPath, getToken())),
    mutating('git:push-branch', (projectPath: string, branchName: string) =>
      git.pushBranch(projectPath, branchName, getToken()),
    ),
    handler('git:list-branches', (projectPath: string) => git.listBranches(projectPath)),
    mutating('git:create-branch', (projectPath: string, name: string, baseBranch?: string) =>
      git.createBranch(projectPath, name, baseBranch),
    ),
    mutating('git:create-local-branch', (projectPath: string, name: string, baseRef: string) =>
      git.createLocalBranch(projectPath, name, baseRef),
    ),
    mutating('git:delete-local-branch', (projectPath: string, name: string) =>
      git.deleteLocalBranch(projectPath, name),
    ),
    mutating('git:checkout', (projectPath: string, branchName: string) =>
      git.checkout(projectPath, branchName),
    ),
    mutating('git:merge', (projectPath: string, source: string, ffOnly?: boolean) =>
      git.merge(projectPath, source, ffOnly ?? true),
    ),
    handler('git:log', (projectPath: string, count?: number) => git.log(projectPath, count)),
    handler('git:dirty-state', (projectPath: string) => git.dirtyState(projectPath)),
    mutating('git:abort-merge', (projectPath: string) => git.abortMerge(projectPath)),
    handler('git:has-merge-conflict', (projectPath: string) => git.hasMergeConflict(projectPath)),
    mutating('git:add-and-commit', (projectPath: string, message: string) =>
      git.addAndCommit(projectPath, message),
    ),
    handler('git:rev-list-count', (projectPath: string, from: string, to: string) =>
      git.revListCount(projectPath, from, to),
    ),

    // Conflict resolution: the engine RPCs own all merge semantics (see
    // merge-flow.ts); these are the IPC bridges into them.
    handler('git:analyze-divergence', (projectPath: string, projectId: string) =>
      analyzeDivergenceFlow(mergeFlowDeps(projectPath), { projectPath, projectId }),
    ),
    mutating(
      'git:apply-merge',
      (projectPath: string, projectId: string, resolutions: MergeConflictResolution[]) =>
        applyMergeFlow(mergeFlowDeps(projectPath), { projectPath, projectId, resolutions }),
    ),

    // --- The one git snapshot (WP-07 §2) ---
    //
    // The single path that reads `get_git_status`. Everything in the renderer
    // that used to hold its own copy of branch / ahead / behind / cleanliness
    // now subscribes to what this produces.
    defineHandler({
      channel: 'git-state:refresh',
      handler: async (_event, projectId: string, projectPath: string) => {
        try {
          return { success: true, state: await deps.refreshGitState(projectId, projectPath) };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : 'Failed to read git state',
            state: deps.getGitState(projectId),
          };
        }
      },
    }),
    defineHandler({
      channel: 'git-state:get',
      handler: async (_event, projectId: string) => deps.getGitState(projectId),
      lockFree: true,
      lockFreeReason: 'returns the last snapshot from memory; performs no repo access',
    }),
  ];
}
