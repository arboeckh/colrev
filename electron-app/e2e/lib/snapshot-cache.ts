import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';

export interface SnapshotCacheOptions {
  cacheDir: string;
  sourceRoots: string[];
}

interface SnapshotMeta {
  hash: string;
  createdAt: string;
}

export class SnapshotCache {
  private readonly cacheDir: string;
  private readonly sourceRoots: string[];

  constructor(options: SnapshotCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.sourceRoots = options.sourceRoots;
  }

  checkpoint(name: string, workspaceRoot: string): void {
    fs.mkdirSync(this.cacheDir, { recursive: true });

    const tarballPath = path.join(this.cacheDir, `${name}.tar.gz`);
    const metaPath = path.join(this.cacheDir, `${name}.meta.json`);

    execFileSync(
      'tar',
      [
        'czf',
        tarballPath,
        '--sort=name',
        '--mtime=2025-01-01 00:00:00',
        '--owner=0',
        '--group=0',
        '--numeric-owner',
        '-C',
        workspaceRoot,
        '.',
      ],
      { stdio: 'pipe' },
    );

    const meta: SnapshotMeta = {
      hash: this.computeHash(),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  load(name: string, targetRoot: string): void {
    const tarballPath = path.join(this.cacheDir, `${name}.tar.gz`);
    const metaPath = path.join(this.cacheDir, `${name}.meta.json`);

    if (!fs.existsSync(tarballPath) || !fs.existsSync(metaPath)) {
      throw new Error(`Snapshot "${name}" not found in ${this.cacheDir}`);
    }

    const meta: SnapshotMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const currentHash = this.computeHash();

    if (meta.hash !== currentHash) {
      throw new Error(
        `Snapshot "${name}" is stale (source hash mismatch). ` +
          `Run: npx playwright test build-fixtures to regenerate snapshots.`,
      );
    }

    fs.mkdirSync(targetRoot, { recursive: true });
    execFileSync('tar', ['xzf', tarballPath, '-C', targetRoot], { stdio: 'pipe' });

    this.rewriteAbsolutePaths(targetRoot);
  }

  // Snapshots tar absolute paths into registry.json (cloneUrl) and into each
  // cloned project's .git/config origin url. After untar at a new targetRoot
  // those paths point at the original workspace and break clone lookup +
  // push/fetch — rewrite any *.git path under bare-remote/ to live under the
  // new root.
  private rewriteAbsolutePaths(targetRoot: string): void {
    const newBareRoot = path.join(targetRoot, 'bare-remote');
    const bareSuffixRe = /[/\\]bare-remote[/\\](.+\.git)$/;

    const remap = (oldUrl: string): string | null => {
      const m = oldUrl.match(bareSuffixRe);
      if (!m) return null;
      const rel = m[1];
      return path.join(newBareRoot, rel);
    };

    const registryPath = path.join(targetRoot, 'registry.json');
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as {
        repos?: { cloneUrl?: string }[];
      };
      let changed = false;
      for (const repo of registry.repos ?? []) {
        if (typeof repo.cloneUrl !== 'string') continue;
        const next = remap(repo.cloneUrl);
        if (next && next !== repo.cloneUrl) {
          repo.cloneUrl = next;
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      }
    }

    const projectsDir = path.join(targetRoot, 'userData', 'projects');
    if (!fs.existsSync(projectsDir)) return;

    for (const login of fs.readdirSync(projectsDir)) {
      const loginDir = path.join(projectsDir, login);
      if (!fs.statSync(loginDir).isDirectory()) continue;
      for (const projectId of fs.readdirSync(loginDir)) {
        const projectDir = path.join(loginDir, projectId);
        const gitDir = path.join(projectDir, '.git');
        if (!fs.existsSync(gitDir)) continue;

        let currentUrl: string;
        try {
          currentUrl = execFileSync(
            'git',
            ['remote', 'get-url', 'origin'],
            { cwd: projectDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim();
        } catch {
          continue; // no origin remote
        }
        const next = remap(currentUrl);
        if (next && next !== currentUrl) {
          execFileSync('git', ['remote', 'set-url', 'origin', next], {
            cwd: projectDir,
            stdio: 'pipe',
          });
        }
      }
    }
  }

  isStale(name: string): boolean {
    const metaPath = path.join(this.cacheDir, `${name}.meta.json`);

    if (!fs.existsSync(metaPath)) {
      return true;
    }

    const meta: SnapshotMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return meta.hash !== this.computeHash();
  }

  private computeHash(): string {
    const hash = crypto.createHash('sha256');

    for (const root of this.sourceRoots) {
      if (!fs.existsSync(root)) continue;
      const stat = fs.statSync(root);
      if (stat.isFile()) {
        hash.update(path.basename(root));
        hash.update(fs.readFileSync(root));
        continue;
      }
      const files = this.collectFiles(root);
      for (const file of files) {
        const relativePath = path.relative(root, file);
        hash.update(relativePath);
        hash.update(fs.readFileSync(file));
      }
    }

    return hash.digest('hex');
  }

  private collectFiles(dir: string): string[] {
    const result: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        result.push(...this.collectFiles(fullPath));
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }

    result.sort();
    return result;
  }
}
