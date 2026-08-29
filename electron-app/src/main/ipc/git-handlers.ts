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

  const handler = (
    channel: string,
    fn: (...args: never[]) => Promise<unknown>,
  ): IpcHandlerSpec =>
    defineHandler({
      channel,
      handler: (_event, ...args) => fn(...(args as never[])),
    });

  return [
    handler('git:fetch', (projectPath: string) => git.fetch(projectPath, getToken())),
    handler('git:pull', (projectPath: string, ffOnly?: boolean) =>
      git.pull(projectPath, getToken(), ffOnly ?? true),
    ),
    handler('git:fast-forward-main', (projectPath: string) =>
      git.fastForwardMain(projectPath, getToken()),
    ),
    handler('git:push', (projectPath: string) => git.push(projectPath, getToken())),
    handler('git:push-branch', (projectPath: string, branchName: string) =>
      git.pushBranch(projectPath, branchName, getToken()),
    ),
    handler('git:list-branches', (projectPath: string) => git.listBranches(projectPath)),
    handler('git:create-branch', (projectPath: string, name: string, baseBranch?: string) =>
      git.createBranch(projectPath, name, baseBranch),
    ),
    handler('git:create-local-branch', (projectPath: string, name: string, baseRef: string) =>
      git.createLocalBranch(projectPath, name, baseRef),
    ),
    handler('git:delete-local-branch', (projectPath: string, name: string) =>
      git.deleteLocalBranch(projectPath, name),
    ),
    handler('git:checkout', (projectPath: string, branchName: string) =>
      git.checkout(projectPath, branchName),
    ),
    handler('git:merge', (projectPath: string, source: string, ffOnly?: boolean) =>
      git.merge(projectPath, source, ffOnly ?? true),
    ),
    handler('git:log', (projectPath: string, count?: number) => git.log(projectPath, count)),
    handler('git:dirty-state', (projectPath: string) => git.dirtyState(projectPath)),
    handler('git:abort-merge', (projectPath: string) => git.abortMerge(projectPath)),
    handler('git:has-merge-conflict', (projectPath: string) => git.hasMergeConflict(projectPath)),
    handler('git:add-and-commit', (projectPath: string, message: string) =>
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
    handler(
      'git:apply-merge',
      (projectPath: string, projectId: string, resolutions: MergeConflictResolution[]) =>
        applyMergeFlow(mergeFlowDeps(projectPath), { projectPath, projectId, resolutions }),
    ),
  ];
}
