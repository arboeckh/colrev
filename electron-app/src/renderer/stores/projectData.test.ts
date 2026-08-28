import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useProjectDataStore, type ProjectDataEvent } from './projectData';
import { useProjectsStore } from './projects';

// These tests exercise the seam's own logic (epoch guards, event coalescing,
// subscription lifecycle). The store-refresh side (refreshCurrentProject,
// git, pending changes) no-ops here because no backend is running and no
// project is fully loaded — full store-refresh coverage lands with WP-08's
// store testing harness.

describe('projectData invalidation seam', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('snapshot / epoch guard', () => {
    it('stays current while nothing changes', () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();
      const guard = seam.snapshot();
      expect(guard.isCurrent()).toBe(true);
    });

    it('goes stale when the epoch is bumped (branch switch / invalidation)', () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();
      const guard = seam.snapshot();
      seam.bumpEpoch();
      expect(guard.isCurrent()).toBe(false);
    });

    it('goes stale when the current project changes', () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();
      const guard = seam.snapshot();
      projects.currentProjectId = 'p2';
      expect(guard.isCurrent()).toBe(false);
    });
  });

  describe('write-event coalescing', () => {
    it('coalesces rapid writes into one event carrying all methods', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      seam.subscribe((e) => {
        events.push(e);
      });

      seam.notifyWriteCompleted('prescreen_record');
      seam.notifyWriteCompleted('prescreen_record');
      seam.notifyWriteCompleted('batch_enrich_records');

      expect(events).toHaveLength(0);
      await vi.runAllTimersAsync();

      expect(events).toHaveLength(1);
      expect(events[0].full).toBe(false);
      expect(events[0].projectId).toBe('p1');
      expect(events[0].methods).toEqual([
        'prescreen_record',
        'prescreen_record',
        'batch_enrich_records',
      ]);
    });

    it('drops events when no project is open', async () => {
      const seam = useProjectDataStore();
      const events: ProjectDataEvent[] = [];
      seam.subscribe((e) => {
        events.push(e);
      });

      seam.notifyWriteCompleted('commit_changes');
      await vi.runAllTimersAsync();

      expect(events).toHaveLength(0);
    });
  });

  describe('invalidateAll', () => {
    it('bumps the epoch and emits a single full event including pending methods', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      seam.subscribe((e) => {
        events.push(e);
      });

      const guard = seam.snapshot();
      seam.notifyWriteCompleted('commit_changes');
      const done = seam.invalidateAll();
      await vi.runAllTimersAsync();
      await done;

      expect(guard.isCurrent()).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0].full).toBe(true);
      expect(events[0].methods).toContain('commit_changes');
      expect(events[0].methods).toContain('invalidate');
    });
  });

  describe('subscription lifecycle', () => {
    it('stops delivering events after unsubscribe', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      const unsubscribe = seam.subscribe((e) => {
        events.push(e);
      });
      unsubscribe();

      seam.notifyWriteCompleted('commit_changes');
      await vi.runAllTimersAsync();

      expect(events).toHaveLength(0);
    });

    it('a throwing subscriber does not break other subscribers', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      seam.subscribe(() => {
        throw new Error('boom');
      });
      seam.subscribe((e) => {
        events.push(e);
      });

      seam.notifyWriteCompleted('commit_changes');
      await vi.runAllTimersAsync();

      expect(events).toHaveLength(1);
    });
  });

  describe('staleness flag', () => {
    it('markStale / clearStale toggle the visible flag', () => {
      const seam = useProjectDataStore();
      expect(seam.isStale).toBe(false);
      seam.markStale('refresh failed');
      expect(seam.isStale).toBe(true);
      expect(seam.staleReason).toBe('refresh failed');
      seam.clearStale();
      expect(seam.isStale).toBe(false);
      expect(seam.staleReason).toBeNull();
    });
  });
});
