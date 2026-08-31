/**
 * A protocol-level stand-in for GitHub, used by the e2e suite (WP-08 §2).
 *
 * Scope, deliberately narrow: it implements `GitHubClient` against a JSON
 * registry on disk plus local bare repositories, so collaboration flows
 * (invite, accept, publish, release) can run with no network and no tokens.
 * It is NOT a GitHub simulator — it models only the states the UI branches
 * on.
 *
 * Where its observable behaviour must match the real client — accepted remote
 * URL formats, the invited/already-a-collaborator distinction, returning
 * failures rather than throwing — that is pinned by the shared contract suite
 * in `github-client.contract.test.ts`. Its one sanctioned divergence is
 * `parseOwnerRepo` also accepting a local bare-repo path (see
 * `github-url.parseFakeRemote`). Add behaviour here only alongside a contract
 * test, or the fake starts making e2e green for the wrong reasons.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { GitHubClient } from './github-client';
import { parseFakeRemote } from './github-url';
import type {
  GitHubRepo,
  GitHubCollaborator,
  GitHubRelease,
  PendingRepoInvitation,
  RepoInvitation,
} from './github-manager';
import type { FakeGitHubRegistry, RegistryRelease, RegistryRepo } from './fake-github-registry';

export class FakeGitHubClient implements GitHubClient {
  constructor(
    private readonly registry: FakeGitHubRegistry,
    private readonly bareRemoteDir?: string,
  ) {}

  async listUserRepos(token: string): Promise<GitHubRepo[]> {
    const account = this.registry.getAccountByToken(token);
    if (!account) return [];
    return this.registry.getReposForUser(account.login).map(toGitHubRepo);
  }

  async listColrevRepos(token: string): Promise<GitHubRepo[]> {
    const account = this.registry.getAccountByToken(token);
    if (!account) return [];
    return this.registry.getColrevReposForUser(account.login).map(toGitHubRepo);
  }

  async listReleases(token: string, owner: string, repo: string): Promise<GitHubRelease[]> {
    return this.registry.getReleases(owner, repo).map(toGitHubRelease);
  }

  async createRelease(
    token: string,
    owner: string,
    repo: string,
    params: { tagName: string; name: string; body: string },
  ): Promise<{ success: boolean; release?: GitHubRelease; error?: string }> {
    const r = this.registry.createRelease(owner, repo, params);
    return { success: true, release: toGitHubRelease(r) };
  }

  async listRepoCollaborators(
    token: string,
    owner: string,
    repo: string,
  ): Promise<GitHubCollaborator[]> {
    // GitHub's /repos/{owner}/{repo}/collaborators includes the owner;
    // mirror that here so reviewer pickers can select them.
    const explicit = this.registry.getCollaborators(owner, repo).map((c) => ({
      login: c.login,
      name: c.name,
      avatarUrl: c.avatarUrl,
    }));
    if (explicit.some((c) => c.login === owner)) return explicit;
    const ownerAccount = this.registry.getAccountByLogin(owner);
    if (!ownerAccount) return explicit;
    return [
      {
        login: ownerAccount.login,
        name: ownerAccount.name,
        avatarUrl: ownerAccount.avatarUrl,
      },
      ...explicit,
    ];
  }

  async addRepoCollaborator(
    token: string,
    owner: string,
    repo: string,
    username: string,
    permission: 'pull' | 'push' | 'admin' = 'push',
  ): Promise<{ success: boolean; invited: boolean; error?: string }> {
    // GitHub answers 204 (`invited: false`) when the user is already a
    // collaborator and 201 (`invited: true`) when an invitation was created.
    // The caller renders "Invited" vs "Added" off this, so the fake has to
    // make the same distinction (see github-client.contract.ts).
    const existing = this.registry
      .getCollaborators(owner, repo)
      .some((c) => c.login.toLowerCase() === username.toLowerCase());
    if (existing) return { success: true, invited: false };

    const pending = this.registry
      .getPendingInvitations(owner, repo)
      .some((i) => i.inviteeLogin.toLowerCase() === username.toLowerCase());
    if (!pending) {
      this.registry.addInvitation(owner, repo, username, permission);
    }
    return { success: true, invited: true };
  }

  async getInviteUserSuggestions(
    token: string,
    remoteUrl: string,
    query: string,
    excludeLogins: string[],
  ): Promise<GitHubCollaborator[]> {
    const parsed = this.parseOwnerRepo(remoteUrl);
    if (!parsed) return [];

    const exclude = new Set(excludeLogins.map((login) => login.toLowerCase()));
    const currentFullName = `${parsed.owner}/${parsed.repo}`;
    const trimmed = query.trim();
    const data = this.registry.read();

    if (trimmed.length >= 2) {
      const q = trimmed.toLowerCase();
      return data.accounts
        .filter(
          (account) =>
            account.login.toLowerCase().includes(q) &&
            !exclude.has(account.login.toLowerCase()),
        )
        .map((account) => ({
          login: account.login,
          name: account.name,
          avatarUrl: account.avatarUrl,
        }));
    }

    const suggestions = new Map<string, GitHubCollaborator>();
    for (const collaborator of data.collaborators) {
      if (collaborator.repoFullName === currentFullName) continue;
      const key = collaborator.login.toLowerCase();
      if (exclude.has(key) || suggestions.has(key)) continue;
      const account = this.registry.getAccountByLogin(collaborator.login);
      suggestions.set(key, {
        login: collaborator.login,
        name: collaborator.name ?? account?.name ?? null,
        avatarUrl: collaborator.avatarUrl || account?.avatarUrl || '',
      });
    }

    return Array.from(suggestions.values()).slice(0, 15);
  }

  async listPendingRepoInvitations(
    token: string,
    owner: string,
    repo: string,
  ): Promise<PendingRepoInvitation[]> {
    return this.registry.getPendingInvitations(owner, repo).map((inv) => ({
      id: inv.id,
      inviteeLogin: inv.inviteeLogin,
      inviteeAvatarUrl: inv.inviteeAvatarUrl,
      permission: inv.permission,
      createdAt: inv.createdAt,
    }));
  }

  async listRepoInvitations(token: string): Promise<RepoInvitation[]> {
    const account = this.registry.getAccountByToken(token);
    if (!account) return [];
    return this.registry.getUserInvitations(account.login).map((inv) => ({
      id: inv.id,
      repoFullName: inv.repoFullName,
      repoUrl: inv.repoUrl,
      inviter: inv.inviterLogin,
      inviterAvatarUrl: '',
      permission: inv.permission,
      createdAt: inv.createdAt,
    }));
  }

  async acceptRepoInvitation(
    token: string,
    invitationId: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.registry.acceptInvitation(invitationId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async declineRepoInvitation(
    token: string,
    invitationId: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.registry.declineInvitation(invitationId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async createRepoAndPush(params: {
    token: string;
    repoName: string;
    projectPath: string;
    isPrivate: boolean;
    description?: string;
  }): Promise<{ success: boolean; repoUrl?: string; htmlUrl?: string; error?: string }> {
    const account = this.registry.getAccountByToken(params.token);
    if (!account) return { success: false, error: 'Invalid token' };

    let cloneUrl: string | undefined;

    if (this.bareRemoteDir) {
      try {
        cloneUrl = this.initBareRemoteAndPush(account.login, params.repoName, params.projectPath);
      } catch (err) {
        // The real client returns push failures as a result, never throws
        // (see github-manager.createRepoAndPush). Match that, or the UI's
        // publish flow behaves differently under test than in production.
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to publish repository',
        };
      }
    }

    const repo = this.registry.createRepo(
      account.login,
      params.repoName,
      params.isPrivate,
      params.description,
      cloneUrl,
    );

    return {
      success: true,
      repoUrl: repo.cloneUrl,
      htmlUrl: repo.htmlUrl,
    };
  }

  /** Create the bare stand-in remote and push the project's current branch. */
  private initBareRemoteAndPush(login: string, repoName: string, projectPath: string): string {
    const barePath = path.join(this.bareRemoteDir!, login, `${repoName}.git`);
    fs.mkdirSync(barePath, { recursive: true });
    execFileSync('git', ['init', '--bare'], { cwd: barePath, stdio: 'pipe' });

    const remotes = execFileSync('git', ['remote'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    if (remotes.includes('origin')) {
      execFileSync('git', ['remote', 'set-url', 'origin', barePath], {
        cwd: projectPath,
        stdio: 'pipe',
      });
    } else {
      execFileSync('git', ['remote', 'add', 'origin', barePath], {
        cwd: projectPath,
        stdio: 'pipe',
      });
    }

    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    execFileSync('git', ['push', '--no-verify', '-u', 'origin', branch], {
      cwd: projectPath,
      stdio: 'pipe',
    });

    return barePath;
  }

  async deleteRepo(
    token: string,
    owner: string,
    repo: string,
  ): Promise<{ success: boolean; error?: string }> {
    const deleted = this.registry.deleteRepo(owner, repo);
    if (!deleted) return { success: false, error: 'Repository not found' };
    return { success: true };
  }

  /**
   * The shared parser, plus the fake's one documented extension: its remotes
   * are local bare repositories, not github.com URLs. See `github-url.ts`.
   */
  parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
    return parseFakeRemote(remoteUrl);
  }
}

function toGitHubRepo(r: RegistryRepo): GitHubRepo {
  const { isColrev: _, ...repo } = r;
  return repo;
}

function toGitHubRelease(r: RegistryRelease): GitHubRelease {
  const { repoFullName: _, ...release } = r;
  return release;
}
