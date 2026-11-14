import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSyncStore } from './sync';
import { useGitStore } from './git';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import { useBackendStore } from './backend';
import { useConnectionStore } from './connection';
import { useAuthStore } from './auth';
import type { GitStateSnapshot } from '@/types/window';

function snapshot(overrides: Partial<GitStateSnapshot> = {}): GitStateSnapshot {
  return {
    projectId: 'lit-review',
    branch: 'dev',
    ahead: 0,
    behind: 0,
    mainAhead: 0,
    mainBehind: 0,
    isClean: true,
    remoteUrl: 'https://github.com/acme/lit-review.git',
    hasMergeConflict: false,
    uncommittedChanges: 0,
    modifiedFiles: [],
    stagedFiles: [],
    untrackedFiles: [],
    stagedRecordChanges: [],
    lastCommit: null,
    refreshedAt: 1,
    ...overrides,
  };
}

/** Replace the git store's remote primitives with spies. */
function stubRemoteOps(ok = true) {
  const git = useGitStore();
  const ops = {
    fetch: vi.fn().mockResolvedValue(ok),
    pull: vi.fn().mockResolvedValue(ok),
    push: vi.fn().mockResolvedValue(ok),
    pushBranch: vi.fn().mockResolvedValue(ok),
    fastForwardMain: vi.fn().mockResolvedValue(ok),
    tryAutoResolveDivergence: vi.fn().mockResolvedValue(ok),
  };
  // The store exposes these as a plain object; swapping it is how a test
  // drives the coordinator without a real repo.
  Object.assign(git.__remoteOps, ops);
  return ops;
}

describe('sync coordinator', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useProjectsStore().currentProjectId = 'lit-review';
    // The coordinator only ticks against a live backend and an open project.
    useBackendStore().status = 'running';
    localStorage.clear();
  });

  it('pulls automatically when the pull is a fast-forward', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    await sync.tick();

    expect(ops.pull).toHaveBeenCalledOnce();
  });

  it('tells the user what it pulled — silence about a changed view is worse', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3 }));
    stubRemoteOps();
    const notifications = useNotificationsStore();
    const sync = useSyncStore();

    await sync.tick();

    expect(notifications.history.some((n) => n.title.includes('3 changes'))).toBe(true);
  });

  it('never auto-pulls over uncommitted work', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3, isClean: false, uncommittedChanges: 2 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    await sync.tick();

    expect(ops.pull).not.toHaveBeenCalled();
    expect(sync.escalation).toBe('dirty-blocks-pull');
  });

  it('never pulls or pushes a diverged repo — it goes through the merge engine', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ ahead: 2, behind: 3 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    await sync.tick();

    expect(ops.pull).not.toHaveBeenCalled();
    expect(ops.push).not.toHaveBeenCalled();
    expect(ops.tryAutoResolveDivergence).toHaveBeenCalledOnce();
  });

  it('leaves a diverged dirty tree alone — `apply_merge` would commit it', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ ahead: 2, behind: 3, isClean: false, uncommittedChanges: 1 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    // A never-fetched coordinator fetches first — it outranks everything that
    // is only waiting. Get that out of the way so the tick under test decides.
    await sync.fetchNow();
    await sync.tick();

    expect(ops.tryAutoResolveDivergence).not.toHaveBeenCalled();
    expect(sync.escalation).toBe('diverged');
    expect(sync.lastIdleReason).toBe('diverged-dirty');
  });

  it('stops re-analysing a divergence the engine already refused', async () => {
    vi.useFakeTimers();
    try {
      const git = useGitStore();
      git.applySnapshot(snapshot({ ahead: 2, behind: 3 }));
      const ops = stubRemoteOps();
      ops.tryAutoResolveDivergence.mockResolvedValue(false);
      const sync = useSyncStore();
      await sync.fetchNow();

      await sync.tick();
      await sync.tick();
      expect(ops.tryAutoResolveDivergence).toHaveBeenCalledOnce();
      expect(sync.lastIdleReason).toBe('resolve-cooldown');

      vi.advanceTimersByTime(61_000);
      await sync.tick();
      expect(ops.tryAutoResolveDivergence).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets an explicit Sync now retry a divergence the cooldown is holding', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ ahead: 2, behind: 3 }));
    const ops = stubRemoteOps();
    ops.tryAutoResolveDivergence.mockResolvedValue(false);
    const sync = useSyncStore();

    await sync.tick();
    expect(ops.tryAutoResolveDivergence).toHaveBeenCalledOnce();

    await sync.syncNow();

    expect(ops.tryAutoResolveDivergence).toHaveBeenCalledTimes(2);
  });

  it('holds a pull while a suspension is registered, and resumes after release', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    const release = sync.suspend('walkthrough');
    await sync.tick();
    expect(ops.pull).not.toHaveBeenCalled();

    release();
    await sync.tick();
    expect(ops.pull).toHaveBeenCalledOnce();
  });

  it('releases a suspension only once, so a double release cannot unblock another hold', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    const releaseA = sync.suspend('walkthrough');
    const releaseB = sync.suspend('dialog');
    releaseA();
    releaseA();

    await sync.tick();
    expect(ops.pull).not.toHaveBeenCalled();

    releaseB();
    await sync.tick();
    expect(ops.pull).toHaveBeenCalledOnce();
  });

  it('debounces the push so a decision streak becomes one push', async () => {
    vi.useFakeTimers();
    try {
      const git = useGitStore();
      git.applySnapshot(snapshot({ ahead: 1 }));
      const ops = stubRemoteOps();
      const sync = useSyncStore();

      await sync.tick();
      expect(ops.push).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10_000);
      await sync.tick();
      expect(ops.push).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The reported symptom: a commit landed, the push counter stayed put, and
   * nothing happened for long enough to look broken. Sampling `ahead` on the
   * 5s tick meant the debounce could not start until the tick after the
   * commit, so the true wait was the tick plus the debounce.
   */
  it('schedules the push off the commit itself, not the next tick', async () => {
    vi.useFakeTimers();
    try {
      const git = useGitStore();
      git.applySnapshot(snapshot());
      const ops = stubRemoteOps();
      const sync = useSyncStore();
      sync.start();
      ops.fetch.mockClear();

      git.applySnapshot(snapshot({ ahead: 1, refreshedAt: 2 }));
      await vi.advanceTimersByTimeAsync(2_100);

      expect(ops.push).toHaveBeenCalledOnce();
      sync.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes a merge it made itself, once the debounce has run', async () => {
    vi.useFakeTimers();
    try {
      const git = useGitStore();
      git.applySnapshot(snapshot({ ahead: 2, behind: 3 }));
      const ops = stubRemoteOps();
      const sync = useSyncStore();
      await sync.fetchNow();

      await sync.tick();
      expect(ops.tryAutoResolveDivergence).toHaveBeenCalledOnce();

      // The engine merged and pushed; a merge commit that failed to reach the
      // remote leaves the branch ahead, which the debounce then covers.
      git.applySnapshot(snapshot({ ahead: 1, behind: 0 }));
      vi.advanceTimersByTime(3_000);
      await sync.tick();

      expect(ops.push).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing at all without a remote', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3, remoteUrl: null }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    await sync.tick();

    expect(ops.pull).not.toHaveBeenCalled();
    expect(ops.fetch).not.toHaveBeenCalled();
    expect(sync.lastIdleReason).toBe('no-remote');
  });

  it('honours the auto-pull preference and persists it', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    sync.setAutoPull(false);
    await sync.tick();

    expect(ops.pull).not.toHaveBeenCalled();
    expect(localStorage.getItem('sync.autoPull')).toBe('false');
    expect(sync.escalation).toBe('behind-auto-disabled');
  });

  it('runs one remote operation at a time', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ behind: 3 }));
    const git2 = useGitStore();
    let resolvePull: (v: boolean) => void = () => {};
    git2.__remoteOps.pull = vi.fn(
      () => new Promise<boolean>((r) => { resolvePull = r; }),
    );
    const sync = useSyncStore();

    const first = sync.pullNow();
    const second = sync.pullNow();
    await Promise.resolve();

    // The second pull waits its turn instead of running alongside the first.
    expect(git2.__remoteOps.pull).toHaveBeenCalledTimes(1);
    resolvePull(true);
    await first;
    await expect.poll(() => (git2.__remoteOps.pull as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    resolvePull(true);
    expect(await second).toBe(true);
  });

  it('never drops a push that arrives while a background fetch is running', async () => {
    // A launch pushes dev so the co-reviewer sees the new task; a reviewer's
    // "Save to remote" pushes their decisions. Either one landing while the
    // loop happened to be fetching used to return without pushing anything.
    const git = useGitStore();
    git.applySnapshot(snapshot({ ahead: 1 }));
    const ops = stubRemoteOps();
    let finishFetch: (v: boolean) => void = () => {};
    ops.fetch.mockImplementation(() => new Promise<boolean>((r) => { finishFetch = r; }));
    const sync = useSyncStore();

    const fetching = sync.fetchNow();
    const pushing = sync.pushNow();
    await Promise.resolve();
    expect(ops.push).not.toHaveBeenCalled();

    finishFetch(true);
    await fetching;
    expect(await pushing).toBe(true);
    expect(ops.push).toHaveBeenCalledTimes(1);
  });

  it('shares a fetch that is already running instead of fetching twice', async () => {
    const ops = stubRemoteOps();
    let finishFetch: (v: boolean) => void = () => {};
    ops.fetch.mockImplementation(() => new Promise<boolean>((r) => { finishFetch = r; }));
    const sync = useSyncStore();

    const first = sync.fetchNow();
    const second = sync.fetchNow();
    finishFetch(true);

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(ops.fetch).toHaveBeenCalledTimes(1);
  });

  it('stop() clears suspensions so a stale hold cannot wedge the next project', () => {
    const sync = useSyncStore();
    sync.suspend('walkthrough');
    expect(sync.isSuspended).toBe(true);

    sync.stop();

    expect(sync.isSuspended).toBe(false);
    expect(sync.isRunning).toBe(false);
  });

  describe('a failed push', () => {
    /** The debounce starts at the first tick that sees the branch ahead. */
    async function afterDebounce(fn: () => Promise<void>): Promise<void> {
      await fn();
      vi.advanceTimersByTime(10_000);
      await fn();
    }

    it('is not retried — or toasted — on every tick', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ ahead: 1 }));
        const ops = stubRemoteOps();
        await useSyncStore().fetchNow();
        const sync = useSyncStore();
        const error = vi.spyOn(useNotificationsStore(), 'error');
        ops.push.mockImplementation(async () => {
          git.lastPushError = 'something unclassified';
          return false;
        });

        await afterDebounce(() => sync.tick());
        // A minute of ticks used to mean twelve pushes and twelve toasts; the
        // first retry is due after 15s, so nothing happens inside 10s.
        for (let i = 0; i < 2; i++) {
          vi.advanceTimersByTime(5_000);
          await sync.tick();
        }

        expect(ops.push).toHaveBeenCalledOnce();
        expect(sync.lastIdleReason).toBe('push-backoff');
        // Reported once, by the coordinator, not once per attempt.
        expect(error).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries after the backoff, with a longer wait after each failure', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ ahead: 1 }));
        const ops = stubRemoteOps(false);
        ops.fetch.mockResolvedValue(true);
        const sync = useSyncStore();
        await sync.fetchNow();

        await afterDebounce(() => sync.tick());
        expect(ops.push).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(15_000);
        await sync.tick();
        expect(ops.push).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(15_000);
        await sync.tick();
        expect(ops.push).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(15_000);
        await sync.tick();
        expect(ops.push).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('fetches after a rejection so the policy can pull or resolve, without a toast', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ ahead: 1 }));
        const ops = stubRemoteOps();
        const sync = useSyncStore();
        await sync.fetchNow();
        const error = vi.spyOn(useNotificationsStore(), 'error');
        ops.push.mockImplementation(async () => {
          git.lastPushError = 'REJECTED_FETCH_FIRST';
          return false;
        });

        await afterDebounce(() => sync.tick());
        expect(ops.push).toHaveBeenCalledOnce();
        ops.fetch.mockClear();

        vi.advanceTimersByTime(5_000);
        // The fetch is what shows the collaborator's commit.
        ops.fetch.mockImplementation(async () => {
          git.applySnapshot(snapshot({ ahead: 1, behind: 1, refreshedAt: 3 }));
          return true;
        });
        await sync.tick();
        expect(ops.fetch).toHaveBeenCalledOnce();

        await sync.tick();
        expect(ops.tryAutoResolveDivergence).toHaveBeenCalledOnce();
        expect(ops.push).toHaveBeenCalledOnce();
        expect(error).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops automatic pushes on a rejected credential until the user signs in again', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ ahead: 1 }));
        const ops = stubRemoteOps();
        const sync = useSyncStore();
        await sync.fetchNow();
        ops.push.mockImplementation(async () => {
          git.lastPushError = 'AUTH_FAILED';
          return false;
        });

        await afterDebounce(() => sync.tick());
        expect(sync.problem?.kind).toBe('auth');

        vi.advanceTimersByTime(3_600_000);
        await sync.fetchNow();
        await sync.tick();
        await sync.tick();
        expect(ops.push).toHaveBeenCalledOnce();
        expect(sync.lastIdleReason).toBe('push-auth-failed');

        // A new session: the credential may work now.
        useAuthStore().session = {
          user: { login: 'alice', name: null, avatarUrl: '', email: null },
          authenticatedAt: new Date().toISOString(),
        };
        await vi.advanceTimersByTimeAsync(0);
        ops.push.mockResolvedValue(true);
        await sync.tick();
        expect(ops.push).toHaveBeenCalledTimes(2);
        expect(sync.problem).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not record "offline" as a push failure — it goes out the moment the network is back', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ ahead: 1 }));
        const ops = stubRemoteOps();
        const sync = useSyncStore();
        await sync.fetchNow();
        ops.push.mockImplementationOnce(async () => {
          git.lastPushError = 'OFFLINE';
          return false;
        });

        await afterDebounce(() => sync.tick());

        expect(sync.pushFailure).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets an explicit Sync now try again at once', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ ahead: 1 }));
        const ops = stubRemoteOps();
        const sync = useSyncStore();
        await sync.fetchNow();
        ops.push.mockImplementationOnce(async () => {
          git.lastPushError = 'AUTH_FAILED';
          return false;
        });
        await afterDebounce(() => sync.tick());
        expect(ops.push).toHaveBeenCalledOnce();

        await sync.syncNow();

        expect(ops.push).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('offline', () => {
    it('probes with a fetch, and a success clears the flag so everything resumes', async () => {
      const git = useGitStore();
      git.applySnapshot(snapshot({ behind: 2 }));
      const ops = stubRemoteOps();
      const connection = useConnectionStore();
      const sync = useSyncStore();
      connection.markOffline();
      ops.fetch.mockImplementation(async () => {
        connection.markOnline();
        return true;
      });

      await sync.tick();
      expect(ops.fetch).toHaveBeenCalledOnce();
      expect(connection.isOnline).toBe(true);

      await sync.tick();
      expect(ops.pull).toHaveBeenCalledOnce();
    });

    it('backs off between probes while the remote stays unreachable', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot());
        const ops = stubRemoteOps(false);
        const connection = useConnectionStore();
        const sync = useSyncStore();
        connection.markOffline();

        await sync.tick();
        await sync.tick();
        await sync.tick();
        expect(ops.fetch).toHaveBeenCalledOnce();
        expect(sync.lastIdleReason).toBe('offline');

        vi.advanceTimersByTime(15_000);
        await sync.tick();
        expect(ops.fetch).toHaveBeenCalledTimes(2);
        // The second failure doubles the wait.
        vi.advanceTimersByTime(15_000);
        await sync.tick();
        expect(ops.fetch).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(15_000);
        await sync.tick();
        expect(ops.fetch).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries at once when the browser reports the connection is back', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot());
        const ops = stubRemoteOps();
        const connection = useConnectionStore();
        const sync = useSyncStore();
        sync.start();
        await vi.advanceTimersByTimeAsync(0);
        ops.fetch.mockClear();
        sync.lastFetchAt = null;
        connection.markOffline();
        sync.fetchFailure = { at: Date.now(), count: 4 };

        connection.markOnline();
        await vi.advanceTimersByTimeAsync(0);

        expect(sync.fetchFailure).toBeNull();
        expect(ops.fetch).toHaveBeenCalled();
        sync.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('the automatic pull', () => {
    it('is quiet and backs off when the engine refuses it', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ behind: 2 }));
        const ops = stubRemoteOps();
        const sync = useSyncStore();
        await sync.fetchNow();
        const error = vi.spyOn(useNotificationsStore(), 'error');
        ops.pull.mockImplementation(async () => {
          git.lastPullError = 'DIRTY_WORKTREE';
          return false;
        });

        await sync.tick();
        await sync.tick();
        await sync.tick();

        expect(ops.pull).toHaveBeenCalledOnce();
        expect(ops.pull).toHaveBeenCalledWith({ quiet: true });
        expect(error).not.toHaveBeenCalled();
        expect(sync.lastIdleReason).toBe('pull-backoff');
        expect(sync.problem?.kind).toBe('pull');
      } finally {
        vi.useRealTimers();
      }
    });

    it('goes ahead again once the situation changes — a saved tree is worth a retry', async () => {
      vi.useFakeTimers();
      try {
        const git = useGitStore();
        git.applySnapshot(snapshot({ behind: 2 }));
        const ops = stubRemoteOps();
        const sync = useSyncStore();
        await sync.fetchNow();
        ops.pull.mockImplementationOnce(async () => {
          git.lastPullError = 'DIRTY_WORKTREE';
          return false;
        });
        await sync.tick();

        // The user saves their work: the snapshot goes dirty-then-clean, each
        // arriving on its own.
        git.applySnapshot(snapshot({ behind: 2, isClean: false, refreshedAt: 2 }));
        await vi.advanceTimersByTimeAsync(0);
        git.applySnapshot(snapshot({ behind: 2, isClean: true, refreshedAt: 3 }));
        await vi.advanceTimersByTimeAsync(0);
        await sync.tick();

        expect(ops.pull).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('a published main the remote never received', () => {
    it('is pushed by the loop although main is not checked out, and announced once it lands', async () => {
      const git = useGitStore();
      git.applySnapshot(snapshot({ branch: 'dev', mainAhead: 1 }));
      const ops = stubRemoteOps();
      ops.pushBranch.mockResolvedValue(true);
      const success = vi.spyOn(useNotificationsStore(), 'success');
      const sync = useSyncStore();

      await sync.tick();

      expect(ops.pushBranch).toHaveBeenCalledWith('main', { quiet: true });
      expect(success).toHaveBeenCalledWith('Version published', expect.any(String));
    });

    it('backs off when the push fails and does not retry on every tick', async () => {
      const git = useGitStore();
      git.applySnapshot(snapshot({ branch: 'dev', mainAhead: 1 }));
      stubRemoteOps();
      const pushBranch = vi.fn(async () => {
        git.lastPushBranchError = 'something unclassified';
        return false;
      });
      Object.assign(git.__remoteOps, { pushBranch });
      const sync = useSyncStore();

      await sync.tick();
      await sync.tick();
      await sync.tick();

      expect(pushBranch).toHaveBeenCalledOnce();
      expect(sync.problem?.kind).toBe('push');
    });

    it('does not push a main that has diverged — that needs combining, and the banner says so', async () => {
      const git = useGitStore();
      git.applySnapshot(snapshot({ branch: 'dev', mainAhead: 1, mainBehind: 2 }));
      stubRemoteOps();
      const pushBranch = vi.fn().mockResolvedValue(true);
      Object.assign(git.__remoteOps, { pushBranch });
      const sync = useSyncStore();

      await sync.tick();

      expect(pushBranch).not.toHaveBeenCalled();
      expect(sync.escalation).toBe('main-diverged');
    });
  });
});
