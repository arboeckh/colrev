import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { GitHubClient } from './github-client';
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
    return this.registry.getCollaborators(owner, repo).map((c) => ({
      login: c.login,
      name: c.name,
      avatarUrl: c.avatarUrl,
    }));
  }

  async addRepoCollaborator(
    token: string,
    owner: string,
    repo: string,
    username: string,
    permission: 'pull' | 'push' | 'admin' = 'push',
  ): Promise<{ success: boolean; invited: boolean; error?: string }> {
    this.registry.addInvitation(owner, repo, username, permission);
    return { success: true, invited: true };
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
      const barePath = path.join(this.bareRemoteDir, account.login, `${params.repoName}.git`);
      fs.mkdirSync(barePath, { recursive: true });
      execFileSync('git', ['init', '--bare'], { cwd: barePath, stdio: 'pipe' });

      const remotes = execFileSync('git', ['remote'], { cwd: params.projectPath, encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean);

      if (remotes.includes('origin')) {
        execFileSync('git', ['remote', 'set-url', 'origin', barePath], { cwd: params.projectPath, stdio: 'pipe' });
      } else {
        execFileSync('git', ['remote', 'add', 'origin', barePath], { cwd: params.projectPath, stdio: 'pipe' });
      }

      const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: params.projectPath,
        encoding: 'utf-8',
      }).trim();

      execFileSync('git', ['push', '--no-verify', '-u', 'origin', branch], {
        cwd: params.projectPath,
        stdio: 'pipe',
      });

      cloneUrl = barePath;
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

  async deleteRepo(
    token: string,
    owner: string,
    repo: string,
  ): Promise<{ success: boolean; error?: string }> {
    const deleted = this.registry.deleteRepo(owner, repo);
    if (!deleted) return { success: false, error: 'Repository not found' };
    return { success: true };
  }

  parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
    const httpsMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }
    if (remoteUrl.startsWith('/')) {
      const filePathMatch = remoteUrl.match(/\/([^/]+)\/([^/]+?)\.git$/);
      if (filePathMatch) {
        return { owner: filePathMatch[1], repo: filePathMatch[2] };
      }
    }
    return null;
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
