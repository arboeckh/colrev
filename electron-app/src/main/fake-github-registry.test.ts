import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FakeGitHubRegistry, type RegistryData } from './fake-github-registry';

function makeTmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-'));
  return path.join(dir, 'registry.json');
}

describe('FakeGitHubRegistry', () => {
  let registryPath: string;

  beforeEach(() => {
    registryPath = makeTmpFile();
  });

  afterEach(() => {
    const dir = path.dirname(registryPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('schema and initialization', () => {
    it('creates a valid empty registry when file does not exist', () => {
      const reg = new FakeGitHubRegistry(registryPath);
      const data = reg.read();
      expect(data.accounts).toEqual([]);
      expect(data.repos).toEqual([]);
      expect(data.collaborators).toEqual([]);
      expect(data.invitations).toEqual([]);
      expect(data.releases).toEqual([]);
    });

    it('reads a seeded registry file', () => {
      const seed: RegistryData = {
        accounts: [{ login: 'alice', name: 'Alice', avatarUrl: '', token: 'tok-alice' }],
        repos: [
          {
            name: 'my-review',
            fullName: 'alice/my-review',
            owner: 'alice',
            htmlUrl: 'https://github.com/alice/my-review',
            description: null,
            isPrivate: false,
            updatedAt: '2026-01-01T00:00:00Z',
            cloneUrl: 'https://github.com/alice/my-review.git',
            isColrev: true,
          },
        ],
        collaborators: [],
        invitations: [],
        releases: [],
      };
      fs.writeFileSync(registryPath, JSON.stringify(seed));

      const reg = new FakeGitHubRegistry(registryPath);
      const data = reg.read();
      expect(data.accounts).toHaveLength(1);
      expect(data.accounts[0].login).toBe('alice');
      expect(data.repos).toHaveLength(1);
      expect(data.repos[0].fullName).toBe('alice/my-review');
    });

    it('throws on malformed JSON', () => {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, 'not-json{{{');
      expect(() => new FakeGitHubRegistry(registryPath)).toThrow();
    });
  });

  describe('atomic write', () => {
    it('persists modifications to disk', () => {
      const reg = new FakeGitHubRegistry(registryPath);
      reg.modify((data) => {
        data.accounts.push({
          login: 'bob',
          name: 'Bob',
          avatarUrl: '',
          token: 'tok-bob',
        });
      });

      const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      expect(raw.accounts).toHaveLength(1);
      expect(raw.accounts[0].login).toBe('bob');
    });

    it('writes atomically (file exists after modify even if dir was empty)', () => {
      const reg = new FakeGitHubRegistry(registryPath);
      reg.modify((data) => {
        data.repos.push({
          name: 'test',
          fullName: 'alice/test',
          owner: 'alice',
          htmlUrl: '',
          description: null,
          isPrivate: false,
          updatedAt: '',
          cloneUrl: '',
          isColrev: false,
        });
      });
      expect(fs.existsSync(registryPath)).toBe(true);
    });
  });

  describe('invitation lifecycle', () => {
    let reg: FakeGitHubRegistry;

    beforeEach(() => {
      reg = new FakeGitHubRegistry(registryPath);
      reg.modify((data) => {
        data.accounts.push(
          { login: 'alice', name: 'Alice', avatarUrl: '', token: 'tok-alice' },
          { login: 'bob', name: 'Bob', avatarUrl: '', token: 'tok-bob' },
        );
        data.repos.push({
          name: 'review',
          fullName: 'alice/review',
          owner: 'alice',
          htmlUrl: '',
          description: null,
          isPrivate: false,
          updatedAt: '',
          cloneUrl: '',
          isColrev: true,
        });
      });
    });

    it('creates an invitation', () => {
      reg.addInvitation('alice', 'review', 'bob', 'push');
      const data = reg.read();
      expect(data.invitations).toHaveLength(1);
      expect(data.invitations[0].inviteeLogin).toBe('bob');
      expect(data.invitations[0].repoFullName).toBe('alice/review');
      expect(data.invitations[0].permission).toBe('push');
    });

    it('accepts an invitation and adds collaborator', () => {
      reg.addInvitation('alice', 'review', 'bob', 'push');
      const invId = reg.read().invitations[0].id;

      reg.acceptInvitation(invId);

      const data = reg.read();
      expect(data.invitations).toHaveLength(0);
      expect(data.collaborators).toHaveLength(1);
      expect(data.collaborators[0].login).toBe('bob');
      expect(data.collaborators[0].repoFullName).toBe('alice/review');
    });

    it('throws when accepting non-existent invitation', () => {
      expect(() => reg.acceptInvitation(999)).toThrow();
    });
  });

  describe('collaborator lifecycle', () => {
    let reg: FakeGitHubRegistry;

    beforeEach(() => {
      reg = new FakeGitHubRegistry(registryPath);
      reg.modify((data) => {
        data.accounts.push(
          { login: 'alice', name: 'Alice', avatarUrl: '', token: 'tok-alice' },
        );
        data.repos.push({
          name: 'review',
          fullName: 'alice/review',
          owner: 'alice',
          htmlUrl: '',
          description: null,
          isPrivate: false,
          updatedAt: '',
          cloneUrl: '',
          isColrev: true,
        });
      });
    });

    it('lists collaborators for a repo', () => {
      reg.modify((data) => {
        data.collaborators.push({
          login: 'bob',
          name: 'Bob',
          avatarUrl: '',
          repoFullName: 'alice/review',
        });
      });

      const collabs = reg.getCollaborators('alice', 'review');
      expect(collabs).toHaveLength(1);
      expect(collabs[0].login).toBe('bob');
    });

    it('returns empty when no collaborators', () => {
      expect(reg.getCollaborators('alice', 'review')).toEqual([]);
    });
  });

  describe('release creation', () => {
    let reg: FakeGitHubRegistry;

    beforeEach(() => {
      reg = new FakeGitHubRegistry(registryPath);
      reg.modify((data) => {
        data.repos.push({
          name: 'review',
          fullName: 'alice/review',
          owner: 'alice',
          htmlUrl: '',
          description: null,
          isPrivate: false,
          updatedAt: '',
          cloneUrl: '',
          isColrev: true,
        });
      });
    });

    it('creates a release', () => {
      const release = reg.createRelease('alice', 'review', {
        tagName: 'v1.0.0',
        name: 'First release',
        body: 'Notes here',
      });

      expect(release.tagName).toBe('v1.0.0');
      expect(release.name).toBe('First release');
      expect(release.id).toBeGreaterThan(0);

      const data = reg.read();
      expect(data.releases).toHaveLength(1);
    });

    it('lists releases for a repo', () => {
      reg.createRelease('alice', 'review', { tagName: 'v1.0', name: 'R1', body: '' });
      reg.createRelease('alice', 'review', { tagName: 'v2.0', name: 'R2', body: '' });

      const releases = reg.getReleases('alice', 'review');
      expect(releases).toHaveLength(2);
    });
  });
});
