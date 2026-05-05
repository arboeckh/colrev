import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { FakeGitHubRegistry, type RegistryData } from './fake-github-registry';
import { FakeGitHubClient } from './fake-github-client';
import type { GitHubClient } from './github-client';

function seedRegistry(registryPath: string): void {
  const seed: RegistryData = {
    accounts: [
      { login: 'alice', name: 'Alice Smith', avatarUrl: 'https://avatar/alice', token: 'tok-alice' },
      { login: 'bob', name: 'Bob Jones', avatarUrl: 'https://avatar/bob', token: 'tok-bob' },
    ],
    repos: [
      {
        name: 'lit-review',
        fullName: 'alice/lit-review',
        owner: 'alice',
        htmlUrl: 'https://github.com/alice/lit-review',
        description: 'A CoLRev review',
        isPrivate: false,
        updatedAt: '2026-01-01T00:00:00Z',
        cloneUrl: 'https://github.com/alice/lit-review.git',
        isColrev: true,
      },
      {
        name: 'other-repo',
        fullName: 'alice/other-repo',
        owner: 'alice',
        htmlUrl: 'https://github.com/alice/other-repo',
        description: 'Not colrev',
        isPrivate: true,
        updatedAt: '2026-01-02T00:00:00Z',
        cloneUrl: 'https://github.com/alice/other-repo.git',
        isColrev: false,
      },
    ],
    collaborators: [],
    invitations: [],
    releases: [],
  };
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(seed));
}

describe('FakeGitHubClient', () => {
  let registryPath: string;
  let client: GitHubClient;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-client-'));
    registryPath = path.join(dir, 'registry.json');
    seedRegistry(registryPath);
    const registry = new FakeGitHubRegistry(registryPath);
    client = new FakeGitHubClient(registry);
  });

  afterEach(() => {
    const dir = path.dirname(registryPath);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('listUserRepos', () => {
    it('returns repos the token owner owns or collaborates on', async () => {
      const repos = await client.listUserRepos('tok-alice');
      expect(repos).toHaveLength(2);
      expect(repos.map((r) => r.name)).toContain('lit-review');
      expect(repos.map((r) => r.name)).toContain('other-repo');
    });

    it('returns empty for unknown token', async () => {
      const repos = await client.listUserRepos('tok-unknown');
      expect(repos).toEqual([]);
    });
  });

  describe('listColrevRepos', () => {
    it('returns only colrev repos', async () => {
      const repos = await client.listColrevRepos('tok-alice');
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe('lit-review');
    });
  });

  describe('listReleases', () => {
    it('returns empty when no releases exist', async () => {
      const releases = await client.listReleases('tok-alice', 'alice', 'lit-review');
      expect(releases).toEqual([]);
    });
  });

  describe('createRelease', () => {
    it('creates and returns a release', async () => {
      const result = await client.createRelease('tok-alice', 'alice', 'lit-review', {
        tagName: 'v1.0.0',
        name: 'First Release',
        body: 'Release notes',
      });
      expect(result.success).toBe(true);
      expect(result.release).toBeDefined();
      expect(result.release!.tagName).toBe('v1.0.0');

      const releases = await client.listReleases('tok-alice', 'alice', 'lit-review');
      expect(releases).toHaveLength(1);
    });
  });

  describe('collaborator management', () => {
    it('addRepoCollaborator creates an invitation', async () => {
      const result = await client.addRepoCollaborator('tok-alice', 'alice', 'lit-review', 'bob', 'push');
      expect(result.success).toBe(true);
      expect(result.invited).toBe(true);

      const pending = await client.listPendingRepoInvitations('tok-alice', 'alice', 'lit-review');
      expect(pending).toHaveLength(1);
      expect(pending[0].inviteeLogin).toBe('bob');
    });

    it('listRepoCollaborators returns collaborators', async () => {
      const collabs = await client.listRepoCollaborators('tok-alice', 'alice', 'lit-review');
      expect(collabs).toEqual([]);
    });
  });

  describe('invitation lifecycle', () => {
    it('listRepoInvitations returns user invitations', async () => {
      await client.addRepoCollaborator('tok-alice', 'alice', 'lit-review', 'bob', 'push');

      const invs = await client.listRepoInvitations('tok-bob');
      expect(invs).toHaveLength(1);
      expect(invs[0].repoFullName).toBe('alice/lit-review');
    });

    it('acceptRepoInvitation accepts and promotes to collaborator', async () => {
      await client.addRepoCollaborator('tok-alice', 'alice', 'lit-review', 'bob', 'push');
      const invs = await client.listRepoInvitations('tok-bob');
      const result = await client.acceptRepoInvitation('tok-bob', invs[0].id);
      expect(result.success).toBe(true);

      const collabs = await client.listRepoCollaborators('tok-alice', 'alice', 'lit-review');
      expect(collabs).toHaveLength(1);
      expect(collabs[0].login).toBe('bob');

      const remaining = await client.listRepoInvitations('tok-bob');
      expect(remaining).toHaveLength(0);
    });
  });

  describe('deleteRepo', () => {
    it('removes a repo', async () => {
      const result = await client.deleteRepo('tok-alice', 'alice', 'lit-review');
      expect(result.success).toBe(true);

      const repos = await client.listUserRepos('tok-alice');
      expect(repos.map((r) => r.name)).not.toContain('lit-review');
    });
  });

  describe('parseOwnerRepo', () => {
    it('parses HTTPS URLs', () => {
      const result = client.parseOwnerRepo('https://github.com/alice/lit-review.git');
      expect(result).toEqual({ owner: 'alice', repo: 'lit-review' });
    });

    it('returns null for non-GitHub URLs', () => {
      expect(client.parseOwnerRepo('https://gitlab.com/x/y.git')).toBeNull();
    });
  });

  describe('createRepoAndPush', () => {
    it('creates a repo in the registry (skips git push)', async () => {
      const result = await client.createRepoAndPush({
        token: 'tok-alice',
        repoName: 'new-review',
        projectPath: '/tmp/fake-project',
        isPrivate: true,
        description: 'A new review',
      });
      expect(result.success).toBe(true);
      expect(result.htmlUrl).toContain('alice/new-review');

      const repos = await client.listUserRepos('tok-alice');
      expect(repos.map((r) => r.name)).toContain('new-review');
    });
  });
});

describe('FakeGitHubClient with bare remotes', () => {
  let tmpDir: string;
  let registryPath: string;
  let bareRemoteDir: string;
  let client: FakeGitHubClient;
  let registry: FakeGitHubRegistry;

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Alice',
    GIT_AUTHOR_EMAIL: 'alice@test.local',
    GIT_COMMITTER_NAME: 'Alice',
    GIT_COMMITTER_EMAIL: 'alice@test.local',
  };

  function makeProjectWithCommit(projectPath: string): void {
    fs.mkdirSync(projectPath, { recursive: true });
    execSync('git init', { cwd: projectPath, env: gitEnv, stdio: 'pipe' });
    execSync('git checkout -b main', { cwd: projectPath, env: gitEnv, stdio: 'pipe' });
    fs.writeFileSync(path.join(projectPath, 'README.md'), '# Test Project\n');
    execSync('git add -A', { cwd: projectPath, env: gitEnv, stdio: 'pipe' });
    execSync('git commit -m "initial commit"', { cwd: projectPath, env: gitEnv, stdio: 'pipe' });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-bare-'));
    registryPath = path.join(tmpDir, 'registry.json');
    bareRemoteDir = path.join(tmpDir, 'bare-remote');
    fs.mkdirSync(bareRemoteDir, { recursive: true });

    const seed: RegistryData = {
      accounts: [
        { login: 'alice', name: 'Alice Smith', avatarUrl: '', token: 'tok-alice' },
        { login: 'bob', name: 'Bob Jones', avatarUrl: '', token: 'tok-bob' },
      ],
      repos: [],
      collaborators: [],
      invitations: [],
      releases: [],
    };
    fs.writeFileSync(registryPath, JSON.stringify(seed));

    registry = new FakeGitHubRegistry(registryPath);
    client = new FakeGitHubClient(registry, bareRemoteDir);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createRepoAndPush with real git', () => {
    it('creates a bare remote and pushes the project commits to it', async () => {
      const projectPath = path.join(tmpDir, 'project');
      makeProjectWithCommit(projectPath);

      const result = await client.createRepoAndPush({
        token: 'tok-alice',
        repoName: 'my-review',
        projectPath,
        isPrivate: true,
        description: 'A review',
      });

      expect(result.success).toBe(true);

      const barePath = path.join(bareRemoteDir, 'alice', 'my-review.git');
      expect(fs.existsSync(barePath)).toBe(true);

      const log = execSync('git log --all --oneline', { cwd: barePath }).toString().trim();
      expect(log).toContain('initial commit');
    });

    it('sets the project origin remote to the bare path', async () => {
      const projectPath = path.join(tmpDir, 'project');
      makeProjectWithCommit(projectPath);

      await client.createRepoAndPush({
        token: 'tok-alice',
        repoName: 'my-review',
        projectPath,
        isPrivate: true,
      });

      const remoteUrl = execSync('git remote get-url origin', { cwd: projectPath })
        .toString()
        .trim();
      expect(remoteUrl).toBe(path.join(bareRemoteDir, 'alice', 'my-review.git'));
    });

    it('stores the bare path as cloneUrl in the registry', async () => {
      const projectPath = path.join(tmpDir, 'project');
      makeProjectWithCommit(projectPath);

      await client.createRepoAndPush({
        token: 'tok-alice',
        repoName: 'my-review',
        projectPath,
        isPrivate: true,
      });

      const repos = await client.listUserRepos('tok-alice');
      const repo = repos.find((r) => r.name === 'my-review');
      expect(repo).toBeDefined();
      expect(repo!.cloneUrl).toBe(path.join(bareRemoteDir, 'alice', 'my-review.git'));
    });

    it('returns error for invalid token', async () => {
      const projectPath = path.join(tmpDir, 'project');
      makeProjectWithCommit(projectPath);

      const result = await client.createRepoAndPush({
        token: 'tok-unknown',
        repoName: 'my-review',
        projectPath,
        isPrivate: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('multiple projects per account each get their own bare remote', async () => {
      const project1 = path.join(tmpDir, 'project1');
      const project2 = path.join(tmpDir, 'project2');
      makeProjectWithCommit(project1);
      makeProjectWithCommit(project2);

      await client.createRepoAndPush({
        token: 'tok-alice',
        repoName: 'review-a',
        projectPath: project1,
        isPrivate: true,
      });
      await client.createRepoAndPush({
        token: 'tok-alice',
        repoName: 'review-b',
        projectPath: project2,
        isPrivate: true,
      });

      const bare1 = path.join(bareRemoteDir, 'alice', 'review-a.git');
      const bare2 = path.join(bareRemoteDir, 'alice', 'review-b.git');
      expect(fs.existsSync(bare1)).toBe(true);
      expect(fs.existsSync(bare2)).toBe(true);

      const log1 = execSync('git log --all --oneline', { cwd: bare1 }).toString().trim();
      const log2 = execSync('git log --all --oneline', { cwd: bare2 }).toString().trim();
      expect(log1).toContain('initial commit');
      expect(log2).toContain('initial commit');
    });

    it('subsequent git push from the project lands in the bare remote', async () => {
      const projectPath = path.join(tmpDir, 'project');
      makeProjectWithCommit(projectPath);

      await client.createRepoAndPush({
        token: 'tok-alice',
        repoName: 'my-review',
        projectPath,
        isPrivate: true,
      });

      fs.writeFileSync(path.join(projectPath, 'data.txt'), 'some data\n');
      execSync('git add -A', { cwd: projectPath, env: gitEnv, stdio: 'pipe' });
      execSync('git commit -m "add data"', { cwd: projectPath, env: gitEnv, stdio: 'pipe' });
      execSync('git push origin main', { cwd: projectPath, stdio: 'pipe' });

      const barePath = path.join(bareRemoteDir, 'alice', 'my-review.git');
      const log = execSync('git log --all --oneline', { cwd: barePath }).toString().trim();
      expect(log).toContain('add data');
    });
  });

  describe('parseOwnerRepo with file paths', () => {
    it('parses bare remote file paths', () => {
      const barePath = path.join(bareRemoteDir, 'alice', 'lit-review.git');
      const result = client.parseOwnerRepo(barePath);
      expect(result).toEqual({ owner: 'alice', repo: 'lit-review' });
    });

    it('still parses HTTPS GitHub URLs', () => {
      const result = client.parseOwnerRepo('https://github.com/alice/lit-review.git');
      expect(result).toEqual({ owner: 'alice', repo: 'lit-review' });
    });

    it('returns null for paths without .git suffix', () => {
      expect(client.parseOwnerRepo('/some/random/path')).toBeNull();
    });
  });
});
