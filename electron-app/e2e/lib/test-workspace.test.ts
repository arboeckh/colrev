import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { TestWorkspace } from './test-workspace';

const TEST_ROOT = '/tmp/colrev-e2e';

describe('TestWorkspace', () => {
  let ws: TestWorkspace;
  const testName = `unit-test-${Date.now()}`;

  afterEach(() => {
    const dir = path.join(TEST_ROOT, testName);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('directory layout', () => {
    it('creates the expected directory structure', () => {
      ws = new TestWorkspace(testName);

      expect(fs.existsSync(ws.root)).toBe(true);
      expect(fs.existsSync(ws.userDataDir)).toBe(true);
      expect(fs.existsSync(ws.bareRemoteDir)).toBe(true);
    });

    it('root is at /tmp/colrev-e2e/<test-name>/', () => {
      ws = new TestWorkspace(testName);
      expect(ws.root).toBe(path.join(TEST_ROOT, testName));
    });

    it('exposes expected subpaths', () => {
      ws = new TestWorkspace(testName);
      expect(ws.registryPath).toBe(path.join(ws.root, 'registry.json'));
      expect(ws.backendLogPath).toBe(path.join(ws.root, 'backend.log'));
      expect(ws.rendererLogPath).toBe(path.join(ws.root, 'renderer.log'));
      expect(ws.rpcJsonlPath).toBe(path.join(ws.root, 'rpc.jsonl'));
      expect(ws.lastStatePath).toBe(path.join(ws.root, 'last-state.json'));
    });
  });

  describe('log file creation', () => {
    it('creates empty log files on init', () => {
      ws = new TestWorkspace(testName);
      expect(fs.existsSync(ws.backendLogPath)).toBe(true);
      expect(fs.existsSync(ws.rendererLogPath)).toBe(true);
      expect(fs.existsSync(ws.rpcJsonlPath)).toBe(true);
      expect(fs.readFileSync(ws.backendLogPath, 'utf-8')).toBe('');
    });
  });

  describe('last-state.json emission', () => {
    it('writeLastState writes the state file', () => {
      ws = new TestWorkspace(testName);
      ws.writeLastState({
        activeAccount: 'alice',
        registryPath: ws.registryPath,
        bareRemotePath: ws.bareRemoteDir,
        lastRpc: { method: 'list_projects', id: 1 },
      });

      const state = JSON.parse(fs.readFileSync(ws.lastStatePath, 'utf-8'));
      expect(state.activeAccount).toBe('alice');
      expect(state.registryPath).toBe(ws.registryPath);
      expect(state.lastRpc.method).toBe('list_projects');
    });
  });

  describe('start-of-run wipe semantics', () => {
    it('wipes previous run contents on construction', () => {
      const dir = path.join(TEST_ROOT, testName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'leftover.txt'), 'stale data');

      ws = new TestWorkspace(testName);

      expect(fs.existsSync(path.join(dir, 'leftover.txt'))).toBe(false);
      expect(fs.existsSync(ws.root)).toBe(true);
    });
  });

  describe('seedRegistry', () => {
    it('writes a registry.json file', () => {
      ws = new TestWorkspace(testName);
      ws.seedRegistry({
        accounts: [{ login: 'alice', name: 'Alice', avatarUrl: '', token: 'tok-alice' }],
        repos: [],
        collaborators: [],
        invitations: [],
        releases: [],
      });

      expect(fs.existsSync(ws.registryPath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
      expect(data.accounts[0].login).toBe('alice');
    });
  });

  describe('bare remote lifecycle', () => {
    it('createBareRemote creates a bare git repo at <bareRemoteDir>/<owner>/<repo>.git', () => {
      ws = new TestWorkspace(testName);
      const barePath = ws.createBareRemote('alice', 'lit-review');

      expect(barePath).toBe(path.join(ws.bareRemoteDir, 'alice', 'lit-review.git'));
      expect(fs.existsSync(barePath)).toBe(true);

      const isBare = execSync('git rev-parse --is-bare-repository', { cwd: barePath })
        .toString()
        .trim();
      expect(isBare).toBe('true');
    });

    it('multiple projects per account get their own bare remote', () => {
      ws = new TestWorkspace(testName);
      const bare1 = ws.createBareRemote('alice', 'review-a');
      const bare2 = ws.createBareRemote('alice', 'review-b');

      expect(bare1).not.toBe(bare2);
      expect(fs.existsSync(bare1)).toBe(true);
      expect(fs.existsSync(bare2)).toBe(true);
    });

    it('different accounts get separate bare remote directories', () => {
      ws = new TestWorkspace(testName);
      const bareAlice = ws.createBareRemote('alice', 'review');
      const bareBob = ws.createBareRemote('bob', 'review');

      expect(bareAlice).toContain('/alice/');
      expect(bareBob).toContain('/bob/');
      expect(bareAlice).not.toBe(bareBob);
    });

    it('bareRemotePath returns the expected path without creating anything', () => {
      ws = new TestWorkspace(testName);
      const expected = path.join(ws.bareRemoteDir, 'alice', 'my-repo.git');
      expect(ws.bareRemotePath('alice', 'my-repo')).toBe(expected);
      expect(fs.existsSync(expected)).toBe(false);
    });

    it('listBareRemotes returns created bare remotes', () => {
      ws = new TestWorkspace(testName);
      ws.createBareRemote('alice', 'review-a');
      ws.createBareRemote('bob', 'review-b');

      const remotes = ws.listBareRemotes();
      expect(remotes).toHaveLength(2);
      expect(remotes).toContainEqual({ owner: 'alice', repo: 'review-a' });
      expect(remotes).toContainEqual({ owner: 'bob', repo: 'review-b' });
    });

    it('listBareRemotes returns empty when no bare remotes exist', () => {
      ws = new TestWorkspace(testName);
      expect(ws.listBareRemotes()).toEqual([]);
    });

    it('bare remotes are inspectable with plain git commands', () => {
      ws = new TestWorkspace(testName);
      const barePath = ws.createBareRemote('alice', 'review');

      const tmpClone = path.join(ws.root, 'tmp-clone');
      execSync(`git clone ${barePath} ${tmpClone}`);

      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.local',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.local',
      };
      execSync('git checkout -b main', { cwd: tmpClone, env: gitEnv, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "test commit"', { cwd: tmpClone, env: gitEnv });
      execSync('git push origin main', { cwd: tmpClone });

      const log = execSync('git log --all --oneline', { cwd: barePath }).toString().trim();
      expect(log).toContain('test commit');
    });
  });
});
