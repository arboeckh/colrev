import { describe, it, expect } from 'vitest';
import { computeGitSyncState } from './gitSyncState';

const base = {
  ahead: 0,
  behind: 0,
  pendingCount: 0,
  isOffline: false,
  isResolving: false,
  isPushing: false,
  isPulling: false,
  hasRemote: true,
};

describe('computeGitSyncState', () => {
  describe('no remote', () => {
    it('returns hidden for both buttons when hasRemote=false', () => {
      const state = computeGitSyncState({ ...base, hasRemote: false });
      expect(state.push.status).toBe('hidden');
      expect(state.pull.status).toBe('hidden');
    });
  });

  describe('offline', () => {
    it('returns offline for both buttons, preserving counts', () => {
      const state = computeGitSyncState({ ...base, isOffline: true, ahead: 2, behind: 1, pendingCount: 1 });
      expect(state.push.status).toBe('offline');
      expect(state.pull.status).toBe('offline');
      expect(state.push.count).toBe(3); // ahead + pending
      expect(state.pull.count).toBe(1);
    });

    it('returns offline for both buttons when nothing to sync', () => {
      const state = computeGitSyncState({ ...base, isOffline: true });
      expect(state.push.status).toBe('offline');
      expect(state.pull.status).toBe('offline');
      expect(state.push.count).toBe(0);
      expect(state.pull.count).toBe(0);
    });
  });

  describe('loading states', () => {
    it('push is loading when isPushing=true', () => {
      const state = computeGitSyncState({ ...base, isPushing: true, ahead: 1 });
      expect(state.push.status).toBe('loading');
    });

    it('pull is loading when isPulling=true', () => {
      const state = computeGitSyncState({ ...base, isPulling: true, behind: 1 });
      expect(state.pull.status).toBe('loading');
    });

    it('both are loading when isResolving=true', () => {
      const state = computeGitSyncState({ ...base, isResolving: true, ahead: 1, behind: 1 });
      expect(state.push.status).toBe('loading');
      expect(state.pull.status).toBe('loading');
    });
  });

  describe('diverged (ahead > 0 && behind > 0)', () => {
    it('push is divergedBlocked and pull is divergedWarning', () => {
      const state = computeGitSyncState({ ...base, ahead: 2, behind: 3 });
      expect(state.push.status).toBe('divergedBlocked');
      expect(state.pull.status).toBe('divergedWarning');
    });

    it('push label shows combined count, pull label shows Pull & merge', () => {
      const state = computeGitSyncState({ ...base, ahead: 1, behind: 2, pendingCount: 1 });
      expect(state.push.count).toBe(2); // ahead + pending
      expect(state.pull.count).toBe(2);
      expect(state.pull.label).toContain('Pull & merge');
    });
  });

  describe('fully in sync', () => {
    it('both buttons are idle when nothing to push or pull', () => {
      const state = computeGitSyncState({ ...base });
      expect(state.push.status).toBe('idle');
      expect(state.pull.status).toBe('idle');
      expect(state.push.count).toBe(0);
      expect(state.pull.count).toBe(0);
    });
  });

  describe('pending only', () => {
    it('push is active with pending count, pull is idle', () => {
      const state = computeGitSyncState({ ...base, pendingCount: 3 });
      expect(state.push.status).toBe('active');
      expect(state.push.count).toBe(3);
      expect(state.pull.status).toBe('idle');
    });
  });

  describe('ahead only', () => {
    it('push is active with ahead count, pull is idle', () => {
      const state = computeGitSyncState({ ...base, ahead: 2 });
      expect(state.push.status).toBe('active');
      expect(state.push.count).toBe(2);
      expect(state.pull.status).toBe('idle');
    });
  });

  describe('pending + ahead combined', () => {
    it('push is active with combined count', () => {
      const state = computeGitSyncState({ ...base, ahead: 2, pendingCount: 1 });
      expect(state.push.status).toBe('active');
      expect(state.push.count).toBe(3);
      expect(state.pull.status).toBe('idle');
    });
  });

  describe('behind only', () => {
    it('pull is active with behind count, push is idle', () => {
      const state = computeGitSyncState({ ...base, behind: 4 });
      expect(state.pull.status).toBe('active');
      expect(state.pull.count).toBe(4);
      expect(state.push.status).toBe('idle');
    });
  });

  describe('labels', () => {
    it('push label shows Push (N) when active', () => {
      const state = computeGitSyncState({ ...base, ahead: 3 });
      expect(state.push.label).toBe('Push (3)');
    });

    it('pull label shows Pull (N) when active', () => {
      const state = computeGitSyncState({ ...base, behind: 2 });
      expect(state.pull.label).toBe('Pull (2)');
    });

    it('push label shows Push when idle', () => {
      const state = computeGitSyncState({ ...base });
      expect(state.push.label).toBe('Push');
    });

    it('pull label shows Pull when idle', () => {
      const state = computeGitSyncState({ ...base });
      expect(state.pull.label).toBe('Pull');
    });

    it('push label shows Pushing... when loading', () => {
      const state = computeGitSyncState({ ...base, isPushing: true });
      expect(state.push.label).toBe('Pushing...');
    });

    it('pull label shows Pulling... when loading', () => {
      const state = computeGitSyncState({ ...base, isPulling: true });
      expect(state.pull.label).toBe('Pulling...');
    });

    it('pull label shows Syncing... when isResolving', () => {
      const state = computeGitSyncState({ ...base, isResolving: true });
      expect(state.pull.label).toBe('Syncing...');
    });
  });

  describe('tooltips', () => {
    it('divergedBlocked push has tooltip about pulling first', () => {
      const state = computeGitSyncState({ ...base, ahead: 1, behind: 1 });
      expect(state.push.tooltip).toMatch(/pull first/i);
    });
  });
});
