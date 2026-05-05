import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const E2E_ROOT = '/tmp/colrev-e2e';

export interface LastState {
  activeAccount: string | null;
  registryPath: string;
  bareRemotePath: string;
  lastRpc: unknown;
}

export class TestWorkspace {
  readonly root: string;
  readonly userDataDir: string;
  readonly bareRemoteDir: string;
  readonly registryPath: string;
  readonly backendLogPath: string;
  readonly rendererLogPath: string;
  readonly rpcJsonlPath: string;
  readonly lastStatePath: string;

  constructor(testName: string) {
    this.root = path.join(E2E_ROOT, testName);
    this.userDataDir = path.join(this.root, 'userData');
    this.bareRemoteDir = path.join(this.root, 'bare-remote');
    this.registryPath = path.join(this.root, 'registry.json');
    this.backendLogPath = path.join(this.root, 'backend.log');
    this.rendererLogPath = path.join(this.root, 'renderer.log');
    this.rpcJsonlPath = path.join(this.root, 'rpc.jsonl');
    this.lastStatePath = path.join(this.root, 'last-state.json');

    if (fs.existsSync(this.root)) {
      fs.rmSync(this.root, { recursive: true, force: true });
    }

    fs.mkdirSync(this.userDataDir, { recursive: true });
    fs.mkdirSync(this.bareRemoteDir, { recursive: true });

    fs.writeFileSync(this.backendLogPath, '');
    fs.writeFileSync(this.rendererLogPath, '');
    fs.writeFileSync(this.rpcJsonlPath, '');
  }

  writeLastState(state: LastState): void {
    fs.writeFileSync(this.lastStatePath, JSON.stringify(state, null, 2));
  }

  seedRegistry(data: {
    accounts: { login: string; name: string; avatarUrl: string; token: string }[];
    repos: {
      name: string;
      fullName: string;
      owner: string;
      htmlUrl: string;
      description: string | null;
      isPrivate: boolean;
      updatedAt: string;
      cloneUrl: string;
      isColrev?: boolean;
    }[];
    collaborators: { login: string; name: string | null; avatarUrl: string; repoFullName: string }[];
    invitations: unknown[];
    releases: unknown[];
  }): void {
    fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2));
  }

  appendBackendLog(line: string): void {
    fs.appendFileSync(this.backendLogPath, line + '\n');
  }

  appendRendererLog(line: string): void {
    fs.appendFileSync(this.rendererLogPath, line + '\n');
  }

  appendRpcJsonl(entry: unknown): void {
    fs.appendFileSync(this.rpcJsonlPath, JSON.stringify(entry) + '\n');
  }

  bareRemotePath(owner: string, repoName: string): string {
    return path.join(this.bareRemoteDir, owner, `${repoName}.git`);
  }

  createBareRemote(owner: string, repoName: string): string {
    const barePath = this.bareRemotePath(owner, repoName);
    fs.mkdirSync(barePath, { recursive: true });
    execSync('git init --bare', { cwd: barePath, stdio: 'pipe' });
    return barePath;
  }

  listBareRemotes(): { owner: string; repo: string }[] {
    if (!fs.existsSync(this.bareRemoteDir)) return [];
    const result: { owner: string; repo: string }[] = [];
    for (const owner of fs.readdirSync(this.bareRemoteDir)) {
      const ownerDir = path.join(this.bareRemoteDir, owner);
      if (!fs.statSync(ownerDir).isDirectory()) continue;
      for (const entry of fs.readdirSync(ownerDir)) {
        if (entry.endsWith('.git')) {
          result.push({ owner, repo: entry.replace(/\.git$/, '') });
        }
      }
    }
    return result;
  }
}
