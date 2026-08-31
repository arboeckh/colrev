/**
 * The invalidation seam's *fan-out* (WP-05), driven through the real bridge
 * mock rather than stubbed stores (WP-08 §1).
 *
 * `projectData.test.ts` covers the seam's own bookkeeping (epoch guards,
 * coalescing, subscription lifecycle) with no backend at all. This file
 * covers the half that used to be e2e-only: which downstream reads a write
 * actually triggers, and what happens when one of them fails.
 *
 * Deleting any leg of `refreshStores` fails a test here — that is the point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from './git';
import { useProjectDataStore, type ProjectDataEvent } from './projectData';
import { useProjectsStore } from './projects';
import { useReviewDefinitionStore } from './reviewDefinition';
import {
  reviewDefinitionResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { makeGitSnapshot } from '@/test/window-mock';

let ctx: RendererTestContext;

/** Stub the RPCs a full refresh cycle reads. */
function stubRefreshReads(): void {
  ctx.mock.rpc
    .on('get_status', statusResponse())
    .on('get_settings', settingsResponse())
    .on('list_managed_review_tasks', (params) => tasksResponse(params.kind));
}

beforeEach(() => {
  ctx = setupRendererTest();
  vi.useFakeTimers();
  ctx.openProject();
  ctx.setGitState();
  stubRefreshReads();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('write -> refresh fan-out', () => {
  it('refreshes git immediately and the rest on the trailing debounce', async () => {
    const seam = useProjectDataStore();
    const events: ProjectDataEvent[] = [];
    seam.subscribe((e) => void events.push(e));

    seam.notifyWriteCompleted('prescreen_record');

    // The git snapshot gates commit buttons — it must not wait for the
    // debounce (a window where the tree is dirty but the UI says clean).
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.mock.gitState.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.mock.rpc.countOf('get_status')).toBe(0);
    expect(events).toHaveLength(0);

    await vi.runAllTimersAsync();

    // Project status, settings and managed-review tasks all re-read...
    expect(ctx.mock.rpc.countOf('get_status')).toBe(1);
    expect(ctx.mock.rpc.countOf('get_settings')).toBe(1);
    expect(ctx.mock.rpc.countOf('list_managed_review_tasks')).toBe(2); // prescreen + screen
    // ...and pages are told exactly once.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ projectId: TEST_PROJECT_ID, full: false });
  });

  it('feeds the git store from the refreshed snapshot, not a second read', async () => {
    const git = useGitStore();
    const seam = useProjectDataStore();

    ctx.mock.setGitSnapshot(
      makeGitSnapshot({
        projectId: TEST_PROJECT_ID,
        branch: 'review/prescreen/t1/alice',
        isClean: false,
        uncommittedChanges: 3,
      }),
    );

    seam.notifyWriteCompleted('prescreen_record');
    await vi.runAllTimersAsync();

    expect(git.currentBranch).toBe('review/prescreen/t1/alice');
    expect(git.isClean).toBe(false);
    // `get_git_status` is the main process's business now; the renderer only
    // ever asks the gitState bridge.
    expect(ctx.mock.rpc.countOf('get_git_status')).toBe(0);
  });

  it('a full invalidation additionally reloads branches and the review definition', async () => {
    const seam = useProjectDataStore();
    const reviewDef = useReviewDefinitionStore();
    // `loadDefinition` only re-runs for a definition that was already loaded.
    reviewDef.definition = { criteria: [] } as never;
    ctx.mock.rpc.on('get_review_definition', reviewDefinitionResponse());

    await seam.invalidateAll();
    await vi.runAllTimersAsync();

    expect(ctx.mock.git.listBranches).toHaveBeenCalledTimes(1);
    expect(ctx.mock.rpc.countOf('get_review_definition')).toBe(1);
  });

  it('does not reload branches on a plain write refresh', async () => {
    const seam = useProjectDataStore();
    seam.notifyWriteCompleted('prescreen_record');
    await vi.runAllTimersAsync();

    expect(ctx.mock.git.listBranches).not.toHaveBeenCalled();
  });

  it('fans out once for a burst of writes', async () => {
    const seam = useProjectDataStore();
    const events: ProjectDataEvent[] = [];
    seam.subscribe((e) => void events.push(e));

    seam.notifyWriteCompleted('prescreen_record');
    seam.notifyWriteCompleted('prescreen_record');
    seam.notifyWriteCompleted('prescreen_record');
    await vi.runAllTimersAsync();

    expect(ctx.mock.rpc.countOf('get_status')).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].methods).toHaveLength(3);
  });
});

describe('staleness reporting', () => {
  it('flags the UI stale when the git refresh fails, keeping the old snapshot', async () => {
    const git = useGitStore();
    const seam = useProjectDataStore();
    ctx.setGitState({ branch: 'dev', ahead: 2 });
    ctx.mock.gitStateRefreshError = 'index.lock held';

    seam.notifyWriteCompleted('commit_changes');
    await vi.runAllTimersAsync();

    expect(seam.isStale).toBe(true);
    expect(seam.staleReason).toBe('index.lock held');
    // A failed read must never blank the header.
    expect(git.currentBranch).toBe('dev');
    expect(git.ahead).toBe(2);
  });

  it('flags the UI stale when the project status read fails', async () => {
    const seam = useProjectDataStore();
    ctx.mock.rpc.onError('get_status', { message: 'backend exploded' });

    seam.notifyWriteCompleted('commit_changes');
    await vi.runAllTimersAsync();

    expect(seam.isStale).toBe(true);
  });

  it('clears the stale flag once a refresh succeeds again', async () => {
    const seam = useProjectDataStore();
    ctx.mock.gitStateRefreshError = 'transient';
    seam.notifyWriteCompleted('commit_changes');
    await vi.runAllTimersAsync();
    expect(seam.isStale).toBe(true);

    ctx.mock.gitStateRefreshError = null;
    seam.notifyWriteCompleted('commit_changes');
    await vi.runAllTimersAsync();
    expect(seam.isStale).toBe(false);
    expect(seam.staleReason).toBeNull();
  });
});

describe('epoch guarding across a project switch', () => {
  it('does not tell pages to reload against a project that is no longer open', async () => {
    const projects = useProjectsStore();
    const seam = useProjectDataStore();
    const events: ProjectDataEvent[] = [];
    seam.subscribe((e) => void events.push(e));

    // The status read resolves only after the user has moved on.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.mock.rpc.on('get_status', async () => {
      await gate;
      return statusResponse();
    });

    seam.notifyWriteCompleted('prescreen_record');
    await vi.advanceTimersByTimeAsync(500);
    projects.currentProjectId = 'some-other-project';
    release();
    await vi.runAllTimersAsync();

    expect(events).toHaveLength(0);
  });
});
