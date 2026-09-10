import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSyncStore } from './sync';
import { useGitStore } from './git';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import { useBackendStore } from './backend';
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
    fastForwardMain: vi.fn().mockResolvedValue(ok),
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

  it('never auto-pulls a diverged repo — that is the merge flow’s decision', async () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ ahead: 2, behind: 3 }));
    const ops = stubRemoteOps();
    const sync = useSyncStore();

    await sync.tick();

    expect(ops.pull).not.toHaveBeenCalled();
    expect(ops.push).not.toHaveBeenCalled();
    expect(sync.escalation).toBe('diverged');
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
    const second = await sync.pullNow();

    expect(second).toBe(false);
    resolvePull(true);
    await first;
  });

  it('stop() clears suspensions so a stale hold cannot wedge the next project', () => {
    const sync = useSyncStore();
    sync.suspend('walkthrough');
    expect(sync.isSuspended).toBe(true);

    sync.stop();

    expect(sync.isSuspended).toBe(false);
    expect(sync.isRunning).toBe(false);
  });
});
