import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `git-manager` resolves dugite lazily (`await import('dugite')`) inside every
 * function, so a module mock is enough to drive the exec results per test.
 */
const exec = vi.fn();
vi.mock('dugite', async () => {
  // Keep the real `parseError` / `GitError` — classification is exactly what
  // the failure tests below are asserting.
  const actual = await vi.importActual<typeof import('dugite')>('dugite');
  return { ...actual, exec: (...args: unknown[]) => exec(...args) };
});

import {
  gitCheckout,
  gitClone,
  gitFastForwardMain,
  gitListBranches,
  gitPull,
  DIVERGED,
  gitDeleteLocalBranch,
  gitDeleteRemoteBranch,
  gitPush,
  gitFetch,
  classifyGitFailure,
  DIRTY_WORKTREE,
  REJECTED_FETCH_FIRST,
  AUTH_FAILED,
  OFFLINE,
} from './git-manager';

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stdout, stderr: '' });
const fail = (stderr: string): ExecResult => ({ exitCode: 1, stdout: '', stderr });

/** Match dugite calls by their first argv token(s). */
function respond(table: Array<[string[], ExecResult]>): void {
  exec.mockImplementation((args: string[]) => {
    for (const [prefix, result] of table) {
      if (prefix.every((token, i) => args[i] === token)) return Promise.resolve(result);
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
}

const REPO = '/tmp/repo';

describe('gitCheckout', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('refuses to move HEAD when the working tree is dirty', async () => {
    respond([
      [['rev-parse', '--abbrev-ref', 'HEAD'], ok('dev\n')],
      [['status', '--porcelain'], ok(' M data/records.bib\n?? notes.md\n')],
    ]);

    const result = await gitCheckout(REPO, 'review/prescreen/t1/alice');

    expect(result).toEqual({
      success: false,
      error: DIRTY_WORKTREE,
      dirty: { uncommittedCount: 1, untrackedCount: 1 },
    });
  });

  it('never stashes — a refused checkout leaves the tree untouched', async () => {
    respond([
      [['rev-parse', '--abbrev-ref', 'HEAD'], ok('dev\n')],
      [['status', '--porcelain'], ok(' M data/records.bib\n')],
    ]);

    await gitCheckout(REPO, 'main');

    const commands = exec.mock.calls.map(([args]) => (args as string[])[0]);
    expect(commands).not.toContain('stash');
    expect(commands).not.toContain('checkout');
  });

  it('checks out a local branch when the tree is clean', async () => {
    respond([
      [['rev-parse', '--abbrev-ref', 'HEAD'], ok('dev\n')],
      [['status', '--porcelain'], ok('')],
      [['rev-parse', '--verify', 'main'], ok('abc123\n')],
      [['checkout', 'main'], ok()],
    ]);

    expect(await gitCheckout(REPO, 'main')).toEqual({ success: true });
  });

  it('creates a tracking branch when the branch exists only on the remote', async () => {
    respond([
      [['rev-parse', '--abbrev-ref', 'HEAD'], ok('dev\n')],
      [['status', '--porcelain'], ok('')],
      [['rev-parse', '--verify', 'review/x'], fail('not a valid ref')],
      [['checkout', '-b', 'review/x', 'origin/review/x'], ok()],
    ]);

    expect(await gitCheckout(REPO, 'review/x')).toEqual({ success: true });
  });

  it('is a no-op on the branch already checked out, even when dirty', async () => {
    respond([[['rev-parse', '--abbrev-ref', 'HEAD'], ok('dev\n')]]);

    expect(await gitCheckout(REPO, 'dev')).toEqual({ success: true });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-dirty checkout failure verbatim', async () => {
    respond([
      [['rev-parse', '--abbrev-ref', 'HEAD'], ok('dev\n')],
      [['status', '--porcelain'], ok('')],
      [['rev-parse', '--verify', 'main'], ok('abc123\n')],
      [['checkout', 'main'], fail('fatal: something else broke')],
    ]);

    expect(await gitCheckout(REPO, 'main')).toEqual({
      success: false,
      error: 'fatal: something else broke',
    });
  });
});

describe('classifyGitFailure', () => {
  it('recognises a non-fast-forward push', async () => {
    const stderr = [
      'To https://github.com/acme/lit-review.git',
      ' ! [rejected]        HEAD -> dev (fetch first)',
      "error: failed to push some refs to 'https://github.com/acme/lit-review.git'",
    ].join('\n');
    expect(await classifyGitFailure(stderr)).toBe(REJECTED_FETCH_FIRST);
  });

  it('recognises rejected credentials', async () => {
    expect(
      await classifyGitFailure(
        "fatal: Authentication failed for 'https://github.com/acme/lit-review.git/'",
      ),
    ).toBe(AUTH_FAILED);
  });

  it('recognises transport failures dugite does not classify itself', async () => {
    expect(
      await classifyGitFailure(
        "fatal: unable to access 'https://github.com/acme/x.git/': Could not resolve host: github.com",
      ),
    ).toBe(OFFLINE);
    expect(
      await classifyGitFailure(
        "fatal: unable to access 'https://github.com/acme/x.git/': Failed to connect to github.com port 443: Operation timed out",
      ),
    ).toBe(OFFLINE);
  });

  it('treats git\'s own low-speed abort as offline', async () => {
    expect(
      await classifyGitFailure(
        "fatal: unable to access 'https://github.com/acme/x.git/': Operation too slow. Less than 1000 bytes/sec transferred the last 30 seconds",
      ),
    ).toBe(OFFLINE);
  });

  it('leaves unrecognised failures unclassified', async () => {
    expect(await classifyGitFailure('fatal: something entirely new')).toBeNull();
    expect(await classifyGitFailure('')).toBeNull();
  });
});

describe('remote operation results', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('gitPush returns a code, not stderr, for a non-fast-forward push', async () => {
    exec.mockResolvedValue(
      fail(
        ' ! [rejected]        HEAD -> dev (fetch first)\n' +
          "error: failed to push some refs to 'https://github.com/acme/x.git'",
      ),
    );
    expect(await gitPush(REPO, 'tok')).toEqual({
      success: false,
      error: REJECTED_FETCH_FIRST,
    });
  });

  it('gitFetch reports offline instead of raw stderr', async () => {
    exec.mockResolvedValue(
      fail("fatal: unable to access 'https://github.com/acme/x.git/': Could not resolve host: github.com"),
    );
    expect(await gitFetch(REPO, 'tok')).toEqual({ success: false, error: OFFLINE });
  });

  it('passes an unclassifiable push failure through verbatim', async () => {
    exec.mockResolvedValue(fail('fatal: the remote hiccuped'));
    expect(await gitPush(REPO, 'tok')).toEqual({
      success: false,
      error: 'fatal: the remote hiccuped',
    });
  });
});

describe('branch retirement', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('deletes the branch on the remote', async () => {
    exec.mockResolvedValue(ok());
    expect(await gitDeleteRemoteBranch(REPO, 'review/prescreen/t1/alice', 'tok')).toEqual({
      success: true,
    });
    const args = exec.mock.calls[0][0] as string[];
    expect(args.slice(-3)).toEqual(['origin', '--delete', 'review/prescreen/t1/alice']);
  });

  it('treats an already-deleted remote branch as success', async () => {
    // Cleanup runs after every reconciliation, so it has to be idempotent.
    exec.mockResolvedValue(
      fail("error: unable to delete 'review/x': remote ref does not exist"),
    );
    expect(await gitDeleteRemoteBranch(REPO, 'review/x', 'tok')).toEqual({ success: true });
  });

  it('treats a missing local branch as success', async () => {
    exec.mockResolvedValue(fail("error: branch 'review/x' not found."));
    expect(await gitDeleteLocalBranch(REPO, 'review/x')).toEqual({ success: true });
  });

  it('classifies a remote delete that failed for a real reason', async () => {
    exec.mockResolvedValue(
      fail("fatal: Authentication failed for 'https://github.com/acme/x.git/'"),
    );
    expect(await gitDeleteRemoteBranch(REPO, 'review/x', 'tok')).toEqual({
      success: false,
      error: AUTH_FAILED,
    });
  });
});

describe('credential failures', () => {
  it('classifies a rejected token that fell back to a prompt as AUTH_FAILED', async () => {
    expect(
      await classifyGitFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"),
    ).toBe(AUTH_FAILED);
    expect(
      await classifyGitFailure("fatal: could not read Password for 'https://x@github.com': No such device or address"),
    ).toBe(AUTH_FAILED);
  });

  it('classifies an HTTP 401 / 403 as AUTH_FAILED', async () => {
    expect(
      await classifyGitFailure("fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 401"),
    ).toBe(AUTH_FAILED);
    expect(await classifyGitFailure('error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401')).toBe(
      AUTH_FAILED,
    );
  });

  it('gitPull reports AUTH_FAILED for a revoked token', async () => {
    exec.mockReset();
    exec.mockResolvedValue(fail("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
    expect(await gitPull(REPO, 'revoked')).toEqual({ success: false, error: AUTH_FAILED });
  });
});

describe('network git invocation', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('never prompts and never consults a credential helper', async () => {
    exec.mockResolvedValue(ok());
    await gitFetch(REPO, 'tok');

    const fetchCall = exec.mock.calls.find(([args]) => (args as string[]).includes('fetch'))!;
    const [args, , options] = fetchCall as [string[], string, { env: Record<string, string> }];
    expect(args.slice(0, 2)).toEqual(['-c', 'credential.helper=']);
    expect(args).toContain('http.lowSpeedLimit=1000');
    expect(args).toContain('http.lowSpeedTime=30');
    expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(options.env.GIT_ASKPASS).toBe('');
  });

  it('applies to every command that talks to the remote', async () => {
    exec.mockResolvedValue(ok());
    await gitPull(REPO, 'tok');
    await gitPush(REPO, 'tok');
    await gitClone('https://github.com/a/b.git', '/tmp/b', 'tok');
    for (const [args, , options] of exec.mock.calls as [string[], string, { env?: Record<string, string> }][]) {
      if (!['pull', 'push', 'clone'].some((c) => args.includes(c))) continue;
      expect(args).toContain('credential.helper=');
      expect(options.env?.GIT_TERMINAL_PROMPT).toBe('0');
    }
  });
});

describe('network timeout', () => {
  beforeEach(() => {
    exec.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A git that never answers; like execFile it rejects once its signal aborts. */
  function hangingGit(): { killed: () => boolean } {
    let killed = false;
    exec.mockImplementation(
      (_args: string[], _cwd: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            killed = true;
            reject(Object.assign(new Error('The operation was aborted'), { code: 'ABORT_ERR' }));
          });
        }),
    );
    return { killed: () => killed };
  }

  it('kills a fetch that hangs and reports OFFLINE', async () => {
    const git = hangingGit();
    // `before` snapshot is a local for-each-ref: let it answer.
    exec.mockImplementationOnce(() => Promise.resolve(ok('')));
    const result = gitFetch(REPO, 'tok');
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1);
    expect(await result).toEqual({ success: false, error: OFFLINE });
    expect(git.killed()).toBe(true);
  });

  it('does not fire before the timeout', async () => {
    const git = hangingGit();
    const result = gitPush(REPO, 'tok');
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(git.killed()).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await result).toEqual({ success: false, error: OFFLINE });
  });

  it('gives clone a longer allowance than fetch', async () => {
    const git = hangingGit();
    const result = gitClone('https://github.com/a/b.git', '/tmp/b', 'tok');
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(git.killed()).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await result).toEqual({ success: false, error: OFFLINE });
  });

  it('still rethrows a git that failed to launch', async () => {
    exec.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(gitPush(REPO, 'tok')).rejects.toThrow('ENOENT');
  });
});

describe('remote failure fallback', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('uses the fallback message when git printed nothing', async () => {
    exec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });
    expect(await gitPush(REPO, 'tok')).toEqual({ success: false, error: 'Push failed' });
    expect(await gitPull(REPO, 'tok')).toEqual({ success: false, error: 'Pull failed' });
  });
});

describe('gitFastForwardMain', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('reports DIVERGED only when main is really not an ancestor', async () => {
    respond([
      [['-c'], ok()],
      [['merge-base', '--is-ancestor', 'main', 'origin/main'], { exitCode: 1, stdout: '', stderr: '' }],
    ]);
    expect(await gitFastForwardMain(REPO, 'tok')).toEqual({ success: false, error: DIVERGED });
  });

  it('does not call a missing ref a divergence', async () => {
    respond([
      [['-c'], ok()],
      [
        ['merge-base', '--is-ancestor', 'main', 'origin/main'],
        { exitCode: 128, stdout: '', stderr: 'fatal: Not a valid object name origin/main\n' },
      ],
    ]);
    expect(await gitFastForwardMain(REPO, 'tok')).toEqual({
      success: false,
      error: 'fatal: Not a valid object name origin/main',
    });
  });

  it('falls back to a message when a missing ref prints nothing', async () => {
    respond([
      [['-c'], ok()],
      [['merge-base', '--is-ancestor', 'main', 'origin/main'], { exitCode: 128, stdout: '', stderr: '' }],
    ]);
    const result = await gitFastForwardMain(REPO, 'tok');
    expect(result.success).toBe(false);
    expect(result.error).not.toBe(DIVERGED);
    expect(result.error).toMatch(/missing/);
  });
});

describe('gitListBranches', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('hides origin/HEAD, which git prints as a branch named "origin"', async () => {
    const line = (ref: string, upstream = '', track = '') => `${ref}\t${upstream}\t${track}\t2026-11-01 10:00:00 +0000`;
    respond([
      [['rev-parse', '--abbrev-ref', 'HEAD'], ok('dev\n')],
      [
        ['branch', '-a'],
        ok(
          [
            line('refs/heads/dev', 'origin/dev', '[ahead 1]'),
            line('refs/heads/main', 'origin/main'),
            line('refs/remotes/origin/HEAD'),
            line('refs/remotes/origin/dev'),
            line('refs/remotes/origin/main'),
            line('refs/remotes/origin/review/x'),
            '(HEAD detached at abc123)\t\t\t2026-11-01 10:00:00 +0000',
          ].join('\n') + '\n',
        ),
      ],
    ]);

    const result = await gitListBranches(REPO);

    expect(result.success).toBe(true);
    expect(result.branches.map((b) => b.name)).toEqual(['dev', 'main', 'review/x']);
    expect(result.branches.find((b) => b.name === 'dev')).toMatchObject({ current: true, ahead: 1 });
    expect(result.branches.find((b) => b.name === 'review/x')?.remote).toBe(true);
  });

  it('keeps a branch whose name merely contains HEAD', async () => {
    respond([
      [['rev-parse', '--abbrev-ref', 'HEAD'], ok('main\n')],
      [['branch', '-a'], ok('refs/heads/main\t\t\t2026-11-01\nrefs/heads/AHEAD-fix\t\t\t2026-11-01\n')],
    ]);
    const result = await gitListBranches(REPO);
    expect(result.branches.map((b) => b.name)).toEqual(['main', 'AHEAD-fix']);
  });
});
