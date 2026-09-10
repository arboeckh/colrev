import { describe, expect, it } from 'vitest';
import {
  computeSyncEscalation,
  decideAutoSync,
  escalationSeverity,
  isFastForwardPull,
  isFastForwardPush,
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
    now: NOW,
    fetchIntervalMs: 90_000,
    pushDebounceMs: 4_000,
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
    ['offline', { isOnline: false }, 'offline'],
    ['mid-merge', { hasMergeConflict: true }, 'merge-conflict'],
    ['already busy', { busy: true }, 'busy'],
  ])('does nothing when %s', (_label, overrides, reason) => {
    const action = decideAutoSync(input({ behind: 5, ...overrides }));
    expect(action).toEqual({ kind: 'idle', reason });
  });

  it('never auto-pulls over a diverged repo', () => {
    const action = decideAutoSync(input({ ahead: 2, behind: 3, lastFetchAt: NOW }));
    expect(action).toEqual({ kind: 'idle', reason: 'diverged' });
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
