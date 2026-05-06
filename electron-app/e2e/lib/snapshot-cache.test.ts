import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TestWorkspace } from './test-workspace';
import { SnapshotCache } from './snapshot-cache';

const TEST_ROOT = '/tmp/colrev-e2e';
const CACHE_DIR = '/tmp/colrev-test-fixtures-unit';

function uniqueName(): string {
  return `snap-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('SnapshotCache', () => {
  let cache: SnapshotCache;
  let testName: string;
  let ws: TestWorkspace;

  beforeEach(() => {
    testName = uniqueName();
    ws = new TestWorkspace(testName);
    cache = new SnapshotCache({
      cacheDir: CACHE_DIR,
      sourceRoots: [ws.root],
    });
  });

  afterEach(() => {
    const dir = path.join(TEST_ROOT, testName);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (fs.existsSync(CACHE_DIR)) {
      fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    }
  });

  describe('checkpoint', () => {
    it('creates a tarball in the cache directory', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      expect(fs.existsSync(path.join(CACHE_DIR, 'L1.tar.gz'))).toBe(true);
    });

    it('creates a metadata file alongside the tarball', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      const metaPath = path.join(CACHE_DIR, 'L1.meta.json');
      expect(fs.existsSync(metaPath)).toBe(true);

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(meta).toHaveProperty('hash');
      expect(meta).toHaveProperty('createdAt');
      expect(typeof meta.hash).toBe('string');
      expect(meta.hash.length).toBeGreaterThan(0);
    });

    it('creates the cache directory if it does not exist', () => {
      if (fs.existsSync(CACHE_DIR)) {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
      }

      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      expect(fs.existsSync(CACHE_DIR)).toBe(true);
    });
  });

  describe('load', () => {
    it('restores workspace contents from a checkpoint', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      const loadName = uniqueName();
      const loadRoot = path.join(TEST_ROOT, loadName);
      fs.mkdirSync(loadRoot, { recursive: true });

      cache.load('L1', loadRoot);

      expect(fs.readFileSync(path.join(loadRoot, 'test.txt'), 'utf-8')).toBe('hello');

      fs.rmSync(loadRoot, { recursive: true, force: true });
    });

    it('restores nested directory structures', () => {
      fs.mkdirSync(path.join(ws.root, 'sub', 'deep'), { recursive: true });
      fs.writeFileSync(path.join(ws.root, 'sub', 'deep', 'nested.txt'), 'deep');
      cache.checkpoint('L1', ws.root);

      const loadName = uniqueName();
      const loadRoot = path.join(TEST_ROOT, loadName);
      fs.mkdirSync(loadRoot, { recursive: true });

      cache.load('L1', loadRoot);

      expect(
        fs.readFileSync(path.join(loadRoot, 'sub', 'deep', 'nested.txt'), 'utf-8'),
      ).toBe('deep');

      fs.rmSync(loadRoot, { recursive: true, force: true });
    });

    it('restores git repos that are functional', () => {
      const repoDir = path.join(ws.root, 'repo');
      fs.mkdirSync(repoDir, { recursive: true });
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.local',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.local',
      };
      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['checkout', '-b', 'main'], { cwd: repoDir, stdio: 'pipe', env });
      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'content');
      execFileSync('git', ['add', '-A'], { cwd: repoDir, stdio: 'pipe', env });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'pipe', env });

      cache.checkpoint('L1', ws.root);

      const loadName = uniqueName();
      const loadRoot = path.join(TEST_ROOT, loadName);
      fs.mkdirSync(loadRoot, { recursive: true });

      cache.load('L1', loadRoot);

      const log = execFileSync('git', ['log', '--oneline'], {
        cwd: path.join(loadRoot, 'repo'),
        encoding: 'utf-8',
      }).trim();
      expect(log).toContain('init');

      fs.rmSync(loadRoot, { recursive: true, force: true });
    });

    it('throws if snapshot does not exist', () => {
      expect(() => cache.load('nonexistent', ws.root)).toThrow('Snapshot "nonexistent" not found');
    });
  });

  describe('isStale', () => {
    it('returns false when source files have not changed', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      expect(cache.isStale('L1')).toBe(false);
    });

    it('returns true when a source file is modified', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'modified');

      expect(cache.isStale('L1')).toBe(true);
    });

    it('returns true when a source file is added', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      fs.writeFileSync(path.join(ws.root, 'new.txt'), 'new');

      expect(cache.isStale('L1')).toBe(true);
    });

    it('returns true when a source file is deleted', () => {
      fs.writeFileSync(path.join(ws.root, 'a.txt'), 'a');
      fs.writeFileSync(path.join(ws.root, 'b.txt'), 'b');
      cache.checkpoint('L1', ws.root);

      fs.unlinkSync(path.join(ws.root, 'b.txt'));

      expect(cache.isStale('L1')).toBe(true);
    });

    it('returns true when snapshot does not exist', () => {
      expect(cache.isStale('nonexistent')).toBe(true);
    });
  });

  describe('stale load error message', () => {
    it('includes the regenerate command when load is called on a stale snapshot', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'modified');

      const loadRoot = path.join(TEST_ROOT, uniqueName());
      fs.mkdirSync(loadRoot, { recursive: true });

      try {
        cache.load('L1', loadRoot);
        expect.unreachable('should have thrown');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain('stale');
        expect(msg).toContain('build-fixtures');
      } finally {
        if (fs.existsSync(loadRoot)) {
          fs.rmSync(loadRoot, { recursive: true, force: true });
        }
      }
    });
  });

  describe('determinism', () => {
    it('produces the same hash for identical source content', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);

      const meta1 = JSON.parse(
        fs.readFileSync(path.join(CACHE_DIR, 'L1.meta.json'), 'utf-8'),
      );

      cache.checkpoint('L1', ws.root);

      const meta2 = JSON.parse(
        fs.readFileSync(path.join(CACHE_DIR, 'L1.meta.json'), 'utf-8'),
      );

      expect(meta1.hash).toBe(meta2.hash);
    });

    it('produces different hashes for different source content', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      cache.checkpoint('L1', ws.root);
      const meta1 = JSON.parse(
        fs.readFileSync(path.join(CACHE_DIR, 'L1.meta.json'), 'utf-8'),
      );

      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'world');
      cache.checkpoint('L1', ws.root);
      const meta2 = JSON.parse(
        fs.readFileSync(path.join(CACHE_DIR, 'L1.meta.json'), 'utf-8'),
      );

      expect(meta1.hash).not.toBe(meta2.hash);
    });
  });

  describe('multiple source roots', () => {
    it('hashes across all configured source roots', () => {
      const extraRoot = path.join(TEST_ROOT, uniqueName());
      fs.mkdirSync(extraRoot, { recursive: true });
      fs.writeFileSync(path.join(extraRoot, 'extra.txt'), 'extra');

      const multiCache = new SnapshotCache({
        cacheDir: CACHE_DIR,
        sourceRoots: [ws.root, extraRoot],
      });

      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      multiCache.checkpoint('L1', ws.root);

      expect(multiCache.isStale('L1')).toBe(false);

      fs.writeFileSync(path.join(extraRoot, 'extra.txt'), 'changed');
      expect(multiCache.isStale('L1')).toBe(true);

      fs.rmSync(extraRoot, { recursive: true, force: true });
    });

    it('accepts a file path as a source root and hashes its bytes', () => {
      const extraFile = path.join(TEST_ROOT, `${uniqueName()}.ts`);
      fs.writeFileSync(extraFile, 'export const x = 1;');

      const fileCache = new SnapshotCache({
        cacheDir: CACHE_DIR,
        sourceRoots: [ws.root, extraFile],
      });

      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');
      fileCache.checkpoint('L1', ws.root);

      expect(fileCache.isStale('L1')).toBe(false);

      fs.writeFileSync(extraFile, 'export const x = 2;');
      expect(fileCache.isStale('L1')).toBe(true);

      fs.unlinkSync(extraFile);
    });
  });

  describe('load rewrites stale absolute paths', () => {
    function gitEnv(): NodeJS.ProcessEnv {
      return {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.local',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.local',
      };
    }

    it('rewrites registry cloneUrl and project origin to the new workspace root', () => {
      const env = gitEnv();
      const owner = 'alice';
      const repoName = 'lit-review';

      const barePath = ws.createBareRemote(owner, repoName);
      execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], {
        cwd: barePath,
        stdio: 'pipe',
      });

      const projectDir = path.join(ws.userDataDir, 'projects', owner, repoName);
      fs.mkdirSync(projectDir, { recursive: true });
      execFileSync('git', ['init'], { cwd: projectDir, stdio: 'pipe' });
      execFileSync('git', ['checkout', '-b', 'main'], { cwd: projectDir, stdio: 'pipe', env });
      fs.writeFileSync(path.join(projectDir, 'README.md'), 'hi');
      execFileSync('git', ['add', '-A'], { cwd: projectDir, stdio: 'pipe', env });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: projectDir, stdio: 'pipe', env });
      execFileSync('git', ['remote', 'add', 'origin', barePath], {
        cwd: projectDir,
        stdio: 'pipe',
      });
      execFileSync('git', ['push', '-u', 'origin', 'main'], {
        cwd: projectDir,
        stdio: 'pipe',
        env,
      });

      fs.writeFileSync(
        ws.registryPath,
        JSON.stringify({
          accounts: [],
          repos: [
            {
              name: repoName,
              fullName: `${owner}/${repoName}`,
              owner,
              htmlUrl: '',
              description: null,
              isPrivate: false,
              updatedAt: '2025-01-01T00:00:00+00:00',
              cloneUrl: barePath,
              isColrev: true,
            },
          ],
          collaborators: [],
          invitations: [],
          releases: [],
        }),
      );

      cache.checkpoint('L1', ws.root);

      const loadName = uniqueName();
      const loadRoot = path.join(TEST_ROOT, loadName);
      fs.mkdirSync(loadRoot, { recursive: true });

      cache.load('L1', loadRoot);

      const newBarePath = path.join(loadRoot, 'bare-remote', owner, `${repoName}.git`);
      const registry = JSON.parse(
        fs.readFileSync(path.join(loadRoot, 'registry.json'), 'utf-8'),
      ) as { repos: { cloneUrl: string }[] };
      expect(registry.repos[0].cloneUrl).toBe(newBarePath);

      const newProjectDir = path.join(loadRoot, 'userData', 'projects', owner, repoName);
      const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: newProjectDir,
        encoding: 'utf-8',
      }).trim();
      expect(remoteUrl).toBe(newBarePath);

      // The rewritten remote must be functional from the new location.
      execFileSync('git', ['fetch', 'origin'], {
        cwd: newProjectDir,
        stdio: 'pipe',
      });

      fs.rmSync(loadRoot, { recursive: true, force: true });
    });
  });

  describe('byte-identical tarballs', () => {
    it('produces identical tarballs when source is unchanged', () => {
      fs.writeFileSync(path.join(ws.root, 'test.txt'), 'hello');

      cache.checkpoint('L1', ws.root);
      const tarball1 = fs.readFileSync(path.join(CACHE_DIR, 'L1.tar.gz'));

      cache.checkpoint('L1', ws.root);
      const tarball2 = fs.readFileSync(path.join(CACHE_DIR, 'L1.tar.gz'));

      expect(tarball1.equals(tarball2)).toBe(true);
    });
  });
});
