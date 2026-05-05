import type { GitHubClient } from './github-client';
import type {
  GitHubRepo,
  GitHubCollaborator,
  GitHubRelease,
  PendingRepoInvitation,
  RepoInvitation,
} from './github-manager';
import {
  listUserRepos,
  listColrevRepos,
  listReleases,
  createGitHubRelease,
  listRepoCollaborators,
  addRepoCollaborator,
  listPendingRepoInvitations,
  listRepoInvitations,
  acceptRepoInvitation,
  createRepoAndPush,
  deleteGitHubRepo,
  parseOwnerRepo,
} from './github-manager';

export class RealGitHubClient implements GitHubClient {
  async listUserRepos(token: string): Promise<GitHubRepo[]> {
    return listUserRepos(token);
  }

  async listColrevRepos(token: string): Promise<GitHubRepo[]> {
    return listColrevRepos(token);
  }

  async listReleases(token: string, owner: string, repo: string): Promise<GitHubRelease[]> {
    return listReleases(token, owner, repo);
  }

  async createRelease(
    token: string,
    owner: string,
    repo: string,
    params: { tagName: string; name: string; body: string },
  ): Promise<{ success: boolean; release?: GitHubRelease; error?: string }> {
    return createGitHubRelease(token, owner, repo, params);
  }

  async listRepoCollaborators(
    token: string,
    owner: string,
    repo: string,
  ): Promise<GitHubCollaborator[]> {
    return listRepoCollaborators(token, owner, repo);
  }

  async addRepoCollaborator(
    token: string,
    owner: string,
    repo: string,
    username: string,
    permission: 'pull' | 'push' | 'admin' = 'push',
  ): Promise<{ success: boolean; invited: boolean; error?: string }> {
    return addRepoCollaborator(token, owner, repo, username, permission);
  }

  async listPendingRepoInvitations(
    token: string,
    owner: string,
    repo: string,
  ): Promise<PendingRepoInvitation[]> {
    return listPendingRepoInvitations(token, owner, repo);
  }

  async listRepoInvitations(token: string): Promise<RepoInvitation[]> {
    return listRepoInvitations(token);
  }

  async acceptRepoInvitation(
    token: string,
    invitationId: number,
  ): Promise<{ success: boolean; error?: string }> {
    return acceptRepoInvitation(token, invitationId);
  }

  async createRepoAndPush(params: {
    token: string;
    repoName: string;
    projectPath: string;
    isPrivate: boolean;
    description?: string;
  }): Promise<{ success: boolean; repoUrl?: string; htmlUrl?: string; error?: string }> {
    return createRepoAndPush(params);
  }

  async deleteRepo(
    token: string,
    owner: string,
    repo: string,
  ): Promise<{ success: boolean; error?: string }> {
    return deleteGitHubRepo(token, owner, repo);
  }

  parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
    return parseOwnerRepo(remoteUrl);
  }
}
