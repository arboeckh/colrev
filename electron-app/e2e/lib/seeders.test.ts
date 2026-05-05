import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TestWorkspace } from './test-workspace';
import {
  seedAccounts,
  seedBareRemote,
  seedAliceProject,
  seedRecords,
  ALICE,
  DEFAULT_PROJECT_ID,
} from './seeders';

const TEST_ROOT = '/tmp/colrev-e2e';
const testName = `seeders-${Date.now()}`;

function cleanup(): void {
  const dir = path.join(TEST_ROOT, testName);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('seedAccounts', () => {
  let ws: TestWorkspace;
  afterEach(cleanup);

  it('writes auth.json with correct structure', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [{ login: 'alice', token: 'tok-alice' }]);

    const auth = JSON.parse(fs.readFileSync(path.join(ws.userDataDir, 'auth.json'), 'utf-8'));
    expect(auth.version).toBe(2);
    expect(auth.activeLogin).toBe('alice');
    expect(auth.accounts).toHaveLength(1);
    expect(auth.accounts[0].user.login).toBe('alice');
    expect(auth.accounts[0].user.email).toBe('alice@test.local');
    expect(auth.accounts[0].encryptedToken).toBe(Buffer.from('tok-alice').toString('base64'));
  });

  it('writes registry.json with matching account entries', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [{ login: 'alice', token: 'tok-alice' }]);

    const registry = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
    expect(registry.accounts).toHaveLength(1);
    expect(registry.accounts[0].login).toBe('alice');
    expect(registry.accounts[0].token).toBe('tok-alice');
  });

  it('first account is the active login', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [
      { login: 'alice', token: 'tok-alice' },
      { login: 'bob', token: 'tok-bob' },
    ]);

    const auth = JSON.parse(fs.readFileSync(path.join(ws.userDataDir, 'auth.json'), 'utf-8'));
    expect(auth.activeLogin).toBe('alice');
    expect(auth.accounts).toHaveLength(2);
  });

  it('is idempotent — calling twice does not duplicate accounts', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [{ login: 'alice', token: 'tok-alice' }]);
    seedAccounts(ws, [{ login: 'alice', token: 'tok-alice' }]);

    const registry = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
    expect(registry.accounts).toHaveLength(1);
  });

  it('throws if no accounts provided', () => {
    ws = new TestWorkspace(testName);
    expect(() => seedAccounts(ws, [])).toThrow('At least one account required');
  });

  it('initializes empty registry collections alongside accounts', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [{ login: 'alice', token: 'tok-alice' }]);

    const registry = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
    expect(registry.repos).toEqual([]);
    expect(registry.collaborators).toEqual([]);
    expect(registry.invitations).toEqual([]);
    expect(registry.releases).toEqual([]);
  });
});

describe('seedBareRemote', () => {
  let ws: TestWorkspace;
  afterEach(cleanup);

  it('creates a bare git repo', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const barePath = seedBareRemote(ws, 'lit-review');

    const isBare = execFileSync('git', ['rev-parse', '--is-bare-repository'], {
      cwd: barePath,
      encoding: 'utf-8',
    }).trim();
    expect(isBare).toBe('true');
  });

  it('registers repo in registry as colrev', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const barePath = seedBareRemote(ws, 'lit-review');

    const registry = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
    expect(registry.repos).toHaveLength(1);
    expect(registry.repos[0].fullName).toBe('alice/lit-review');
    expect(registry.repos[0].isColrev).toBe(true);
    expect(registry.repos[0].cloneUrl).toBe(barePath);
  });

  it('uses the active login as owner', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [{ login: 'bob', token: 'tok-bob' }]);
    seedBareRemote(ws, 'my-project');

    const registry = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
    expect(registry.repos[0].owner).toBe('bob');
    expect(registry.repos[0].fullName).toBe('bob/my-project');
  });

  it('is idempotent — calling twice does not duplicate registry entries', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    seedBareRemote(ws, 'lit-review');
    seedBareRemote(ws, 'lit-review');

    const registry = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
    expect(registry.repos).toHaveLength(1);
  });

  it('throws if no auth is seeded', () => {
    ws = new TestWorkspace(testName);
    expect(() => seedBareRemote(ws, 'lit-review')).toThrow('No auth.json found');
  });
});

describe('seedAliceProject', () => {
  let ws: TestWorkspace;
  afterEach(cleanup);

  it('creates a project directory at userData/projects/alice/<id>', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const projectPath = seedAliceProject(ws);

    const expected = path.join(ws.userDataDir, 'projects', 'alice', DEFAULT_PROJECT_ID);
    expect(projectPath).toBe(expected);
    expect(fs.existsSync(projectPath)).toBe(true);
  });

  it('project has settings.json with correct title', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const projectPath = seedAliceProject(ws);

    const settings = JSON.parse(
      fs.readFileSync(path.join(projectPath, 'settings.json'), 'utf-8'),
    );
    expect(settings.project.title).toBe('Literature Review');
    expect(settings.project.review_type).toBe('literature_review');
  });

  it('project has data/records.bib', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const projectPath = seedAliceProject(ws);

    expect(fs.existsSync(path.join(projectPath, 'data', 'records.bib'))).toBe(true);
  });

  it('project is a git repo with at least one commit', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const projectPath = seedAliceProject(ws);

    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
    expect(log).toContain('Initialize CoLRev project');
  });

  it('project has origin remote pointing to the bare remote', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const projectPath = seedAliceProject(ws);

    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
    expect(remoteUrl).toContain('bare-remote');
    expect(remoteUrl).toContain('alice');
    expect(remoteUrl).toContain(`${DEFAULT_PROJECT_ID}.git`);
  });

  it('bare remote has the pushed commits', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const projectPath = seedAliceProject(ws);

    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
    const log = execFileSync('git', ['log', '--all', '--oneline'], {
      cwd: remoteUrl,
      encoding: 'utf-8',
    }).trim();
    expect(log).toContain('Initialize CoLRev project');
  });

  it('seeds alice account automatically if not already seeded', () => {
    ws = new TestWorkspace(testName);
    const projectPath = seedAliceProject(ws);

    expect(fs.existsSync(projectPath)).toBe(true);
    const auth = JSON.parse(fs.readFileSync(path.join(ws.userDataDir, 'auth.json'), 'utf-8'));
    expect(auth.activeLogin).toBe('alice');
  });

  it('is idempotent — calling twice returns the same path', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    const path1 = seedAliceProject(ws);
    const path2 = seedAliceProject(ws);
    expect(path1).toBe(path2);
  });

  it('registers the project in the registry as a colrev repo', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    seedAliceProject(ws);

    const registry = JSON.parse(fs.readFileSync(ws.registryPath, 'utf-8'));
    const repo = registry.repos.find(
      (r: { fullName: string }) => r.fullName === `alice/${DEFAULT_PROJECT_ID}`,
    );
    expect(repo).toBeDefined();
    expect(repo.isColrev).toBe(true);
  });
});

describe('seedRecords', () => {
  let ws: TestWorkspace;
  const fixtureDir = path.join(__dirname, '../fixtures/data');
  const recordsFixture = path.join(fixtureDir, 'records.bib');

  afterEach(cleanup);

  it('copies the fixture file into data/records.bib', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    seedAliceProject(ws);
    seedRecords(ws, recordsFixture);

    const projectPath = path.join(ws.userDataDir, 'projects', 'alice', DEFAULT_PROJECT_ID);
    const content = fs.readFileSync(path.join(projectPath, 'data', 'records.bib'), 'utf-8');
    expect(content).toContain('Smith2020');
    expect(content).toContain('Johnson2021');
    expect(content).toContain('Lee2019');
  });

  it('commits the records change', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    seedAliceProject(ws);
    seedRecords(ws, recordsFixture);

    const projectPath = path.join(ws.userDataDir, 'projects', 'alice', DEFAULT_PROJECT_ID);
    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
    expect(log).toContain('Add records');
  });

  it('pushes the commit to the bare remote', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    seedAliceProject(ws);
    seedRecords(ws, recordsFixture);

    const projectPath = path.join(ws.userDataDir, 'projects', 'alice', DEFAULT_PROJECT_ID);
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
    const log = execFileSync('git', ['log', '--all', '--oneline'], {
      cwd: remoteUrl,
      encoding: 'utf-8',
    }).trim();
    expect(log).toContain('Add records');
  });

  it('throws if no project exists', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    expect(() => seedRecords(ws, recordsFixture)).toThrow('No project found');
  });

  it('throws if fixture file does not exist', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    seedAliceProject(ws);
    expect(() => seedRecords(ws, '/tmp/nonexistent.bib')).toThrow('Fixture file not found');
  });

  it('is idempotent — calling twice with the same fixture is a no-op', () => {
    ws = new TestWorkspace(testName);
    seedAccounts(ws, [ALICE]);
    seedAliceProject(ws);
    seedRecords(ws, recordsFixture);
    seedRecords(ws, recordsFixture);

    const projectPath = path.join(ws.userDataDir, 'projects', 'alice', DEFAULT_PROJECT_ID);
    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
    const addRecordsCount = log.split('\n').filter((l: string) => l.includes('Add records')).length;
    expect(addRecordsCount).toBe(1);
  });
});
