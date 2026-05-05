import * as fs from 'fs';
import * as path from 'path';

export interface RegistryAccount {
  login: string;
  name: string;
  avatarUrl: string;
  token: string;
}

export interface RegistryRepo {
  name: string;
  fullName: string;
  owner: string;
  htmlUrl: string;
  description: string | null;
  isPrivate: boolean;
  updatedAt: string;
  cloneUrl: string;
  isColrev: boolean;
}

export interface RegistryCollaborator {
  login: string;
  name: string | null;
  avatarUrl: string;
  repoFullName: string;
}

export interface RegistryInvitation {
  id: number;
  repoFullName: string;
  repoUrl: string;
  inviterLogin: string;
  inviteeLogin: string;
  inviteeAvatarUrl: string;
  permission: string;
  createdAt: string;
}

export interface RegistryRelease {
  id: number;
  repoFullName: string;
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

export interface RegistryData {
  accounts: RegistryAccount[];
  repos: RegistryRepo[];
  collaborators: RegistryCollaborator[];
  invitations: RegistryInvitation[];
  releases: RegistryRelease[];
}

function emptyRegistry(): RegistryData {
  return {
    accounts: [],
    repos: [],
    collaborators: [],
    invitations: [],
    releases: [],
  };
}

export class FakeGitHubRegistry {
  private data: RegistryData;
  private nextId = 1;

  constructor(private readonly filePath: string) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      this.data = JSON.parse(raw) as RegistryData;
      const maxId = Math.max(
        0,
        ...this.data.invitations.map((i) => i.id),
        ...this.data.releases.map((r) => r.id),
      );
      this.nextId = maxId + 1;
    } else {
      this.data = emptyRegistry();
    }
  }

  read(): RegistryData {
    return structuredClone(this.data);
  }

  modify(fn: (data: RegistryData) => void): void {
    fn(this.data);
    this.flush();
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  addInvitation(owner: string, repo: string, inviteeLogin: string, permission: string): RegistryInvitation {
    const repoFullName = `${owner}/${repo}`;
    const inv: RegistryInvitation = {
      id: this.nextId++,
      repoFullName,
      repoUrl: `https://github.com/${repoFullName}`,
      inviterLogin: owner,
      inviteeLogin,
      inviteeAvatarUrl: '',
      permission,
      createdAt: new Date().toISOString(),
    };
    this.data.invitations.push(inv);
    this.flush();
    return inv;
  }

  acceptInvitation(invitationId: number): void {
    const idx = this.data.invitations.findIndex((i) => i.id === invitationId);
    if (idx === -1) throw new Error(`Invitation ${invitationId} not found`);

    const inv = this.data.invitations[idx];
    this.data.invitations.splice(idx, 1);

    const account = this.data.accounts.find((a) => a.login === inv.inviteeLogin);
    this.data.collaborators.push({
      login: inv.inviteeLogin,
      name: account?.name ?? null,
      avatarUrl: account?.avatarUrl ?? '',
      repoFullName: inv.repoFullName,
    });

    this.flush();
  }

  getCollaborators(owner: string, repo: string): RegistryCollaborator[] {
    const fullName = `${owner}/${repo}`;
    return this.data.collaborators.filter((c) => c.repoFullName === fullName);
  }

  getPendingInvitations(owner: string, repo: string): RegistryInvitation[] {
    const fullName = `${owner}/${repo}`;
    return this.data.invitations.filter((i) => i.repoFullName === fullName);
  }

  getUserInvitations(login: string): RegistryInvitation[] {
    return this.data.invitations.filter((i) => i.inviteeLogin === login);
  }

  createRelease(
    owner: string,
    repo: string,
    params: { tagName: string; name: string; body: string },
  ): RegistryRelease {
    const repoFullName = `${owner}/${repo}`;
    const release: RegistryRelease = {
      id: this.nextId++,
      repoFullName,
      tagName: params.tagName,
      name: params.name,
      body: params.body,
      htmlUrl: `https://github.com/${repoFullName}/releases/tag/${params.tagName}`,
      draft: false,
      prerelease: false,
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      author: owner,
    };
    this.data.releases.push(release);
    this.flush();
    return release;
  }

  getReleases(owner: string, repo: string): RegistryRelease[] {
    const fullName = `${owner}/${repo}`;
    return this.data.releases.filter((r) => r.repoFullName === fullName);
  }

  getReposForUser(login: string): RegistryRepo[] {
    return this.data.repos.filter(
      (r) =>
        r.owner === login ||
        this.data.collaborators.some((c) => c.login === login && c.repoFullName === r.fullName),
    );
  }

  getColrevReposForUser(login: string): RegistryRepo[] {
    return this.getReposForUser(login).filter((r) => r.isColrev);
  }

  getAccountByToken(token: string): RegistryAccount | undefined {
    return this.data.accounts.find((a) => a.token === token);
  }

  createRepo(owner: string, repoName: string, isPrivate: boolean, description?: string): RegistryRepo {
    const repo: RegistryRepo = {
      name: repoName,
      fullName: `${owner}/${repoName}`,
      owner,
      htmlUrl: `https://github.com/${owner}/${repoName}`,
      description: description ?? null,
      isPrivate,
      updatedAt: new Date().toISOString(),
      cloneUrl: `https://github.com/${owner}/${repoName}.git`,
      isColrev: false,
    };
    this.data.repos.push(repo);
    this.flush();
    return repo;
  }

  deleteRepo(owner: string, repo: string): boolean {
    const fullName = `${owner}/${repo}`;
    const idx = this.data.repos.findIndex((r) => r.fullName === fullName);
    if (idx === -1) return false;
    this.data.repos.splice(idx, 1);
    this.data.collaborators = this.data.collaborators.filter((c) => c.repoFullName !== fullName);
    this.data.invitations = this.data.invitations.filter((i) => i.repoFullName !== fullName);
    this.data.releases = this.data.releases.filter((r) => r.repoFullName !== fullName);
    this.flush();
    return true;
  }
}
