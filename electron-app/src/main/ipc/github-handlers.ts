import * as path from 'path';
import type { GitHubClient } from '../github-client';
import type { GitResult } from '../git-manager';
import { gitClone, gitCreateTag, gitPushTags } from '../git-manager';
import { defineHandler, type IpcHandlerSpec } from './registry';

export interface GitHubHandlerDeps {
  gh: GitHubClient;
  getToken(): string | null;
  getActiveLogin(): string | null;
  projectsRootForAccount(login: string): string;
  git: {
    clone(cloneUrl: string, targetPath: string, token: string | null): Promise<GitResult>;
    createTag(projectPath: string, tagName: string, message: string): Promise<GitResult>;
    pushTags(projectPath: string, token: string | null): Promise<GitResult>;
  };
  fs: {
    existsSync(p: string): boolean;
    mkdirSync(p: string, options: { recursive: boolean }): void;
  };
}

export const realGitHubGitOps: GitHubHandlerDeps['git'] = {
  clone: gitClone,
  createTag: gitCreateTag,
  pushTags: gitPushTags,
};

type Failure<E> = { success: false; error: string } & E;

/**
 * Run a GitHub call that needs a token.
 *
 * Every handler used to repeat the same three steps — check the token, run the
 * call, turn a thrown error into a result — each with its own copy of the empty
 * collection the renderer expects on failure. `empty` is spread into every
 * failure result so those shapes stay consistent by construction.
 */
async function withToken<T extends object, E extends object>(
  deps: Pick<GitHubHandlerDeps, 'getToken'>,
  options: { empty: E; failureMessage: string },
  run: (token: string) => Promise<T>,
): Promise<T | Failure<E>> {
  const token = deps.getToken();
  if (!token) {
    return { success: false, error: 'Not authenticated', ...options.empty };
  }
  try {
    return await run(token);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : options.failureMessage,
      ...options.empty,
    };
  }
}

/** `withToken` plus resolving `remoteUrl` to an owner/repo pair. */
async function withRepo<T extends object, E extends object>(
  deps: Pick<GitHubHandlerDeps, 'getToken' | 'gh'>,
  options: { remoteUrl: string; empty: E; failureMessage: string },
  run: (ctx: { token: string; owner: string; repo: string }) => Promise<T>,
): Promise<T | Failure<E>> {
  return withToken(deps, options, async (token) => {
    const parsed = deps.gh.parseOwnerRepo(options.remoteUrl);
    if (!parsed) {
      return { success: false, error: 'Not a GitHub URL', ...options.empty } as Failure<E>;
    }
    return run({ token, owner: parsed.owner, repo: parsed.repo });
  }) as Promise<T | Failure<E>>;
}

/**
 * Every `github:*` IPC handler.
 *
 * The pure-API handlers are lock-free: they only talk to github.com. The three
 * that also drive dugite (create-repo-and-push, clone-repo, create-release)
 * take the git mutex like any other repo access.
 */
export function createGitHubHandlers(deps: GitHubHandlerDeps): IpcHandlerSpec[] {
  const { gh, fs, git } = deps;

  const apiOnly = (
    channel: string,
    fn: (...args: never[]) => Promise<unknown>,
  ): IpcHandlerSpec =>
    defineHandler({
      channel,
      handler: (_event, ...args) => fn(...(args as never[])),
      lockFree: true,
      lockFreeReason: 'HTTP call to the GitHub API only; never opens the local repo',
    });

  const repoTouching = (
    channel: string,
    fn: (...args: never[]) => Promise<unknown>,
  ): IpcHandlerSpec =>
    defineHandler({
      channel,
      handler: (_event, ...args) => fn(...(args as never[])),
    });

  return [
    repoTouching(
      'github:create-repo-and-push',
      (params: { repoName: string; projectPath: string; isPrivate: boolean; description?: string }) =>
        withToken(deps, { empty: {}, failureMessage: 'Failed to create repository' }, (token) =>
          gh.createRepoAndPush({ token, ...params }),
        ),
    ),

    repoTouching('github:clone-repo', async (params: { cloneUrl: string; projectId: string }) => {
      const login = deps.getActiveLogin();
      if (!login) return { success: false, error: 'No active account' };

      const accountRoot = deps.projectsRootForAccount(login);
      if (!fs.existsSync(accountRoot)) {
        fs.mkdirSync(accountRoot, { recursive: true });
      }

      const targetPath = path.join(accountRoot, params.projectId);
      if (fs.existsSync(targetPath)) {
        return { success: false, error: 'Project directory already exists' };
      }
      const result = await git.clone(params.cloneUrl, targetPath, deps.getToken());
      // Return where the clone landed: the renderer must register the project
      // at this path, not re-derive it from a basePath it captured earlier.
      return { ...result, path: targetPath };
    }),

    repoTouching(
      'github:create-release',
      (params: {
        remoteUrl: string;
        tagName: string;
        name: string;
        body: string;
        projectPath: string;
      }) =>
        withRepo(
          deps,
          { remoteUrl: params.remoteUrl, empty: {}, failureMessage: 'Failed to create release' },
          async ({ token, owner, repo }) => {
            const tagResult = await git.createTag(params.projectPath, params.tagName, params.name);
            if (!tagResult.success) return tagResult;

            const pushResult = await git.pushTags(params.projectPath, token);
            if (!pushResult.success) return pushResult;

            return gh.createRelease(token, owner, repo, {
              tagName: params.tagName,
              name: params.name,
              body: params.body,
            });
          },
        ),
    ),

    apiOnly('github:list-colrev-repos', () =>
      withToken(deps, { empty: { repos: [] }, failureMessage: 'Failed to list repos' }, async (token) => ({
        success: true as const,
        repos: await gh.listColrevRepos(token),
      })),
    ),

    apiOnly('github:list-releases', (params: { remoteUrl: string }) =>
      withRepo(
        deps,
        { remoteUrl: params.remoteUrl, empty: { releases: [] }, failureMessage: 'Failed to list releases' },
        async ({ token, owner, repo }) => ({
          success: true as const,
          releases: await gh.listReleases(token, owner, repo),
        }),
      ),
    ),

    apiOnly('github:list-collaborators', (params: { remoteUrl: string }) =>
      withRepo(
        deps,
        {
          remoteUrl: params.remoteUrl,
          empty: { collaborators: [] },
          failureMessage: 'Failed to list collaborators',
        },
        async ({ token, owner, repo }) => ({
          success: true as const,
          collaborators: await gh.listRepoCollaborators(token, owner, repo),
        }),
      ),
    ),

    apiOnly(
      'github:add-collaborator',
      (params: { remoteUrl: string; username: string; permission?: 'pull' | 'push' | 'admin' }) =>
        withRepo(
          deps,
          {
            remoteUrl: params.remoteUrl,
            empty: { invited: false },
            failureMessage: 'Failed to add collaborator',
          },
          ({ token, owner, repo }) =>
            gh.addRepoCollaborator(token, owner, repo, params.username, params.permission ?? 'push'),
        ),
    ),

    apiOnly(
      'github:invite-user-suggestions',
      (params: { remoteUrl: string; query: string; excludeLogins?: string[] }) =>
        withToken(
          deps,
          { empty: { suggestions: [] }, failureMessage: 'Failed to load suggestions' },
          async (token) => {
            // Not parsed into owner/repo: the search endpoint takes the URL.
            if (!params.remoteUrl) {
              return { success: false as const, error: 'Missing remote URL', suggestions: [] };
            }
            return {
              success: true as const,
              suggestions: await gh.getInviteUserSuggestions(
                token,
                params.remoteUrl,
                params.query,
                params.excludeLogins ?? [],
              ),
            };
          },
        ),
    ),

    apiOnly('github:list-pending-invitations', (params: { remoteUrl: string }) =>
      withRepo(
        deps,
        {
          remoteUrl: params.remoteUrl,
          empty: { invitations: [] },
          failureMessage: 'Failed to list pending invitations',
        },
        async ({ token, owner, repo }) => ({
          success: true as const,
          invitations: await gh.listPendingRepoInvitations(token, owner, repo),
        }),
      ),
    ),

    apiOnly('github:list-invitations', () =>
      withToken(
        deps,
        { empty: { invitations: [] }, failureMessage: 'Failed to list invitations' },
        async (token) => ({
          success: true as const,
          invitations: await gh.listRepoInvitations(token),
        }),
      ),
    ),

    apiOnly('github:accept-invitation', (params: { invitationId: number }) =>
      withToken(deps, { empty: {}, failureMessage: 'Failed to accept invitation' }, (token) =>
        gh.acceptRepoInvitation(token, params.invitationId),
      ),
    ),

    apiOnly('github:decline-invitation', (params: { invitationId: number }) =>
      withToken(deps, { empty: {}, failureMessage: 'Failed to decline invitation' }, (token) =>
        gh.declineRepoInvitation(token, params.invitationId),
      ),
    ),

    apiOnly('github:delete-repo', (params: { remoteUrl: string }) =>
      withRepo(
        deps,
        { remoteUrl: params.remoteUrl, empty: {}, failureMessage: 'Failed to delete repository' },
        ({ token, owner, repo }) => gh.deleteRepo(token, owner, repo),
      ),
    ),
  ];
}
