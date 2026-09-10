import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useProjectDataStore, type ProjectDataEvent } from './projectData';
import { useProjectsStore } from './projects';
import { useGitStore } from './git';

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
    it('refreshes on the first write, then coalesces the rest of the streak', async () => {
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

      // Leading edge: the first write of the streak is not made to wait out
      // the debounce. The two that followed it collapse into one trailing
      // refresh rather than one each.
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.full === false)).toBe(true);
      expect(events.every((e) => e.projectId === 'p1')).toBe(true);
      expect(events[0].methods).toEqual(['prescreen_record']);
      expect(events[1].methods).toEqual(['prescreen_record', 'batch_enrich_records']);
    });

    it('emits the first write immediately, without waiting out the debounce', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      seam.subscribe((e) => {
        events.push(e);
      });

      seam.notifyWriteCompleted('mark_pdf_not_available');
      await vi.advanceTimersByTimeAsync(1);

      expect(events).toHaveLength(1);
      expect(events[0].methods).toEqual(['mark_pdf_not_available']);
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
    it('bumps the epoch and emits a full event', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      seam.subscribe((e) => {
        events.push(e);
      });

      const guard = seam.snapshot();
      const done = seam.invalidateAll();
      await vi.runAllTimersAsync();
      await done;

      expect(guard.isCurrent()).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0].full).toBe(true);
      expect(events[0].methods).toContain('invalidate');
    });

    it('absorbs a write still waiting on the debounce', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      seam.subscribe((e) => {
        events.push(e);
      });

      // Two writes: the first goes out on the leading edge, the second is
      // still queued behind the debounce when the invalidation lands and must
      // ride along with it rather than firing a third refresh of its own.
      seam.notifyWriteCompleted('commit_changes');
      seam.notifyWriteCompleted('commit_changes');
      const done = seam.invalidateAll();
      await vi.runAllTimersAsync();
      await done;

      expect(events).toHaveLength(2);
      expect(events[1].full).toBe(true);
      expect(events[1].methods).toContain('commit_changes');
      expect(events[1].methods).toContain('invalidate');
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

  describe('reentrant invalidation', () => {
    // A branch switch invalidates through the seam, and a page handler can
    // react by switching branch again (managed-review access check). Chaining
    // the nested invalidation onto the serialization chain deadlocked: the
    // link it waited for was the one awaiting that very handler.
    it('resolves when a subscriber invalidates from inside its handler', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      const events: ProjectDataEvent[] = [];
      let reentered = false;
      seam.subscribe(async (e) => {
        events.push(e);
        if (!e.full || reentered) return;
        reentered = true;
        await seam.invalidateAll();
      });

      let settled = false;
      const outer = seam.invalidateAll().then(() => {
        settled = true;
      });
      await vi.runAllTimersAsync();
      await outer;

      expect(settled).toBe(true);
      // Outer event plus the nested one the handler triggered.
      expect(events).toHaveLength(2);
    });

    it('stops a subscriber that invalidates on every event', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const seam = useProjectDataStore();

      let depth = 0;
      seam.subscribe(async () => {
        depth += 1;
        await seam.invalidateAll();
      });

      const outer = seam.invalidateAll();
      await vi.runAllTimersAsync();
      await outer;

      expect(depth).toBeLessThan(10);
      expect(seam.isStale).toBe(true);
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

    it('retries a failed store refresh until it succeeds', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const git = useGitStore();
      let attempts = 0;
      vi.spyOn(git, 'refreshStatus').mockImplementation(async () => {
        attempts += 1;
        // The first refresh (and the immediate light refresh before it) fail;
        // a later attempt finds the backend responsive again.
        return attempts >= 3;
      });

      const seam = useProjectDataStore();
      seam.notifyWriteCompleted('pdf_get');
      await vi.runAllTimersAsync();

      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(seam.isStale).toBe(false);
    });

    it('gives up after the capped backoff and leaves the flag set', async () => {
      const projects = useProjectsStore();
      projects.currentProjectId = 'p1';
      const git = useGitStore();
      vi.spyOn(git, 'refreshStatus').mockResolvedValue(false);

      const seam = useProjectDataStore();
      seam.notifyWriteCompleted('pdf_get');
      await vi.runAllTimersAsync();

      expect(seam.isStale).toBe(true);
    });
  });
});
