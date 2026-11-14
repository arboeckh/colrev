/**
 * Real-client-only behaviour that the shared contract suite cannot express:
 * the fake has no GitHub Actions to turn off, no HTTP failures, and no rate
 * limit. `fetch` and `dugite` are stubbed; nothing here reaches github.com.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'dugite';
import {
  clearGitHubCaches,
  createRepoAndPush,
  getInviteUserSuggestions,
  listColrevRepos,
  listPendingRepoInvitations,
  listReleases,
  listRepoCollaborators,
  listRepoInvitations,
  listUserRepos,
  searchGitHubUsers,
} from './github-manager';

vi.mock('dugite', () => ({ exec: vi.fn() }));

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A fake of the GitHub REST API: `routes` answers `METHOD url`. */
function stubFetch(routes: Map<string, Reply | (() => Reply)>) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      if (init?.body) bodies[key] = JSON.parse(init.body);
      const found = routes.get(key);
      if (!found) throw new Error(`unstubbed request ${key}`);
      const reply = typeof found === 'function' ? found() : found;
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        headers: { get: (n: string) => reply.headers?.[n.toLowerCase()] ?? null },
        json: async () => reply.body ?? {},
      };
    }),
  );
  return { calls, bodies };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearGitHubCaches();
});

// --- createRepoAndPush -------------------------------------------------------

const API = 'https://api.github.com';
const ACTIONS_URL = `${API}/repos/alice/lit-review/actions/permissions`;

function repoJson(name: string) {
  return {
    name,
    owner: { login: 'alice' },
    html_url: `https://github.com/alice/${name}`,
    clone_url: `https://github.com/alice/${name}.git`,
  };
}

/** A project's git state, as `exec` sees it. */
interface GitState {
  origin: string | null;
  pushExit: number;
  log: string[];
}

function stubGit(state: GitState) {
  vi.mocked(exec).mockImplementation((async (args: string[]) => {
    const ok = { stdout: '', stderr: '', exitCode: 0 };
    const sub = args.find((a) => ['remote', 'push', 'symbolic-ref', 'rev-parse'].includes(a));
    if (args[0] === 'symbolic-ref') return { ...ok, stdout: 'main\n' };
    if (args[0] === 'rev-parse') return ok;
    if (args[0] === 'remote' && args[1] === 'get-url') {
      return state.origin === null
        ? { stdout: '', stderr: 'error: No such remote', exitCode: 2 }
        : { ...ok, stdout: `${state.origin}\n` };
    }
    if (args[0] === 'remote' && (args[1] === 'add' || args[1] === 'set-url')) {
      state.log.push(`remote ${args[1]} ${args[3]}`);
      state.origin = args[3];
      return ok;
    }
    if (args[0] === 'remote' && args[1] === 'remove') {
      state.log.push('remote remove');
      state.origin = null;
      return ok;
    }
    if (sub === 'push') {
      state.log.push('push');
      return state.pushExit === 0
        ? ok
        : { stdout: '', stderr: 'remote: file too large', exitCode: state.pushExit };
    }
    return ok;
  }) as unknown as typeof exec);
}

describe('createRepoAndPush', () => {
  let git: GitState;
  const publish = (repoName = 'lit-review') =>
    createRepoAndPush({ token: 'tok', repoName, projectPath: '/unused', isPrivate: true });

  const happyRoutes = (name = 'lit-review') =>
    new Map<string, Reply | (() => Reply)>([
      [`GET ${API}/user`, { status: 200, body: { login: 'alice' } }],
      [`POST ${API}/user/repos`, { status: 201, body: repoJson(name) }],
      [`PUT ${API}/repos/alice/${name}/actions/permissions`, { status: 204 }],
    ]);

  beforeEach(() => {
    git = { origin: null, pushExit: 0, log: [] };
    stubGit(git);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('GitHub Actions', () => {
    it('disables Actions on the new repo before the first push', async () => {
      stubFetch(happyRoutes());
      const order: string[] = [];
      vi.mocked(fetch).mockImplementation(((u: string, i?: { method?: string }) => {
        order.push(`${i?.method ?? 'GET'} ${u}`);
        return Promise.resolve({ ok: true, status: 200, json: async () => (u.endsWith('/user') ? { login: 'alice' } : repoJson('lit-review')) });
      }) as never);
      const realExec = vi.mocked(exec).getMockImplementation()!;
      vi.mocked(exec).mockImplementation(((args: string[], cwd: string) => {
        if (args.includes('push')) order.push('git push');
        return realExec(args, cwd);
      }) as never);

      const result = await publish();

      expect(result.success).toBe(true);
      const disableAt = order.indexOf(`PUT ${ACTIONS_URL}`);
      expect(disableAt).toBeGreaterThan(-1);
      expect(disableAt).toBeLessThan(order.indexOf('git push'));
    });

    it('still publishes when Actions cannot be disabled', async () => {
      const routes = happyRoutes();
      routes.set(`PUT ${ACTIONS_URL}`, { status: 403 });
      stubFetch(routes);

      const result = await publish();

      expect(result.success).toBe(true);
      expect(git.log).toContain('push');
    });
  });

  describe('the remote URL', () => {
    it('is the one GitHub returns, not the name the user typed', async () => {
      // GitHub turns "My Review" into "My-Review".
      const routes = happyRoutes('My-Review');
      const { bodies } = stubFetch(routes);

      const result = await publish('My Review');

      expect(result).toEqual({
        success: true,
        repoUrl: 'https://github.com/alice/My-Review.git',
        htmlUrl: 'https://github.com/alice/My-Review',
      });
      expect(git.origin).toBe('https://github.com/alice/My-Review.git');
      expect(bodies[`POST ${API}/user/repos`]).toMatchObject({ name: 'My-Review' });
    });

    it('keeps the dots in a repo name', async () => {
      stubFetch(happyRoutes('lit-review-v1.2'));
      const result = await publish('lit-review-v1.2');
      expect(result.repoUrl).toBe('https://github.com/alice/lit-review-v1.2.git');
    });
  });

  describe('after a partial failure', () => {
    it('restores the previous origin and says the empty repo exists when the push fails', async () => {
      git.origin = 'git@elsewhere:old.git';
      git.pushExit = 1;
      stubFetch(happyRoutes());

      const result = await publish();

      expect(result.success).toBe(false);
      expect(result.error).toContain('remote: file too large');
      expect(result.error).toContain('alice/lit-review was created on GitHub');
      expect(result.error).toContain('reuse the empty repository');
      expect(result.error).toContain('restored to git@elsewhere:old.git');
      expect(git.origin).toBe('git@elsewhere:old.git');
    });

    it('removes an origin it added when the push fails', async () => {
      git.pushExit = 1;
      stubFetch(happyRoutes());

      const result = await publish();

      expect(result.success).toBe(false);
      expect(git.origin).toBeNull();
      expect(result.error).toContain('removed again');
    });

    it('reports a failing `git remote` instead of pushing', async () => {
      stubFetch(happyRoutes());
      const base = vi.mocked(exec).getMockImplementation()!;
      vi.mocked(exec).mockImplementation(((args: string[], cwd: string) => {
        if (args[0] === 'remote' && args[1] === 'add') {
          return Promise.resolve({ stdout: '', stderr: 'fatal: bad remote', exitCode: 128 });
        }
        return base(args, cwd);
      }) as never);

      const result = await publish();

      expect(result.success).toBe(false);
      expect(result.error).toContain('fatal: bad remote');
      expect(git.log).not.toContain('push');
    });

    it('creates nothing on GitHub when the project cannot be pushed at all', async () => {
      const { calls } = stubFetch(happyRoutes());
      vi.mocked(exec).mockImplementation((async () => ({
        stdout: '',
        stderr: 'fatal: ref HEAD is not a symbolic ref',
        exitCode: 128,
      })) as never);

      const result = await publish();

      expect(result.success).toBe(false);
      expect(result.error).toContain('no commits yet');
      expect(calls).toEqual([]);
    });

    describe('retrying with the same name', () => {
      const alreadyExists = {
        status: 422,
        body: { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] },
      };

      it('reuses the empty repository an earlier attempt left behind', async () => {
        const routes = happyRoutes();
        routes.set(`POST ${API}/user/repos`, alreadyExists);
        routes.set(`GET ${API}/repos/alice/lit-review`, { status: 200, body: repoJson('lit-review') });
        routes.set(`GET ${API}/repos/alice/lit-review/branches?per_page=1`, { status: 200, body: [] });
        stubFetch(routes);

        const result = await publish();

        expect(result).toEqual({
          success: true,
          repoUrl: 'https://github.com/alice/lit-review.git',
          htmlUrl: 'https://github.com/alice/lit-review',
        });
        expect(git.log).toContain('push');
      });

      it('first fails, then succeeds on the retry (end to end)', async () => {
        let exists = false;
        const routes = happyRoutes();
        routes.set(`POST ${API}/user/repos`, () => {
          if (exists) return alreadyExists;
          exists = true;
          return { status: 201, body: repoJson('lit-review') };
        });
        routes.set(`GET ${API}/repos/alice/lit-review`, { status: 200, body: repoJson('lit-review') });
        routes.set(`GET ${API}/repos/alice/lit-review/branches?per_page=1`, { status: 200, body: [] });
        stubFetch(routes);

        git.pushExit = 1;
        expect((await publish()).success).toBe(false);

        git.pushExit = 0;
        const retry = await publish();
        expect(retry.success).toBe(true);
        expect(git.origin).toBe('https://github.com/alice/lit-review.git');
      });

      it('does not reuse a repository that already has commits', async () => {
        const routes = happyRoutes();
        routes.set(`POST ${API}/user/repos`, alreadyExists);
        routes.set(`GET ${API}/repos/alice/lit-review`, { status: 200, body: repoJson('lit-review') });
        routes.set(`GET ${API}/repos/alice/lit-review/branches?per_page=1`, { status: 200, body: [{ name: 'main' }] });
        stubFetch(routes);

        const result = await publish();

        expect(result.success).toBe(false);
        expect(result.error).toContain('already has commits');
        expect(git.log).toEqual([]);
      });

      it('does not reuse a repository owned by someone else', async () => {
        const routes = happyRoutes();
        routes.set(`POST ${API}/user/repos`, alreadyExists);
        routes.set(`GET ${API}/repos/alice/lit-review`, {
          status: 200,
          body: { ...repoJson('lit-review'), owner: { login: 'carol' } },
        });
        stubFetch(routes);

        const result = await publish();

        expect(result.success).toBe(false);
        expect(result.error).toContain('not owned by this account');
        expect(git.log).toEqual([]);
      });
    });
  });
});

// --- list calls --------------------------------------------------------------

describe('list calls report HTTP failures instead of returning an empty list', () => {
  const unauthorized: Reply = { status: 401, body: { message: 'Bad credentials' } };
  const rateLimited: Reply = {
    status: 403,
    body: { message: 'API rate limit exceeded' },
    headers: { 'x-ratelimit-remaining': '0' },
  };

  it.each([
    ['listUserRepos', `GET ${API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator&page=1`, () => listUserRepos('t')],
    ['listReleases', `GET ${API}/repos/o/r/releases?per_page=30`, () => listReleases('t', 'o', 'r')],
    ['listRepoCollaborators', `GET ${API}/repos/o/r/collaborators?per_page=100&page=1`, () => listRepoCollaborators('t', 'o', 'r')],
    ['listPendingRepoInvitations', `GET ${API}/repos/o/r/invitations?per_page=100`, () => listPendingRepoInvitations('t', 'o', 'r')],
    ['listRepoInvitations', `GET ${API}/user/repository_invitations?per_page=100`, () => listRepoInvitations('t')],
    ['searchGitHubUsers', `GET ${API}/search/users?q=${encodeURIComponent('bob in:login type:user')}&per_page=8`, () => searchGitHubUsers('t', 'bob')],
  ])('%s rejects on an expired token and on a rate limit', async (_name, route, call) => {
    stubFetch(new Map([[route, unauthorized]]));
    await expect(call()).rejects.toThrow(/sign-in|Sign in/);

    stubFetch(new Map([[route, rateLimited]]));
    await expect(call()).rejects.toThrow(/rate limit/);
  });

  it('listColrevRepos rejects when the repo list fails, and when the token dies mid-way', async () => {
    const listUrl = `GET ${API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator&page=1`;
    stubFetch(new Map([[listUrl, unauthorized]]));
    await expect(listColrevRepos('t')).rejects.toThrow(/Sign in/);

    clearGitHubCaches();
    stubFetch(
      new Map<string, Reply>([
        [listUrl, { status: 200, body: [{ name: 'r', full_name: 'o/r', owner: { login: 'o' } }] }],
        [`GET ${API}/repos/o/r/contents/settings.json`, rateLimited],
      ]),
    );
    await expect(listColrevRepos('t')).rejects.toThrow(/rate limit/);
  });

  it('a repo without settings.json (404) or an empty repo (409) is simply not a CoLRev repo', async () => {
    const listUrl = `GET ${API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator&page=1`;
    const repo = (n: string) => ({ name: n, full_name: `o/${n}`, owner: { login: 'o' } });
    stubFetch(
      new Map<string, Reply>([
        [listUrl, { status: 200, body: [repo('a'), repo('b'), repo('c')] }],
        [`GET ${API}/repos/o/a/contents/settings.json`, { status: 200 }],
        [`GET ${API}/repos/o/b/contents/settings.json`, { status: 404 }],
        [`GET ${API}/repos/o/c/contents/settings.json`, { status: 409 }],
      ]),
    );
    const repos = await listColrevRepos('t');
    expect(repos.map((r) => r.name)).toEqual(['a']);
  });
});

// --- caching -----------------------------------------------------------------

describe('session caches', () => {
  const listUrl = `GET ${API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator&page=1`;
  const repo = (n: string) => ({
    name: n,
    full_name: `o/${n}`,
    owner: { login: 'o' },
    updated_at: '2026-01-01T00:00:00Z',
  });

  it('listColrevRepos asks GitHub once for repeated and concurrent calls', async () => {
    const { calls } = stubFetch(
      new Map<string, Reply>([
        [listUrl, { status: 200, body: [repo('a')] }],
        [`GET ${API}/repos/o/a/contents/settings.json`, { status: 200 }],
      ]),
    );

    await Promise.all([listColrevRepos('t'), listColrevRepos('t')]);
    await listColrevRepos('t');

    expect(calls).toHaveLength(2); // one repo list + one settings.json probe
  });

  it('does not cache a failure', async () => {
    let status = 401;
    stubFetch(new Map([[listUrl, () => ({ status, body: status === 200 ? [] : {} })]]));

    await expect(listUserRepos('t')).rejects.toThrow();
    status = 200;
    await expect(listUserRepos('t')).resolves.toEqual([]);
  });

  it('keeps tokens apart', async () => {
    const { calls } = stubFetch(new Map([[listUrl, { status: 200, body: [] }]]));
    await listUserRepos('one');
    await listUserRepos('two');
    expect(calls).toHaveLength(2);
  });

  it('short-query suggestions reuse one candidate list and still honour excludeLogins', async () => {
    const { calls } = stubFetch(
      new Map<string, Reply>([
        [`GET ${API}/users/o`, { status: 200, body: { type: 'User' } }],
        [listUrl, { status: 200, body: [repo('r'), repo('other')] }],
        [
          `GET ${API}/repos/o/other/collaborators?per_page=100&page=1`,
          { status: 200, body: [{ login: 'bob' }, { login: 'carol' }] },
        ],
      ]),
    );
    const remote = 'https://github.com/o/r.git';

    const first = await getInviteUserSuggestions('t', remote, '', []);
    const second = await getInviteUserSuggestions('t', remote, '', ['bob']);

    expect(first.map((u) => u.login)).toEqual(['bob', 'carol']);
    expect(second.map((u) => u.login)).toEqual(['carol']);
    expect(calls).toHaveLength(3); // owner lookup + repo list + one collaborator list
  });

  it('suggestions survive a repo whose collaborators the user may not list', async () => {
    stubFetch(
      new Map<string, Reply>([
        [`GET ${API}/users/o`, { status: 200, body: { type: 'User' } }],
        [listUrl, { status: 200, body: [repo('x'), repo('y')] }],
        [`GET ${API}/repos/o/x/collaborators?per_page=100&page=1`, { status: 403, body: { message: 'Must have push access' } }],
        [`GET ${API}/repos/o/y/collaborators?per_page=100&page=1`, { status: 200, body: [{ login: 'dave' }] }],
      ]),
    );
    const out = await getInviteUserSuggestions('t', 'https://github.com/o/r.git', '', []);
    expect(out.map((u) => u.login)).toEqual(['dave']);
  });
});

// --- timeouts ----------------------------------------------------------------

describe('GitHub HTTP timeouts', () => {
  it('gives every API request an abort signal', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
    vi.stubGlobal('fetch', fetchMock);

    await listReleases('tok', 'alice', 'lit-review');

    const init = (fetchMock.mock.calls[0] as unknown as [string, { signal?: AbortSignal }])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a request that timed out as OFFLINE while publishing', async () => {
    stubGit({ origin: null, pushExit: 0, log: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }),
    );

    const result = await createRepoAndPush({
      token: 'tok',
      repoName: 'lit-review',
      projectPath: '/unused',
      isPrivate: true,
    });

    expect(result).toEqual({ success: false, error: 'OFFLINE' });
  });

  it('a timeout while probing a repo is a failed list, not "not a CoLRev repo"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/contents/settings.json')) {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        }
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: 'r', full_name: 'o/r', owner: { login: 'o' } }],
        };
      }),
    );
    await expect(listColrevRepos('t')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
