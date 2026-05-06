import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  test,
  expect,
  seedAccounts,
  seedAliceProject,
  seedRecords,
  seedCollaborator,
  ALICE,
  BOB,
  DEFAULT_PROJECT_ID,
  SnapshotCache,
  SNAPSHOT_SOURCE_ROOTS,
} from '../fixtures/test-workspace.fixture';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'colrev-test-fixtures');

function createCache(): SnapshotCache {
  return new SnapshotCache({ cacheDir: CACHE_DIR, sourceRoots: SNAPSHOT_SOURCE_ROOTS });
}

test.describe('build-fixtures', () => {
  test('emits L1 through L4 snapshots with pinned dates', async ({ workspace }) => {
    const cache = createCache();
    const recordsFixture = path.join(__dirname, '../fixtures/data/records.bib');

    // --- L1: accounts seeded ---
    seedAccounts(workspace, [ALICE, BOB]);
    cache.checkpoint('L1', workspace.root);

    const auth = JSON.parse(
      fs.readFileSync(path.join(workspace.userDataDir, 'auth.json'), 'utf-8'),
    );
    expect(auth.activeLogin).toBe('alice');
    expect(auth.accounts).toHaveLength(2);

    // --- L2: empty project pushed ---
    const projectPath = seedAliceProject(workspace);
    cache.checkpoint('L2', workspace.root);

    expect(fs.existsSync(path.join(projectPath, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'settings.json'))).toBe(true);
    const bareLog = execFileSync(
      'git',
      ['log', '--all', '--oneline'],
      {
        cwd: workspace.bareRemotePath('alice', DEFAULT_PROJECT_ID),
        encoding: 'utf-8',
      },
    ).trim();
    expect(bareLog).toContain('Initialize CoLRev project');

    // --- L3: project with seeded records ---
    seedRecords(workspace, recordsFixture);
    cache.checkpoint('L3', workspace.root);

    const records = fs.readFileSync(
      path.join(projectPath, 'data', 'records.bib'),
      'utf-8',
    );
    expect(records).toContain('Smith2020');
    expect(records).toContain('Johnson2021');
    expect(records).toContain('Lee2019');

    // --- L4: collaborator added and accepted ---
    const repoFullName = `alice/${DEFAULT_PROJECT_ID}`;
    seedCollaborator(workspace, BOB, repoFullName);
    cache.checkpoint('L4', workspace.root);

    const registry = JSON.parse(fs.readFileSync(workspace.registryPath, 'utf-8'));
    const collab = registry.collaborators.find(
      (c: { login: string; repoFullName: string }) =>
        c.login === 'bob' && c.repoFullName === repoFullName,
    );
    expect(collab).toBeDefined();

    const bobClone = path.join(workspace.userDataDir, 'projects', 'bob', DEFAULT_PROJECT_ID);
    expect(fs.existsSync(path.join(bobClone, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(bobClone, 'data', 'records.bib'))).toBe(true);

    // Verify all snapshots were written
    for (const level of ['L1', 'L2', 'L3', 'L4']) {
      expect(fs.existsSync(path.join(CACHE_DIR, `${level}.tar.gz`))).toBe(true);
      expect(fs.existsSync(path.join(CACHE_DIR, `${level}.meta.json`))).toBe(true);
    }
  });
});
