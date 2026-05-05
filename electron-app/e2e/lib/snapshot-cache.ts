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
