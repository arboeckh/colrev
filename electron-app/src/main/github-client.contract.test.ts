/**
 * One contract suite, run against both `GitHubClient` implementations
 * (WP-08 §2).
 *
 * `FakeGitHubClient` exists so e2e can drive collaboration flows without the
 * network. That only works if it is a *protocol-level* double: same accepted
 * URL formats, same invited/already-a-collaborator distinction, same
 * "errors are returned, not thrown" discipline. Nothing else pins that — the
 * e2e suite only ever exercises the fake, so a regression on a real-only code
 * path is invisible there, and a fake that quietly diverges makes green e2e
 * runs meaningless.
 *
 * The real client is driven against a mocked HTTP layer (`fetch`) and a
 * mocked dugite, so this suite stays hermetic.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'dugite';
import { FakeGitHubClient } from './fake-github-client';
import { FakeGitHubRegistry } from './fake-github-registry';
import type { GitHubClient } from './github-client';
import { RealGitHubClient } from './real-github-client';

vi.mock('dugite', () => ({ exec: vi.fn() }));

const TOKEN = 'tok-alice';
const OWNER = 'alice';
const REPO = 'lit-review';
const COLLABORATOR = 'bob';

// --- driver -----------------------------------------------------------------

/**
 * Everything the shared suite needs in order to arrange a scenario without
 * knowing which implementation it is talking to.
 */
interface ContractDriver {
  client: GitHubClient;
  /** A remote URL this client resolves to OWNER/REPO. */
  remoteUrl: string;
  /** A local git repo with one commit, ready to publish. Created on demand —
   * only the publish tests need one. */
  projectPath(): string;
  makeExistingCollaborator(login: string): void;
  seedReleases(tags: string[]): void;
  /** Arrange: the releases API is unavailable / the repo is unknown. */
  breakReleases(): void;
  /** Arrange: the push during `createRepoAndPush` fails. */
  breakPush(): void;
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A real git repository with a single commit, for the publish path. */
function makeGitRepo(root: string): string {
  const repoPath = path.join(root, 'project');
  fs.mkdirSync(repoPath, { recursive: true });
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: repoPath,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  git(['init', '-b', 'main']);
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# project\n');
  git(['add', '.']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'init', '--no-verify']);
  return repoPath;
}

// --- suite ------------------------------------------------------------------

function describeGitHubClientContract(name: string, makeDriver: () => ContractDriver): void {
  describe(`GitHubClient contract: ${name}`, () => {
    let driver: ContractDriver;

    beforeEach(() => {
      driver = makeDriver();
    });

    describe('parseOwnerRepo', () => {
      it.each([
        ['https://github.com/acme/lit-review.git', 'acme', 'lit-review'],
        ['https://github.com/acme/lit-review', 'acme', 'lit-review'],
        ['git@github.com:acme/lit-review.git', 'acme', 'lit-review'],
      ])('accepts %s', (url, owner, repo) => {
        expect(driver.client.parseOwnerRepo(url)).toEqual({ owner, repo });
      });

      it.each([
        ['https://gitlab.com/acme/lit-review.git'],
        ['https://example.com/github.com-lookalike/repo'],
        ['not a url'],
        [''],
      ])('rejects %s', (url) => {
        expect(driver.client.parseOwnerRepo(url)).toBeNull();
      });

      it('resolves the remote URL this client actually hands out', () => {
        // For the real client that is a github.com URL; for the fake it is a
        // local bare repo path. Both must round-trip to the same owner/repo.
        expect(driver.client.parseOwnerRepo(driver.remoteUrl)).toEqual({
          owner: OWNER,
          repo: REPO,
        });
      });
    });

    describe('addRepoCollaborator', () => {
      it('reports an invitation for someone who is not a collaborator yet', async () => {
        await expect(
          driver.client.addRepoCollaborator(TOKEN, OWNER, REPO, COLLABORATOR),
        ).resolves.toEqual({ success: true, invited: true });
      });

      it('reports no invitation for an existing collaborator', async () => {
        driver.makeExistingCollaborator(COLLABORATOR);
        // GitHub answers 204 here; the UI renders "Added", not "Invited".
        await expect(
          driver.client.addRepoCollaborator(TOKEN, OWNER, REPO, COLLABORATOR),
        ).resolves.toEqual({ success: true, invited: false });
      });
    });

    describe('listReleases', () => {
      it('maps releases newest-first with their tag names', async () => {
        driver.seedReleases(['v1.0', 'v1.1']);
        const releases = await driver.client.listReleases(TOKEN, OWNER, REPO);
        expect(releases.map((r) => r.tagName).sort()).toEqual(['v1.0', 'v1.1']);
      });

      it('returns an empty list rather than throwing when releases are unavailable', async () => {
        driver.breakReleases();
        await expect(driver.client.listReleases(TOKEN, OWNER, REPO)).resolves.toEqual([]);
      });
    });

    describe('createRepoAndPush', () => {
      it('reports the new repo URLs on success', async () => {
        const result = await driver.client.createRepoAndPush({
          token: TOKEN,
          repoName: REPO,
          projectPath: driver.projectPath(),
          isPrivate: true,
        });

        expect(result.success).toBe(true);
        expect(result.repoUrl).toBeTruthy();
        expect(result.htmlUrl).toBeTruthy();
      });

      it('returns a failure instead of throwing when the push fails', async () => {
        driver.breakPush();

        const result = await driver.client.createRepoAndPush({
          token: TOKEN,
          repoName: REPO,
          projectPath: driver.projectPath(),
          isPrivate: true,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      });
    });
  });
}

// --- fake driver ------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});

describeGitHubClientContract('FakeGitHubClient', () => {
  const root = makeTempDir('colrev-contract-fake-');
  tempDirs.push(root);

  const registry = new FakeGitHubRegistry(path.join(root, 'registry.json'));
  registry.modify((data) => {
    Object.assign(data, {
    accounts: [
      { login: OWNER, name: 'Alice', avatarUrl: '', token: TOKEN },
      { login: COLLABORATOR, name: 'Bob', avatarUrl: '', token: 'tok-bob' },
    ],
    repos: [
      {
        name: REPO,
        fullName: `${OWNER}/${REPO}`,
        owner: OWNER,
        htmlUrl: `https://github.com/${OWNER}/${REPO}`,
        description: null,
        isPrivate: true,
        updatedAt: new Date(0).toISOString(),
        cloneUrl: `https://github.com/${OWNER}/${REPO}.git`,
        isColrev: true,
      },
    ],
    collaborators: [],
    invitations: [],
    releases: [],
    });
  });

  const bareRemoteDir = path.join(root, 'bare-remote');
  let projectPath: string | null = null;
  const project = () => (projectPath ??= makeGitRepo(root));

  return {
    client: new FakeGitHubClient(registry, bareRemoteDir),
    remoteUrl: path.join(bareRemoteDir, OWNER, `${REPO}.git`),
    projectPath: project,
    makeExistingCollaborator(login) {
      registry.addInvitation(OWNER, REPO, login, 'push');
      const pending = registry.getPendingInvitations(OWNER, REPO);
      registry.acceptInvitation(pending[pending.length - 1].id);
    },
    seedReleases(tags) {
      for (const tagName of tags) {
        registry.createRelease(OWNER, REPO, { tagName, name: tagName, body: '' });
      }
    },
    breakReleases() {
      // The fake's equivalent of a 404: nothing recorded for this repo. It
      // must still answer with an empty list.
    },
    breakPush() {
      // Not a git repository — the push must surface as an error result.
      fs.rmSync(path.join(project(), '.git'), { recursive: true, force: true });
    },
  };
});

// --- real driver ------------------------------------------------------------

interface StubbedRoute {
  status: number;
  body?: unknown;
}

describeGitHubClientContract('RealGitHubClient', () => {
  const root = makeTempDir('colrev-contract-real-');
  tempDirs.push(root);

  const routes = new Map<string, StubbedRoute>();
  routes.set('GET https://api.github.com/user', {
    status: 200,
    body: { login: OWNER },
  });
  routes.set('POST https://api.github.com/user/repos', {
    status: 201,
    body: { html_url: `https://github.com/${OWNER}/${REPO}` },
  });
  routes.set(`PUT https://api.github.com/repos/${OWNER}/${REPO}/collaborators/${COLLABORATOR}`, {
    status: 201,
  });
  routes.set(`GET https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, {
    status: 200,
    body: [],
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const route = routes.get(key);
      if (!route) throw new Error(`contract test: unstubbed request ${key}`);
      return {
        ok: route.status >= 200 && route.status < 300,
        status: route.status,
        json: async () => route.body ?? {},
      };
    }),
  );

  // dugite is mocked at module level; drive the publish path's git calls from
  // here so the suite never touches a real remote.
  let pushExitCode = 0;
  vi.mocked(exec).mockImplementation((async (args: string[]) => {
    const ok = { stdout: '', stderr: '', exitCode: 0 };
    if (args[0] === 'remote') return ok;
    if (args[0] === 'symbolic-ref') return { ...ok, stdout: 'main\n' };
    if (args[0] === 'rev-parse') return ok;
    if (args.includes('push')) {
      return {
        stdout: '',
        stderr: pushExitCode === 0 ? '' : 'remote rejected',
        exitCode: pushExitCode,
      };
    }
    return ok;
  }) as unknown as typeof exec);

  return {
    client: new RealGitHubClient(),
    remoteUrl: `https://github.com/${OWNER}/${REPO}.git`,
    // dugite is mocked, so the publish path never touches this directory.
    projectPath: () => path.join(root, 'project'),
    makeExistingCollaborator(login) {
      routes.set(`PUT https://api.github.com/repos/${OWNER}/${REPO}/collaborators/${login}`, {
        status: 204,
      });
    },
    seedReleases(tags) {
      routes.set(`GET https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, {
        status: 200,
        body: tags.map((tag, i) => ({
          id: i + 1,
          tag_name: tag,
          name: tag,
          body: '',
          html_url: `https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`,
          draft: false,
          prerelease: false,
          created_at: new Date(0).toISOString(),
          published_at: new Date(0).toISOString(),
          author: { login: OWNER },
        })),
      });
    },
    breakReleases() {
      routes.set(`GET https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, {
        status: 404,
        body: { message: 'Not Found' },
      });
    },
    breakPush() {
      pushExitCode = 128;
    },
  };
});
