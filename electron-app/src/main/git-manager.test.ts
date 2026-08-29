import { describe, it, expect, beforeEach, vi } from 'vitest';

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
