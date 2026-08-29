import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';

// Prefer GNU tar (gtar on macOS via homebrew) for reproducible flag support;
// fall back to whatever `tar` is on PATH. On BSD tar the determinism flags are
// skipped: archive member order follows directory order, which is stable for an
// unchanged tree, and cache validity is keyed off computeHash() over source
// files rather than tarball bytes.
let tarResolution: { bin: string; gnu: boolean } | null = null;
function resolveTar(): { bin: string; gnu: boolean } {
  if (tarResolution) return tarResolution;
  const gtar = spawnSync('gtar', ['--version'], { stdio: 'ignore' });
  if (gtar.status === 0) {
    tarResolution = { bin: 'gtar', gnu: true };
    return tarResolution;
  }
  const tarVersion = spawnSync('tar', ['--version'], { encoding: 'utf-8' });
  const isGnu = tarVersion.status === 0 && /GNU tar/.test(tarVersion.stdout);
  tarResolution = { bin: 'tar', gnu: isGnu };
  return tarResolution;
}

// `tar czf` delegates compression to gzip, and Apple/BSD gzip stamps the
// current time into the gzip header when it reads from a pipe — so two
// checkpoints of identical input taken either side of a second boundary differ
// in bytes 4..7. Compressing as a separate `gzip -n` step (which omits both the
// name and the timestamp) keeps the tarball byte-identical for unchanged input.
let gzipAvailable: boolean | null = null;
function hasGzip(): boolean {
  if (gzipAvailable === null) {
    gzipAvailable = spawnSync('gzip', ['--version'], { stdio: 'ignore' }).status === 0;
  }
  return gzipAvailable;
}

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

    const { bin, gnu } = resolveTar();
    const deterministicFlags = gnu
      ? [
          '--sort=name',
          '--mtime=2025-01-01 00:00:00',
          '--owner=0',
          '--group=0',
          '--numeric-owner',
        ]
      : [];

    if (hasGzip()) {
      // `gzip -n <name>.tar` writes exactly `<name>.tar.gz` and removes the
      // uncompressed input, so the two steps land on tarballPath.
      const uncompressedPath = path.join(this.cacheDir, `${name}.tar`);
      try {
        execFileSync(
          bin,
          ['cf', uncompressedPath, ...deterministicFlags, '-C', workspaceRoot, '.'],
          { stdio: 'pipe' },
        );
        execFileSync('gzip', ['-n', '-f', uncompressedPath], { stdio: 'pipe' });
      } finally {
        fs.rmSync(uncompressedPath, { force: true });
      }
    } else {
      execFileSync(
        bin,
        ['czf', tarballPath, ...deterministicFlags, '-C', workspaceRoot, '.'],
        { stdio: 'pipe' },
      );
    }

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
    const { bin } = resolveTar();
    execFileSync(bin, ['xzf', tarballPath, '-C', targetRoot], { stdio: 'pipe' });

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
