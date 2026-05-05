import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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
});
