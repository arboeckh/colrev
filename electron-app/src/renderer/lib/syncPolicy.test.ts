import { describe, expect, it } from 'vitest';
import {
  computeSyncEscalation,
  decideAutoSync,
  escalationSeverity,
  isFastForwardPull,
  isFastForwardPush,
  retryDelayMs,
  type SyncPolicyInput,
} from './syncPolicy';

const NOW = 1_000_000;

function input(overrides: Partial<SyncPolicyInput> = {}): SyncPolicyInput {
  return {
    hasRemote: true,
    isOnline: true,
    ahead: 0,
    behind: 0,
    isClean: true,
    hasMergeConflict: false,
    busy: false,
    operationRunning: false,
    suspensions: [],
    autoPullEnabled: true,
    autoPushEnabled: true,
    lastFetchAt: NOW,
    aheadSince: null,
    lastResolveAttemptAt: null,
    now: NOW,
    fetchIntervalMs: 90_000,
    pushDebounceMs: 4_000,
    resolveRetryMs: 60_000,
    pushFailure: null,
    pullFailure: null,
    fetchFailure: null,
    mainPushFailure: null,
    mainUnpushed: false,
    retryBaseMs: 15_000,
    retryMaxMs: 300_000,
    ...overrides,
  };
}

describe('safety predicates', () => {
  it('treats a strictly-behind clean repo as a fast-forward pull', () => {
    expect(isFastForwardPull({ behind: 3, ahead: 0, isClean: true })).toBe(true);
  });

  it('refuses a pull that would have to merge', () => {
    expect(isFastForwardPull({ behind: 3, ahead: 1, isClean: true })).toBe(false);
  });

  it('refuses a pull that would overwrite uncommitted work', () => {
    expect(isFastForwardPull({ behind: 3, ahead: 0, isClean: false })).toBe(false);
  });

  it('allows a push while the tree is dirty — a push moves commits only', () => {
    expect(isFastForwardPush({ ahead: 2, behind: 0 })).toBe(true);
  });

  it('refuses a push the remote would reject', () => {
    expect(isFastForwardPush({ ahead: 2, behind: 1 })).toBe(false);
  });
});

describe('hard blocks', () => {
  it.each([
    ['no remote', { hasRemote: false }, 'no-remote'],
    ['mid-merge', { hasMergeConflict: true }, 'merge-conflict'],
    ['already busy', { busy: true }, 'busy'],
  ])('does nothing when %s', (_label, overrides, reason) => {
    const action = decideAutoSync(input({ behind: 5, ...overrides }));
    expect(action).toEqual({ kind: 'idle', reason });
  });

  it('never auto-pulls over a diverged repo — it resolves instead', () => {
    const action = decideAutoSync(input({ ahead: 2, behind: 3, lastFetchAt: NOW }));
    expect(action).toEqual({ kind: 'resolve' });
  });

  it('never auto-pulls over uncommitted work', () => {
    const action = decideAutoSync(input({ behind: 3, isClean: false, lastFetchAt: NOW }));
    expect(action).toEqual({ kind: 'idle', reason: 'dirty' });
  });
});

describe('holding off', () => {
  it('waits while a writer RPC is running', () => {
    const action = decideAutoSync(input({ behind: 3, operationRunning: true }));
    expect(action).toEqual({ kind: 'idle', reason: 'operation-running' });
  });

  it('waits while a walkthrough holds a suspension', () => {
    const action = decideAutoSync(input({ behind: 3, suspensions: ['walkthrough#a'] }));
    expect(action).toEqual({ kind: 'idle', reason: 'suspended' });
  });

  it('still fetches while suspended, so counts stay honest', () => {
    const action = decideAutoSync(
      input({ behind: 3, suspensions: ['walkthrough#a'], lastFetchAt: NOW - 200_000 }),
    );
    expect(action).toEqual({ kind: 'fetch' });
  });

  it('still fetches while a writer RPC runs', () => {
    const action = decideAutoSync(
      input({ operationRunning: true, lastFetchAt: NOW - 200_000 }),
    );
    expect(action).toEqual({ kind: 'fetch' });
  });
});

describe('resolving a diverged branch', () => {
  it('resolves when the tree is clean and nothing has been tried yet', () => {
    expect(decideAutoSync(input({ ahead: 1, behind: 1 }))).toEqual({ kind: 'resolve' });
  });

  it('refuses to resolve over uncommitted work — `apply_merge` stages everything', () => {
    const action = decideAutoSync(input({ ahead: 1, behind: 1, isClean: false, lastFetchAt: NOW }));
    expect(action).toEqual({ kind: 'idle', reason: 'diverged-dirty' });
  });

  it('rides the auto-pull switch, not the auto-push one', () => {
    const action = decideAutoSync(
      input({ ahead: 1, behind: 1, autoPullEnabled: false, lastFetchAt: NOW }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'auto-pull-disabled' });

    expect(decideAutoSync(input({ ahead: 1, behind: 1, autoPushEnabled: false }))).toEqual({
      kind: 'resolve',
    });
  });

  it('stays quiet for the cooldown after an attempt the engine refused', () => {
    const action = decideAutoSync(
      input({ ahead: 1, behind: 1, lastResolveAttemptAt: NOW - 30_000, lastFetchAt: NOW }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'resolve-cooldown' });
  });

  it('tries again once the cooldown has elapsed', () => {
    const action = decideAutoSync(
      input({ ahead: 1, behind: 1, lastResolveAttemptAt: NOW - 61_000 }),
    );
    expect(action).toEqual({ kind: 'resolve' });
  });

  it('keeps fetching while divergence waits on a human', () => {
    const action = decideAutoSync(
      input({ ahead: 1, behind: 1, isClean: false, lastFetchAt: NOW - 200_000 }),
    );
    expect(action).toEqual({ kind: 'fetch' });
  });
});

describe('the automatic path', () => {
  it('pulls when the pull is a fast-forward', () => {
    expect(decideAutoSync(input({ behind: 3 }))).toEqual({ kind: 'pull' });
  });

  it('prefers pulling over pushing when both are possible', () => {
    // Not reachable with real counts (ahead>0 && behind>0 is divergence), but
    // the ordering is the invariant: read before publishing.
    const action = decideAutoSync(input({ behind: 2, ahead: 0, aheadSince: NOW }));
    expect(action).toEqual({ kind: 'pull' });
  });

  it('pushes once the debounce has elapsed', () => {
    const action = decideAutoSync(input({ ahead: 1, aheadSince: NOW - 5_000 }));
    expect(action).toEqual({ kind: 'push' });
  });

  it('holds the push while the user is still working', () => {
    const action = decideAutoSync(
      input({ ahead: 1, aheadSince: NOW - 1_000, lastFetchAt: NOW }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'push-debounce' });
  });

  it('respects the auto-pull preference', () => {
    const action = decideAutoSync(input({ behind: 3, autoPullEnabled: false }));
    expect(action).toEqual({ kind: 'idle', reason: 'auto-pull-disabled' });
  });

  it('respects the auto-push preference', () => {
    const action = decideAutoSync(
      input({ ahead: 1, aheadSince: NOW - 5_000, autoPushEnabled: false }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'auto-push-disabled' });
  });

  it('fetches on the configured cadence', () => {
    expect(decideAutoSync(input({ lastFetchAt: NOW - 200_000 }))).toEqual({ kind: 'fetch' });
    expect(decideAutoSync(input({ lastFetchAt: null }))).toEqual({ kind: 'fetch' });
  });

  it('sits still when everything is in sync', () => {
    expect(decideAutoSync(input())).toEqual({ kind: 'idle', reason: 'up-to-date' });
  });
});

describe('escalation', () => {
  const base = {
    hasRemote: true,
    ahead: 0,
    behind: 0,
    isClean: true,
    hasMergeConflict: false,
    autoPullEnabled: true,
  };

  it('stays silent when auto-sync is coping', () => {
    expect(computeSyncEscalation({ ...base, behind: 4 })).toBeNull();
    expect(computeSyncEscalation({ ...base, ahead: 4 })).toBeNull();
    expect(computeSyncEscalation(base)).toBeNull();
  });

  it('escalates divergence', () => {
    expect(computeSyncEscalation({ ...base, ahead: 1, behind: 1 })).toBe('diverged');
  });

  it('escalates a dirty tree blocking a pull', () => {
    expect(computeSyncEscalation({ ...base, behind: 2, isClean: false })).toBe(
      'dirty-blocks-pull',
    );
  });

  it('escalates pending changes when the user turned auto-pull off', () => {
    expect(computeSyncEscalation({ ...base, behind: 2, autoPullEnabled: false })).toBe(
      'behind-auto-disabled',
    );
  });

  it('ranks a merge conflict above everything else', () => {
    expect(
      computeSyncEscalation({ ...base, ahead: 1, behind: 1, hasMergeConflict: true }),
    ).toBe('merge-conflict');
  });

  it('only lets the two blocking situations gate an operation', () => {
    expect(escalationSeverity('merge-conflict')).toBe('gate');
    expect(escalationSeverity('diverged')).toBe('gate');
    expect(escalationSeverity('dirty-blocks-pull')).toBe('banner');
    expect(escalationSeverity('behind-auto-disabled')).toBe('banner');
  });
});

describe('offline is probed, not latched', () => {
  it('probes with a fetch while marked offline, so a success can clear the flag', () => {
    expect(decideAutoSync(input({ isOnline: false }))).toEqual({ kind: 'fetch' });
  });

  it('probes even when the last fetch was recent — the flag, not staleness, is the reason', () => {
    expect(decideAutoSync(input({ isOnline: false, lastFetchAt: NOW }))).toEqual({ kind: 'fetch' });
  });

  it('backs off after a failed probe, and probes again once the delay has run', () => {
    const failed = { at: NOW, count: 1 };
    expect(decideAutoSync(input({ isOnline: false, fetchFailure: failed }))).toEqual({
      kind: 'idle',
      reason: 'offline',
    });
    expect(
      decideAutoSync(input({ isOnline: false, fetchFailure: failed, now: NOW + 15_000 })),
    ).toEqual({ kind: 'fetch' });
  });

  it('doubles the probe delay with each failure, up to the ceiling', () => {
    expect(retryDelayMs(1, 15_000, 300_000)).toBe(15_000);
    expect(retryDelayMs(2, 15_000, 300_000)).toBe(30_000);
    expect(retryDelayMs(3, 15_000, 300_000)).toBe(60_000);
    expect(retryDelayMs(30, 15_000, 300_000)).toBe(300_000);
    expect(
      decideAutoSync(
        input({ isOnline: false, fetchFailure: { at: NOW - 20_000, count: 3 } }),
      ),
    ).toEqual({ kind: 'idle', reason: 'offline' });
  });

  it('does not probe while an operation of ours is running', () => {
    expect(decideAutoSync(input({ isOnline: false, busy: true }))).toEqual({
      kind: 'idle',
      reason: 'offline',
    });
  });

  it('does not re-fetch every tick when the remote keeps failing while "online"', () => {
    const action = decideAutoSync(
      input({ lastFetchAt: null, fetchFailure: { at: NOW, count: 1 } }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'up-to-date' });
  });
});

describe('a failed push backs off', () => {
  const ahead = { ahead: 1, behind: 0, aheadSince: NOW - 10_000 };

  it('pushes when nothing has failed', () => {
    expect(decideAutoSync(input(ahead))).toEqual({ kind: 'push' });
  });

  it('waits out the backoff instead of pushing on the next tick', () => {
    const action = decideAutoSync(
      input({ ...ahead, pushFailure: { kind: 'other', at: NOW, count: 1 } }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'push-backoff' });
  });

  it('pushes again once the backoff has run, and backs off longer after more failures', () => {
    const failure = { kind: 'other' as const, at: NOW, count: 2 };
    expect(
      decideAutoSync(input({ ...ahead, pushFailure: failure, now: NOW + 29_000 })),
    ).toEqual({ kind: 'idle', reason: 'push-backoff' });
    expect(
      decideAutoSync(input({ ...ahead, pushFailure: failure, now: NOW + 30_000 })),
    ).toEqual({ kind: 'push' });
  });

  it('still refreshes the counts while it waits', () => {
    const action = decideAutoSync(
      input({
        ...ahead,
        lastFetchAt: NOW - 100_000,
        pushFailure: { kind: 'other', at: NOW, count: 1 },
      }),
    );
    expect(action).toEqual({ kind: 'fetch' });
  });

  it('fetches after a rejected push, because the remote moved on', () => {
    const action = decideAutoSync(
      input({
        ...ahead,
        lastFetchAt: NOW - 1_000,
        pushFailure: { kind: 'rejected', at: NOW, count: 1 },
      }),
    );
    expect(action).toEqual({ kind: 'fetch' });
  });

  it('after that fetch, a rejected push that is still ahead only retries on the backoff', () => {
    const base = { ...ahead, pushFailure: { kind: 'rejected' as const, at: NOW - 1_000, count: 1 } };
    expect(decideAutoSync(input({ ...base, lastFetchAt: NOW }))).toEqual({
      kind: 'idle',
      reason: 'push-backoff',
    });
  });

  it('resolves once the fetch shows the remote moved — the push failure no longer matters', () => {
    const action = decideAutoSync(
      input({
        ahead: 1,
        behind: 2,
        lastFetchAt: NOW,
        pushFailure: { kind: 'rejected', at: NOW - 1_000, count: 1 },
      }),
    );
    expect(action).toEqual({ kind: 'resolve' });
  });

  it('does not hammer a failing fetch after a rejected push', () => {
    const action = decideAutoSync(
      input({
        ...ahead,
        lastFetchAt: null,
        fetchFailure: { at: NOW, count: 1 },
        pushFailure: { kind: 'rejected', at: NOW, count: 1 },
      }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'push-backoff' });
  });

  it('stops pushing for good on a rejected credential, until a sign-in clears it', () => {
    const failure = { kind: 'auth' as const, at: NOW - 3_600_000, count: 1 };
    expect(decideAutoSync(input({ ...ahead, pushFailure: failure }))).toEqual({
      kind: 'idle',
      reason: 'push-auth-failed',
    });
  });

  it('still fetches while the credential is rejected — reading may work, and counts stay honest', () => {
    const action = decideAutoSync(
      input({
        ...ahead,
        lastFetchAt: NOW - 100_000,
        pushFailure: { kind: 'auth', at: NOW - 3_600_000, count: 1 },
      }),
    );
    expect(action).toEqual({ kind: 'fetch' });
  });
});

describe('a refused pull backs off', () => {
  it('does not retry a pull on the next tick', () => {
    const action = decideAutoSync(
      input({ behind: 2, pullFailure: { at: NOW, count: 1 } }),
    );
    expect(action).toEqual({ kind: 'idle', reason: 'pull-backoff' });
  });

  it('pulls again after the delay', () => {
    const action = decideAutoSync(
      input({ behind: 2, pullFailure: { at: NOW - 15_000, count: 1 } }),
    );
    expect(action).toEqual({ kind: 'pull' });
  });
});

describe('a published main that never reached the remote', () => {
  it('pushes main even though it is not the checked-out branch', () => {
    expect(decideAutoSync(input({ mainUnpushed: true }))).toEqual({ kind: 'pushMain' });
  });

  it('respects the auto-push switch', () => {
    const action = decideAutoSync(input({ mainUnpushed: true, autoPushEnabled: false }));
    expect(action).not.toEqual({ kind: 'pushMain' });
  });

  it('backs off after a failed attempt and stops on a rejected credential', () => {
    expect(
      decideAutoSync(
        input({ mainUnpushed: true, mainPushFailure: { kind: 'other', at: NOW, count: 1 } }),
      ),
    ).not.toEqual({ kind: 'pushMain' });
    expect(
      decideAutoSync(
        input({
          mainUnpushed: true,
          mainPushFailure: { kind: 'auth', at: NOW - 3_600_000, count: 1 },
        }),
      ),
    ).not.toEqual({ kind: 'pushMain' });
    expect(
      decideAutoSync(
        input({
          mainUnpushed: true,
          mainPushFailure: { kind: 'other', at: NOW - 15_000, count: 1 },
        }),
      ),
    ).toEqual({ kind: 'pushMain' });
  });

  it('does nothing while offline except probe', () => {
    expect(decideAutoSync(input({ mainUnpushed: true, isOnline: false }))).toEqual({
      kind: 'fetch',
    });
  });
});

describe('main-diverged escalation', () => {
  const base = {
    hasRemote: true,
    ahead: 0,
    behind: 0,
    isClean: true,
    hasMergeConflict: false,
    autoPullEnabled: true,
  };

  it('is raised when local and remote main have each moved on and main is not checked out', () => {
    expect(
      computeSyncEscalation({ ...base, mainAhead: 1, mainBehind: 2, isOnMain: false }),
    ).toBe('main-diverged');
    expect(escalationSeverity('main-diverged')).toBe('banner');
  });

  it('is not raised for a main that is merely behind (that is "Update main")', () => {
    expect(computeSyncEscalation({ ...base, mainAhead: 0, mainBehind: 2, isOnMain: false })).toBeNull();
  });

  it('is left to the branch rules when main is checked out', () => {
    expect(computeSyncEscalation({ ...base, mainAhead: 1, mainBehind: 2, isOnMain: true })).toBeNull();
  });
});
