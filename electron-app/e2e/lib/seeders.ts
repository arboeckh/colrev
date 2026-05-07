import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import type { TestWorkspace } from './test-workspace';

export interface SeedAccount {
  login: string;
  token: string;
}

export const ALICE: SeedAccount = { login: 'alice', token: 'tok-alice' };
export const BOB: SeedAccount = { login: 'bob', token: 'tok-bob' };
export const DEFAULT_PROJECT_ID = 'lit-review';

export const PINNED_DATE = '2025-01-01T00:00:00+00:00';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.local',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.local',
};

function isPinnedDates(): boolean {
  return process.env.COLREV_E2E_PINNED_DATES === '1';
}

export function pinnedNow(): string {
  return isPinnedDates() ? PINNED_DATE : new Date().toISOString();
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_ENV };
  if (isPinnedDates()) {
    env.GIT_AUTHOR_DATE = PINNED_DATE;
    env.GIT_COMMITTER_DATE = PINNED_DATE;
  }
  return env;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

interface Collaborator {
  login: string;
  name: string | null;
  avatarUrl: string;
  repoFullName: string;
}

interface RegistryData {
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
    isColrev: boolean;
  }[];
  collaborators: Collaborator[];
  invitations: unknown[];
  releases: unknown[];
}

function readOrCreateRegistry(registryPath: string): RegistryData {
  if (fs.existsSync(registryPath)) {
    return readJson(registryPath) as RegistryData;
  }
  return { accounts: [], repos: [], collaborators: [], invitations: [], releases: [] };
}

export function seedAccounts(workspace: TestWorkspace, accounts: SeedAccount[]): void {
  if (accounts.length === 0) {
    throw new Error('At least one account required');
  }

  const authPath = path.join(workspace.userDataDir, 'auth.json');
  const authData = {
    version: 2,
    activeLogin: accounts[0].login,
    accounts: accounts.map((a) => ({
      encryptedToken: Buffer.from(a.token).toString('base64'),
      user: {
        login: a.login,
        name: a.login,
        avatarUrl: '',
        email: `${a.login}@test.local`,
      },
      authenticatedAt: pinnedNow(),
    })),
  };
  writeJson(authPath, authData);

  const registry = readOrCreateRegistry(workspace.registryPath);

  for (const account of accounts) {
    const idx = registry.accounts.findIndex((a) => a.login === account.login);
    const entry = {
      login: account.login,
      name: account.login,
      avatarUrl: '',
      token: account.token,
    };
    if (idx >= 0) {
      registry.accounts[idx] = entry;
    } else {
      registry.accounts.push(entry);
    }
  }

  writeJson(workspace.registryPath, registry);
}

export function seedBareRemote(workspace: TestWorkspace, repoName: string): string {
  const authPath = path.join(workspace.userDataDir, 'auth.json');
  if (!fs.existsSync(authPath)) {
    throw new Error('No auth.json found — call seedAccounts first');
  }
  const auth = readJson(authPath) as { activeLogin: string };
  const owner = auth.activeLogin;
  if (!owner) {
    throw new Error('No active account in auth.json');
  }

  const barePath = workspace.createBareRemote(owner, repoName);

  const registry = readOrCreateRegistry(workspace.registryPath);
  const fullName = `${owner}/${repoName}`;

  if (!registry.repos.some((r) => r.fullName === fullName)) {
    registry.repos.push({
      name: repoName,
      fullName,
      owner,
      htmlUrl: `https://github.com/${fullName}`,
      description: null,
      isPrivate: false,
      updatedAt: pinnedNow(),
      cloneUrl: barePath,
      isColrev: true,
    });
    writeJson(workspace.registryPath, registry);
  }

  return barePath;
}

// Mirror the .gitignore colrev writes on first project load. Including it in
// the seed avoids a dirty working tree (which blocks managed-review launch)
// the first time the app boots against a freshly seeded project.
const COLREV_GITIGNORE = `.history
.colrev
__pycache__
*.bib.sav
venv
.corrections
.report.log
output
data/pdfs
data/dedupe
data/prep
data/pdf_get_man/missing_pdf_files.csv
data/.tei/
data/prep_man/records_prep_man.bib
data/data/sample_references.bib
.DS_Store
`;

const MINIMAL_SETTINGS = {
  project: {
    title: 'Literature Review',
    authors: [],
    keywords: [],
    protocol: null,
    review_type: 'literature_review',
    id_pattern: 'three_authors_year',
    share_stat_req: 'processed',
    delay_automated_processing: false,
    colrev_version: '-',
    auto_upgrade: true,
  },
  sources: [],
  search: { retrieve_forthcoming: true },
  load: {},
  prep: {
    fields_to_keep: [],
    defects_to_ignore: [],
    prep_rounds: [
      {
        name: 'prep',
        prep_package_endpoints: [{ endpoint: 'colrev.source_specific_prep' }],
      },
    ],
    prep_man_package_endpoints: [{ endpoint: 'colrev.export_man_prep' }],
  },
  dedupe: {
    dedupe_package_endpoints: [{ endpoint: 'colrev.dedupe' }],
  },
  prescreen: {
    explanation: '',
    prescreen_package_endpoints: [{ endpoint: 'colrev.colrev_cli_prescreen' }],
  },
  pdf_get: {
    pdf_path_type: 'symlink',
    pdf_required_for_screen_and_synthesis: true,
    defects_to_ignore: [],
    rename_pdfs: true,
    pdf_get_package_endpoints: [{ endpoint: 'colrev.local_index' }],
    pdf_get_man_package_endpoints: [{ endpoint: 'colrev.colrev_cli_pdf_get_man' }],
  },
  pdf_prep: {
    keep_backup_of_pdfs: true,
    pdf_prep_package_endpoints: [{ endpoint: 'colrev.grobid_tei' }],
    pdf_prep_man_package_endpoints: [{ endpoint: 'colrev.colrev_cli_pdf_prep_man' }],
  },
  screen: {
    criteria: {},
    screen_package_endpoints: [{ endpoint: 'colrev.colrev_cli_screen' }],
  },
  data: {
    data_package_endpoints: [{ endpoint: 'colrev.rev_check' }],
  },
};

export function seedAliceProject(workspace: TestWorkspace): string {
  const authPath = path.join(workspace.userDataDir, 'auth.json');
  if (!fs.existsSync(authPath)) {
    seedAccounts(workspace, [ALICE]);
  }

  const projectPath = path.join(
    workspace.userDataDir,
    'projects',
    ALICE.login,
    DEFAULT_PROJECT_ID,
  );

  if (fs.existsSync(path.join(projectPath, '.git'))) {
    return projectPath;
  }

  const barePath = seedBareRemote(workspace, DEFAULT_PROJECT_ID);

  fs.mkdirSync(projectPath, { recursive: true });

  writeJson(path.join(projectPath, 'settings.json'), MINIMAL_SETTINGS);
  fs.writeFileSync(path.join(projectPath, '.gitignore'), COLREV_GITIGNORE);

  fs.mkdirSync(path.join(projectPath, 'data'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'data', 'records.bib'), '');

  const env = gitEnv();
  execFileSync('git', ['init'], { cwd: projectPath, stdio: 'pipe' });
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: projectPath, stdio: 'pipe', env });
  execFileSync('git', ['add', '-A'], { cwd: projectPath, stdio: 'pipe', env });
  execFileSync('git', ['commit', '-m', 'Initialize CoLRev project'], {
    cwd: projectPath,
    stdio: 'pipe',
    env,
  });
  execFileSync('git', ['remote', 'add', 'origin', barePath], {
    cwd: projectPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['push', '-u', 'origin', 'main'], {
    cwd: projectPath,
    stdio: 'pipe',
    env,
  });

  return projectPath;
}

export function seedRecords(workspace: TestWorkspace, recordsBibFixturePath: string): void {
  const projectPath = path.join(
    workspace.userDataDir,
    'projects',
    ALICE.login,
    DEFAULT_PROJECT_ID,
  );

  if (!fs.existsSync(path.join(projectPath, '.git'))) {
    throw new Error(`No project found at ${projectPath} — call seedAliceProject first`);
  }

  if (!fs.existsSync(recordsBibFixturePath)) {
    throw new Error(`Fixture file not found: ${recordsBibFixturePath}`);
  }

  const target = path.join(projectPath, 'data', 'records.bib');
  fs.copyFileSync(recordsBibFixturePath, target);

  const env = gitEnv();
  execFileSync('git', ['add', 'data/records.bib'], { cwd: projectPath, stdio: 'pipe', env });

  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: projectPath,
    encoding: 'utf-8',
    env,
  }).trim();

  if (status.length === 0) {
    return;
  }

  execFileSync('git', ['commit', '-m', 'Add records'], {
    cwd: projectPath,
    stdio: 'pipe',
    env,
  });
  execFileSync('git', ['push', 'origin', 'main'], {
    cwd: projectPath,
    stdio: 'pipe',
    env,
  });
}

export interface LocalIndexSeed {
  doi: string;
  pdfPath: string;
}

/**
 * Seed colrev's LocalIndex (sqlite) inside the test workspace so pdf_get's
 * `colrev.local_index` package can find PDFs by DOI without hitting the
 * developer's real ~/.colrev.
 *
 * Requires COLREV_FAKE_GITHUB_REGISTRY to be set on the Electron main
 * process so HOME is redirected to userDataDir (see colrev-backend.ts).
 *
 * Schema mirrors colrev/env/local_index_sqlite.py SQLiteIndexRecord. We only
 * populate the columns the retrieve flow actually reads:
 *   - doi (WHERE clause when input record carries a DOI)
 *   - bibtex (parsed back into a record dict and used to locate the file)
 *   - file (cross-checked by prepare_record_for_return for is_file())
 */
export function seedLocalIndex(
  workspace: TestWorkspace,
  entries: LocalIndexSeed[],
): void {
  const colrevDir = path.join(workspace.userDataDir, '.colrev');
  fs.mkdirSync(colrevDir, { recursive: true });
  const dbPath = path.join(colrevDir, 'sqlite_index.db');

  const escape = (v: string | null): string => {
    if (v === null) return 'NULL';
    return `'${v.replace(/'/g, "''")}'`;
  };

  const lines: string[] = [];
  lines.push(
    `CREATE TABLE IF NOT EXISTS record_index (
      id TEXT PRIMARY KEY,
      colrev_id TEXT,
      citation_key TEXT,
      title TEXT,
      abstract TEXT,
      file TEXT,
      tei TEXT,
      fulltext TEXT,
      url TEXT,
      doi TEXT,
      dblp_key TEXT,
      colrev_pdf_id TEXT,
      bibtex TEXT
    );`,
  );

  for (const entry of entries) {
    const absPdf = path.resolve(entry.pdfPath);
    if (!fs.existsSync(absPdf)) {
      throw new Error(`seedLocalIndex: PDF not found at ${absPdf}`);
    }
    const id = crypto.createHash('sha256').update(`seed:${entry.doi}`).digest('hex');
    const citationKey = `Seed${entry.doi.replace(/[^a-zA-Z0-9]/g, '')}`;
    // BibTeX is parsed by colrev's loader to recreate the record dict; the
    // file field on disk is what pdf_get's import_pdf symlinks to.
    const bibtex = `@article{${citationKey},\n  title = {Seeded record for ${entry.doi}},\n  author = {Seed Author},\n  year = {2024},\n  journal = {Seed Journal},\n  doi = {${entry.doi}},\n  file = {${absPdf}},\n  ID = {${citationKey}},\n  ENTRYTYPE = {article}\n}\n`;

    lines.push(
      `INSERT INTO record_index VALUES (` +
        [
          escape(id),
          escape(`seed-cid-${entry.doi}`),
          escape(citationKey),
          escape(`Seeded record for ${entry.doi}`),
          'NULL',
          escape(absPdf),
          'NULL',
          'NULL',
          'NULL',
          escape(entry.doi),
          'NULL',
          'NULL',
          escape(bibtex),
        ].join(', ') +
        `);`,
    );
  }

  execFileSync('sqlite3', [dbPath], {
    input: lines.join('\n'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function seedCollaborator(
  workspace: TestWorkspace,
  collaborator: SeedAccount,
  repoFullName: string,
): void {
  const registry = readOrCreateRegistry(workspace.registryPath);

  const repo = registry.repos.find((r) => r.fullName === repoFullName);
  if (!repo) {
    throw new Error(`Repo "${repoFullName}" not found in registry`);
  }

  const existing = registry.collaborators.find(
    (c) => c.login === collaborator.login && c.repoFullName === repoFullName,
  );
  if (existing) return;

  registry.collaborators.push({
    login: collaborator.login,
    name: collaborator.login,
    avatarUrl: '',
    repoFullName,
  });

  writeJson(workspace.registryPath, registry);

  const clonePath = path.join(
    workspace.userDataDir,
    'projects',
    collaborator.login,
    path.basename(repoFullName),
  );

  if (fs.existsSync(path.join(clonePath, '.git'))) return;

  fs.mkdirSync(path.dirname(clonePath), { recursive: true });
  const env = gitEnv();
  execFileSync('git', ['clone', '--branch', 'main', repo.cloneUrl, clonePath], {
    stdio: 'pipe',
    env,
  });
}
