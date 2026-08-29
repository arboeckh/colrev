import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `git-manager` resolves dugite lazily (`await import('dugite')`) inside every
 * function, so a module mock is enough to drive the exec results per test.
 */
const exec = vi.fn();
vi.mock('dugite', () => ({ exec: (...args: unknown[]) => exec(...args) }));

import { gitCheckout, DIRTY_WORKTREE } from './git-manager';

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
