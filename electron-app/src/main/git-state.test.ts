import { describe, it, expect, vi } from 'vitest';
import { GitStateManager, stripUrlUserinfo, type GitStateSnapshot } from './git-state';

function rpcGit(overrides: Record<string, unknown> = {}) {
  return {
    git: {
      branch: 'dev',
      ahead: 2,
      behind: 1,
      main_ahead: 0,
      main_behind: 3,
      is_clean: false,
      remote_url: 'https://github.com/acme/lit-review.git',
      uncommitted_changes: 1,
      modified_files: ['data/records.bib'],
      staged_files: [],
      untracked_files: ['notes.md'],
      staged_record_changes: [{ record_id: 'rec1', change_type: 'modified' }],
      last_commit: {
        hash: 'abc123def',
        short_hash: 'abc123d',
        message: 'Prescreen decisions',
        author: 'Alice',
        timestamp: '2026-01-01T00:00:00Z',
      },
      ...overrides,
    },
  };
}

function manager(opts: {
  rpc?: () => Promise<unknown>;
  hasMergeConflict?: () => Promise<boolean>;
} = {}) {
  const emitted: GitStateSnapshot[] = [];
  const mgr = new GitStateManager({
    callBackend: (opts.rpc ?? (async () => rpcGit())) as never,
    hasMergeConflict: opts.hasMergeConflict ?? (async () => false),
    emit: (s) => emitted.push(s),
    now: () => 1_700_000_000_000,
  });
  return { mgr, emitted };
}

describe('GitStateManager', () => {
  it('builds one snapshot from the RPC plus the merge-conflict flag', async () => {
    const { mgr, emitted } = manager({ hasMergeConflict: async () => true });

    const snapshot = await mgr.refresh('lit-review', '/repo');

    expect(snapshot).toEqual({
      projectId: 'lit-review',
      branch: 'dev',
      ahead: 2,
      behind: 1,
      mainAhead: 0,
      mainBehind: 3,
      isClean: false,
      remoteUrl: 'https://github.com/acme/lit-review.git',
      hasMergeConflict: true,
      uncommittedChanges: 1,
      modifiedFiles: ['data/records.bib'],
      stagedFiles: [],
      untrackedFiles: ['notes.md'],
      stagedRecordChanges: [{ recordId: 'rec1', changeType: 'modified' }],
      lastCommit: {
        hash: 'abc123def',
        shortHash: 'abc123d',
        message: 'Prescreen decisions',
        author: 'Alice',
        timestamp: '2026-01-01T00:00:00Z',
      },
      refreshedAt: 1_700_000_000_000,
    });
    expect(emitted).toEqual([snapshot]);
  });

  it('strips credentials from the remote URL before it leaves the main process', async () => {
    const { mgr } = manager({
      rpc: async () =>
        rpcGit({ remote_url: 'https://x-access-token:ghp_secret@github.com/acme/x.git' }),
    });

    const snapshot = await mgr.refresh('p', '/repo');
    expect(snapshot.remoteUrl).toBe('https://github.com/acme/x.git');
    expect(snapshot.remoteUrl).not.toContain('ghp_secret');
  });

  it('keeps one snapshot per project', async () => {
    const branches = ['dev', 'review/prescreen/t1/alice'];
    let i = 0;
    const { mgr } = manager({ rpc: async () => rpcGit({ branch: branches[i++] }) });

    await mgr.refresh('alpha', '/a');
    await mgr.refresh('beta', '/b');

    expect(mgr.get('alpha')?.branch).toBe('dev');
    expect(mgr.get('beta')?.branch).toBe('review/prescreen/t1/alice');
    expect(mgr.get('gamma')).toBeNull();
  });

  it('does not let a merge-conflict read failure invalidate the snapshot', async () => {
    const { mgr } = manager({
      hasMergeConflict: async () => {
        throw new Error('mid-rebase');
      },
    });

    await expect(mgr.refresh('p', '/repo')).resolves.toMatchObject({
      hasMergeConflict: false,
      branch: 'dev',
    });
  });

  it('keeps the previous snapshot when a refresh fails', async () => {
    let fail = false;
    const { mgr, emitted } = manager({
      rpc: async () => {
        if (fail) throw new Error('backend down');
        return rpcGit();
      },
    });

    await mgr.refresh('p', '/repo');
    fail = true;
    await expect(mgr.refresh('p', '/repo')).rejects.toThrow('backend down');

    expect(mgr.get('p')?.branch).toBe('dev');
    expect(emitted).toHaveLength(1);
  });

  it('rejects a response with no git payload rather than inventing defaults', async () => {
    const { mgr } = manager({ rpc: async () => ({ success: false, git: null }) });
    await expect(mgr.refresh('p', '/repo')).rejects.toThrow(/no git state/);
  });

  it('forgets a project on request', async () => {
    const { mgr } = manager();
    await mgr.refresh('p', '/repo');
    mgr.forget('p');
    expect(mgr.get('p')).toBeNull();
  });
});

describe('stripUrlUserinfo', () => {
  it('removes only the userinfo segment', () => {
    expect(stripUrlUserinfo('https://user:pw@example.com/a/b.git')).toBe(
      'https://example.com/a/b.git',
    );
    expect(stripUrlUserinfo('https://example.com/a/b.git')).toBe('https://example.com/a/b.git');
    expect(stripUrlUserinfo('git@github.com:acme/x.git')).toBe('git@github.com:acme/x.git');
  });
});

describe('git snapshot refresh after mutations', () => {
  it('refreshes after a mutating handler while the mutex is still held', async () => {
    // Guards the wiring in ipc/git-handlers.ts: a checkout that does not
    // rebuild the snapshot leaves the renderer showing the old branch.
    const { createGitHandlers } = await import('./ipc/git-handlers');
    const refreshGitState = vi.fn(async () => null);

    const specs = createGitHandlers({
      git: { checkout: async () => ({ success: true }), log: async () => ({ success: true, commits: [] }) } as never,
      getToken: () => null,
      callBackend: async () => ({}) as never,
      refreshGitState,
      getGitState: () => null,
    });
    const handlers = new Map(specs.map((s) => [s.channel, s.handler]));
    const noEvent = undefined as unknown as Electron.IpcMainInvokeEvent;

    await handlers.get('git:checkout')!(noEvent, '/projects/lit-review', 'dev');
    expect(refreshGitState).toHaveBeenCalledWith('lit-review', '/projects/lit-review');

    // Read-only handlers leave the snapshot alone.
    refreshGitState.mockClear();
    await handlers.get('git:log')!(noEvent, '/projects/lit-review');
    expect(refreshGitState).not.toHaveBeenCalled();
  });
});
