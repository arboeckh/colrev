import type {
  GitHubRepo,
  GitHubCollaborator,
  GitHubRelease,
  PendingRepoInvitation,
  RepoInvitation,
} from './github-manager';

export interface GitHubClient {
  listUserRepos(token: string): Promise<GitHubRepo[]>;

  listColrevRepos(token: string): Promise<GitHubRepo[]>;

  listReleases(token: string, owner: string, repo: string): Promise<GitHubRelease[]>;

  createRelease(
    token: string,
    owner: string,
    repo: string,
    params: { tagName: string; name: string; body: string },
  ): Promise<{ success: boolean; release?: GitHubRelease; error?: string }>;

  listRepoCollaborators(
    token: string,
    owner: string,
    repo: string,
  ): Promise<GitHubCollaborator[]>;

  addRepoCollaborator(
    token: string,
    owner: string,
    repo: string,
    username: string,
    permission?: 'pull' | 'push' | 'admin',
  ): Promise<{ success: boolean; invited: boolean; error?: string }>;

  listPendingRepoInvitations(
    token: string,
    owner: string,
    repo: string,
  ): Promise<PendingRepoInvitation[]>;

  listRepoInvitations(token: string): Promise<RepoInvitation[]>;

  acceptRepoInvitation(
    token: string,
    invitationId: number,
  ): Promise<{ success: boolean; error?: string }>;

  createRepoAndPush(params: {
    token: string;
    repoName: string;
    projectPath: string;
    isPrivate: boolean;
    description?: string;
  }): Promise<{ success: boolean; repoUrl?: string; htmlUrl?: string; error?: string }>;

  deleteRepo(
    token: string,
    owner: string,
    repo: string,
  ): Promise<{ success: boolean; error?: string }>;

  parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null;
}
