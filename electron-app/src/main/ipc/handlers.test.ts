import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  defineHandler,
  registerHandlers,
  isLockFreeRpcMethod,
  LOCK_FREE_RPC_METHODS,
  type IpcHandler,
  type IpcHandlerSpec,
} from './registry';
import { createGitHandlers, type GitOps } from './git-handlers';
import { createGitHubHandlers, type GitHubHandlerDeps } from './github-handlers';
import { createAppHandlers, type AppHandlerDeps } from './app-handlers';
import type { GitHubClient } from '../github-client';

// --- fakes -----------------------------------------------------------------

function fakeGitOps(): GitOps {
  const ok = async () => ({ success: true });
  return {
    fetch: vi.fn(ok),
    pull: vi.fn(ok),
    fastForwardMain: vi.fn(ok),
    push: vi.fn(ok),
    pushBranch: vi.fn(ok),
    listBranches: vi.fn(async () => ({ success: true, branches: [], currentBranch: 'dev' })),
    createBranch: vi.fn(ok),
    createLocalBranch: vi.fn(ok),
    deleteLocalBranch: vi.fn(ok),
    checkout: vi.fn(ok),
    merge: vi.fn(ok),
    log: vi.fn(async () => ({ success: true, commits: [] })),
    dirtyState: vi.fn(async () => ({
      success: true,
      isDirty: false,
      uncommittedCount: 0,
      untrackedCount: 0,
    })),
    abortMerge: vi.fn(ok),
    hasMergeConflict: vi.fn(async () => false),
    revListCount: vi.fn(async () => ({ success: true, count: 0 })),
    getBranchAndUpstream: vi.fn(async () => ({ branch: 'dev', upstream: 'origin/dev' })),
  } as unknown as GitOps;
}

function fakeGitHubClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    parseOwnerRepo: (url: string) =>
      url.includes('github.com') ? { owner: 'acme', repo: 'lit-review' } : null,
    listColrevRepos: async () => [],
    listReleases: async () => [],
    listRepoCollaborators: async () => [],
    listPendingRepoInvitations: async () => [],
    listRepoInvitations: async () => [],
    ...overrides,
  } as unknown as GitHubClient;
}

function githubDeps(overrides: Partial<GitHubHandlerDeps> = {}): GitHubHandlerDeps {
  return {
    gh: fakeGitHubClient(),
    getToken: () => 'tok',
    getActiveLogin: () => 'alice',
    projectsRootForAccount: (login) => `/projects/${login}`,
    git: {
      clone: vi.fn(async () => ({ success: true })),
      createTag: vi.fn(async () => ({ success: true })),
      pushTag: vi.fn(async () => ({ success: true })),
    },
    fs: { existsSync: () => false, mkdirSync: () => undefined },
    ...overrides,
  };
}

function appDeps(overrides: Partial<AppHandlerDeps> = {}): AppHandlerDeps {
  const noop = async () => ({ success: true });
  return {
    startBackend: noop,
    stopBackend: noop,
    callRpc: noop,
    saveFileDialog: noop,
    chooseSavePath: noop,
    openFileDialog: noop,
    pdfExists: () => ({ exists: false }),
    appInfo: () => ({}),
    auth: {
      getSession: noop,
      getCachedSession: () => null,
      startDeviceFlow: noop,
      cancelDeviceFlow: () => undefined,
      logout: () => undefined,
      getToken: () => 'tok',
      listAccounts: () => [],
      switchAccount: noop,
      removeAccount: () => undefined,
      switchAccountLocal: () => null,
    },
    includeTestHandlers: true,
    ...overrides,
  };
}

function allSpecs(): IpcHandlerSpec[] {
  return [
    ...createAppHandlers(appDeps()),
    ...createGitHandlers({
      git: fakeGitOps(),
      getToken: () => 'tok',
      callBackend: async () => ({}) as never,
      refreshGitState: async () => null,
      getGitState: () => null,
      forgetGitState: () => {},
    }),
    ...createGitHubHandlers(githubDeps()),
  ];
}

const noEvent = undefined as unknown as Electron.IpcMainInvokeEvent;

// --- lock classification ---------------------------------------------------

describe('lock classification', () => {
  it('locks every handler that can reach the repository', () => {
    const lockFree = allSpecs()
      .filter((s) => s.lockFree)
      .map((s) => s.channel)
      .sort();

    // Exempting a handler is a deliberate act: adding one here means proving
    // it cannot contend for `.git/index.lock`.
    expect(lockFree).toEqual([
      '__test/switchAccount',
      'app:info',
      'auth:cancel-login',
      'auth:get-cached-session',
      'auth:get-session',
      'auth:get-token',
      'auth:list-accounts',
      'auth:login',
      'auth:logout',
      'auth:remove-account',
      'auth:switch-account',
      'colrev:call',
      'colrev:start',
      'colrev:stop',
      'file:choose-save-path',
      'file:open-dialog',
      'file:save-dialog',
      'git-state:forget',
      'git-state:get',
      'github:accept-invitation',
      'github:add-collaborator',
      'github:decline-invitation',
      'github:invite-user-suggestions',
      'github:list-collaborators',
      'github:list-colrev-repos',
      'github:list-invitations',
      'github:list-pending-invitations',
      'github:list-releases',
      'pdf:exists',
    ]);
  });

  it('holds the lock for every git:* handler', () => {
    const gitSpecs = allSpecs().filter((s) => s.channel.startsWith('git:'));
    expect(gitSpecs.length).toBeGreaterThan(10);
    expect(gitSpecs.filter((s) => s.lockFree)).toEqual([]);
  });

  it('requires a justification for every exemption', () => {
    for (const spec of allSpecs()) {
      if (spec.lockFree) {
        expect(spec.lockFreeReason?.trim(), spec.channel).toBeTruthy();
      }
    }
  });

  it('rejects an exemption with no reason', () => {
    expect(() =>
      defineHandler({ channel: 'git:danger', handler: async () => null, lockFree: true }),
    ).toThrow(/lockFreeReason/);
  });

  it('does not exempt delete_project — a fetch may be running on that project', () => {
    expect(isLockFreeRpcMethod('delete_project')).toBe(false);
  });

  it('does not exempt get_git_status — it opens a git.Repo', () => {
    expect(isLockFreeRpcMethod('get_git_status')).toBe(false);
    for (const [, reason] of LOCK_FREE_RPC_METHODS) {
      expect(reason.trim()).toBeTruthy();
    }
  });
});

// --- registration ----------------------------------------------------------

describe('registerHandlers', () => {
  function collect(specs: IpcHandlerSpec[]): Map<string, IpcHandler> {
    const registered = new Map<string, IpcHandler>();
    registerHandlers(specs, (channel, handler) => registered.set(channel, handler));
    return registered;
  }

  it('serializes locked handlers against each other', async () => {
    const order: string[] = [];
    const slow = (name: string) =>
      defineHandler({
        channel: name,
        handler: async () => {
          order.push(`${name}:start`);
          await new Promise((r) => setTimeout(r, 10));
          order.push(`${name}:end`);
          return null;
        },
      });

    const registered = collect([slow('git:a'), slow('git:b')]);
    await Promise.all([
      registered.get('git:a')!(noEvent),
      registered.get('git:b')!(noEvent),
    ]);

    expect(order).toEqual(['git:a:start', 'git:a:end', 'git:b:start', 'git:b:end']);
  });

  it('lets lock-free handlers run concurrently', async () => {
    const order: string[] = [];
    const slow = (name: string) =>
      defineHandler({
        channel: name,
        lockFree: true,
        lockFreeReason: 'test',
        handler: async () => {
          order.push(`${name}:start`);
          await new Promise((r) => setTimeout(r, 10));
          order.push(`${name}:end`);
          return null;
        },
      });

    const registered = collect([slow('a'), slow('b')]);
    await Promise.all([registered.get('a')!(noEvent), registered.get('b')!(noEvent)]);

    expect(order).toEqual(['a:start', 'b:start', 'a:end', 'b:end']);
  });

  it('refuses to register the same channel twice', () => {
    const spec = defineHandler({ channel: 'git:x', handler: async () => null });
    expect(() => collect([spec, spec])).toThrow(/Duplicate/);
  });
});

// --- preload contract ------------------------------------------------------

describe('IPC surface', () => {
  it('registers every channel the preload bridge invokes', () => {
    const preload = fs.readFileSync(
      path.join(__dirname, '..', '..', 'preload', 'index.ts'),
      'utf-8',
    );
    const invoked = new Set(
      [...preload.matchAll(/invoke\(\s*'([^']+)'/g)].map((m) => m[1]),
    );
    const registered = new Set(allSpecs().map((s) => s.channel));

    const missing = [...invoked].filter((c) => !registered.has(c)).sort();
    expect(missing).toEqual([]);
  });
});

// --- handler behaviour -----------------------------------------------------

describe('git handlers', () => {
  function handlersFor(git: GitOps) {
    const specs = createGitHandlers({
      git,
      getToken: () => 'tok',
      callBackend: async () => ({}) as never,
      refreshGitState: async () => null,
      getGitState: () => null,
      forgetGitState: () => {},
    });
    return new Map(specs.map((s) => [s.channel, s.handler]));
  }

  it('passes the auth token to remote operations', async () => {
    const git = fakeGitOps();
    await handlersFor(git).get('git:fetch')!(noEvent, '/repo');
    expect(git.fetch).toHaveBeenCalledWith('/repo', 'tok');
  });

  it('defaults ffOnly to true for pull and merge', async () => {
    const git = fakeGitOps();
    const handlers = handlersFor(git);
    await handlers.get('git:pull')!(noEvent, '/repo');
    await handlers.get('git:merge')!(noEvent, '/repo', 'dev');
    expect(git.pull).toHaveBeenCalledWith('/repo', 'tok', true);
    expect(git.merge).toHaveBeenCalledWith('/repo', 'dev', true);
  });

  it('honours an explicit ffOnly: false', async () => {
    const git = fakeGitOps();
    await handlersFor(git).get('git:pull')!(noEvent, '/repo', false);
    expect(git.pull).toHaveBeenCalledWith('/repo', 'tok', false);
  });
});

describe('github handlers', () => {
  function handlersFor(deps: GitHubHandlerDeps) {
    return new Map(createGitHubHandlers(deps).map((s) => [s.channel, s.handler]));
  }

  it('reports missing auth with the collection shape the renderer expects', async () => {
    const handlers = handlersFor(githubDeps({ getToken: () => null }));
    expect(await handlers.get('github:list-colrev-repos')!(noEvent)).toEqual({
      success: false,
      error: 'Not authenticated',
      repos: [],
    });
    expect(
      await handlers.get('github:list-releases')!(noEvent, { remoteUrl: 'https://github.com/a/b' }),
    ).toEqual({ success: false, error: 'Not authenticated', releases: [] });
  });

  it('rejects a non-GitHub remote before calling the API', async () => {
    const listReleases = vi.fn();
    const handlers = handlersFor(
      githubDeps({ gh: fakeGitHubClient({ listReleases }) }),
    );
    expect(
      await handlers.get('github:list-releases')!(noEvent, { remoteUrl: 'https://gitlab.com/a/b' }),
    ).toEqual({ success: false, error: 'Not a GitHub URL', releases: [] });
    expect(listReleases).not.toHaveBeenCalled();
  });

  it('turns a thrown API error into a shaped failure result', async () => {
    const handlers = handlersFor(
      githubDeps({
        gh: fakeGitHubClient({
          listRepoCollaborators: async () => {
            throw new Error('rate limited');
          },
        }),
      }),
    );
    expect(
      await handlers.get('github:list-collaborators')!(noEvent, {
        remoteUrl: 'https://github.com/a/b',
      }),
    ).toEqual({ success: false, error: 'rate limited', collaborators: [] });
  });

  it('reports an API request that timed out as OFFLINE', async () => {
    const handlers = handlersFor(
      githubDeps({
        gh: fakeGitHubClient({
          listRepoCollaborators: async () => {
            throw new DOMException('The operation timed out.', 'TimeoutError');
          },
        }),
      }),
    );
    expect(
      await handlers.get('github:list-collaborators')!(noEvent, {
        remoteUrl: 'https://github.com/a/b',
      }),
    ).toEqual({ success: false, error: 'OFFLINE', collaborators: [] });
  });

  it('clones into the active account projects root and returns the resolved path', async () => {
    const clone = vi.fn(async () => ({ success: true }));
    const mkdirSync = vi.fn();
    const existsSync = vi.fn(() => false); // neither account root nor target exist
    const handlers = handlersFor(
      githubDeps({
        fs: { existsSync, mkdirSync },
        git: { clone, createTag: vi.fn(), pushTag: vi.fn() } as never,
      }),
    );

    const result = await handlers.get('github:clone-repo')!(noEvent, {
      cloneUrl: 'https://github.com/acme/lit-review.git',
      projectId: 'lit-review',
    });

    const expectedPath = path.join('/projects/alice', 'lit-review');
    // The missing account root is created before cloning.
    expect(mkdirSync).toHaveBeenCalledWith('/projects/alice', { recursive: true });
    // The clone lands under the active account's root, with the auth token.
    expect(clone).toHaveBeenCalledWith(
      'https://github.com/acme/lit-review.git',
      expectedPath,
      'tok',
    );
    // The renderer must register the project at the returned path.
    expect(result).toEqual({ success: true, path: expectedPath });
  });

  it('does not recreate the account root when it already exists', async () => {
    const clone = vi.fn(async () => ({ success: true }));
    const mkdirSync = vi.fn();
    const handlers = handlersFor(
      githubDeps({
        // Root exists, target does not.
        fs: { existsSync: (p: string) => p === '/projects/alice', mkdirSync },
        git: { clone, createTag: vi.fn(), pushTag: vi.fn() } as never,
      }),
    );

    const result = await handlers.get('github:clone-repo')!(noEvent, {
      cloneUrl: 'https://github.com/acme/lit-review.git',
      projectId: 'lit-review',
    });

    expect(mkdirSync).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, path: path.join('/projects/alice', 'lit-review') });
  });

  it('refuses to clone when there is no active account', async () => {
    const clone = vi.fn();
    const mkdirSync = vi.fn();
    const handlers = handlersFor(
      githubDeps({
        getActiveLogin: () => null,
        fs: { existsSync: vi.fn(() => false), mkdirSync },
        git: { clone, createTag: vi.fn(), pushTag: vi.fn() } as never,
      }),
    );

    expect(
      await handlers.get('github:clone-repo')!(noEvent, {
        cloneUrl: 'https://github.com/acme/lit-review.git',
        projectId: 'lit-review',
      }),
    ).toEqual({ success: false, error: 'No active account' });
    expect(clone).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('refuses to clone over an existing project directory', async () => {
    const clone = vi.fn(async () => ({ success: true }));
    const handlers = handlersFor(
      githubDeps({
        fs: { existsSync: () => true, mkdirSync: () => undefined },
        git: { clone, createTag: vi.fn(), pushTag: vi.fn() } as never,
      }),
    );
    expect(
      await handlers.get('github:clone-repo')!(noEvent, {
        cloneUrl: 'https://github.com/a/b.git',
        projectId: 'lit-review',
      }),
    ).toEqual({ success: false, error: 'Project directory already exists' });
    expect(clone).not.toHaveBeenCalled();
  });

  it('stops the release flow when tagging fails', async () => {
    const pushTag = vi.fn();
    const createRelease = vi.fn();
    const handlers = handlersFor(
      githubDeps({
        gh: fakeGitHubClient({ createRelease }),
        git: {
          clone: vi.fn(),
          createTag: vi.fn(async () => ({ success: false, error: 'tag exists' })),
          pushTag,
        } as never,
      }),
    );
    expect(
      await handlers.get('github:create-release')!(noEvent, {
        remoteUrl: 'https://github.com/a/b',
        tagName: 'v1.0',
        name: 'v1.0',
        body: '',
        projectPath: '/repo',
      }),
    ).toEqual({ success: false, error: 'tag exists' });
    expect(pushTag).not.toHaveBeenCalled();
    expect(createRelease).not.toHaveBeenCalled();
  });

  describe('retrying a release after a partial failure', () => {
    const params = {
      remoteUrl: 'https://github.com/a/b',
      tagName: 'v1.0',
      name: 'Release 1',
      body: '',
      projectPath: '/repo',
    };

    it('succeeds on the second attempt, reusing the tag and pushing only that tag', async () => {
      const createTag = vi.fn(async () => ({ success: true }));
      const pushTag = vi.fn(async () => ({ success: true }));
      const release = { id: 1, tagName: 'v1.0' };
      const createRelease = vi
        .fn()
        .mockResolvedValueOnce({ success: false, error: 'Validation Failed' })
        .mockResolvedValueOnce({ success: true, release });
      const handlers = handlersFor(
        githubDeps({
          gh: fakeGitHubClient({ createRelease }),
          git: { clone: vi.fn(), createTag, pushTag } as never,
        }),
      );
      const call = () => handlers.get('github:create-release')!(noEvent, params);

      expect(await call()).toEqual({ success: false, error: 'Validation Failed' });
      expect(await call()).toEqual({ success: true, release });

      expect(createTag).toHaveBeenCalledTimes(2);
      expect(pushTag).toHaveBeenCalledTimes(2);
      // Only the release's own tag is pushed.
      expect(pushTag).toHaveBeenCalledWith('/repo', 'v1.0', 'tok');
    });

    it('does not create the release when the tag push fails', async () => {
      const createRelease = vi.fn();
      const handlers = handlersFor(
        githubDeps({
          gh: fakeGitHubClient({ createRelease }),
          git: {
            clone: vi.fn(),
            createTag: vi.fn(async () => ({ success: true })),
            pushTag: vi.fn(async () => ({ success: false, error: 'offline' })),
          } as never,
        }),
      );
      expect(await handlers.get('github:create-release')!(noEvent, params)).toEqual({
        success: false,
        error: 'offline',
      });
      expect(createRelease).not.toHaveBeenCalled();
    });
  });

  describe('GitHub list failures reach the renderer', () => {
    it('github:list-colrev-repos returns the failure, not an empty success', async () => {
      const handlers = handlersFor(
        githubDeps({
          gh: fakeGitHubClient({
            listColrevRepos: async () => {
              throw new Error('GitHub rejected the sign-in while listing your repositories.');
            },
          }),
        }),
      );
      expect(await handlers.get('github:list-colrev-repos')!(noEvent)).toEqual({
        success: false,
        error: 'GitHub rejected the sign-in while listing your repositories.',
        repos: [],
      });
    });

    it.each([
      ['github:list-releases', 'listReleases', 'releases'],
      ['github:list-collaborators', 'listRepoCollaborators', 'collaborators'],
      ['github:list-pending-invitations', 'listPendingRepoInvitations', 'invitations'],
    ])('%s returns the failure', async (channel, method, key) => {
      const handlers = handlersFor(
        githubDeps({
          gh: fakeGitHubClient({
            [method]: async () => {
              throw new Error('rate limit');
            },
          }),
        }),
      );
      expect(
        await handlers.get(channel)!(noEvent, { remoteUrl: 'https://github.com/a/b' }),
      ).toEqual({ success: false, error: 'rate limit', [key]: [] });
    });
  });
});
