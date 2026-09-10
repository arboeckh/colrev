/**
 * A budget on what it costs to enter the managed prescreen review step.
 *
 * The RPC pipe is strictly serial — one Python request at a time, behind the
 * main-process git mutex — so entry latency is (number of round trips) x
 * (cost of each). Measured against a real project, a project-scoped RPC costs
 * 150-400ms and a `git fetch` against GitHub 300-700ms; entry used to spend 28
 * of them, four being network fetches, which is where the 15-20s of "Setting
 * up your review queue..." came from on an eight-record queue.
 *
 * Most of those were duplicates: `switchBranch` reloaded the project and then
 * invalidated it (reloading it again), the invalidation re-ran the page's own
 * access check, and `managedReview.refresh()` fetched from the remote on every
 * one of those passes. The ceilings below are budgets, not exact counts — but
 * a change that pushes past them is re-introducing a duplicate pass, and the
 * failure message says which call multiplied.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import {
  branchDeltaResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_ID,
  TEST_PROJECT_PATH,
  type RendererTestContext,
} from '@/test/harness';
import { useAuthStore } from '@/stores/auth';
import { useManagedReviewStore } from '@/stores/managedReview';
import PrescreenPage from './PrescreenPage.vue';
import type { ManagedReviewTask } from '@/types/generated/rpc';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));

const BRANCH = 'review/prescreen/t1/alice';

const TASK = {
  id: 't1',
  kind: 'prescreen',
  state: 'active',
  created_at: '2026-01-01T00:00:00Z',
  record_ids: ['r1', 'r2', 'r3'],
  reviewers: [
    { github_login: 'alice', branch_name: BRANCH, finished_at: null },
    { github_login: 'bob', branch_name: 'review/prescreen/t1/bob', finished_at: null },
  ],
} as unknown as ManagedReviewTask;

describe('managed prescreen entry cost', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.openProject({ path: TEST_PROJECT_PATH });
    ctx.setGitState({ branch: 'dev' });
    useAuthStore().session = {
      user: { login: 'alice', name: null, avatarUrl: '', email: null },
      authenticatedAt: '2026-01-01T00:00:00Z',
    } as never;

    // The checkout the reviewer-branch invariant performs, and its effect on
    // the git snapshot — everything downstream keys off the new branch.
    let onReviewerBranch = false;
    ctx.mock.git.checkout.mockImplementation(async () => {
      onReviewerBranch = true;
      ctx.setGitState({ branch: BRANCH });
      return { success: true } as never;
    });

    ctx.mock.rpc
      .on('get_status', statusResponse())
      .on('get_settings', settingsResponse())
      .on('get_branch_delta', branchDeltaResponse())
      .on('list_managed_review_tasks', (p) =>
        tasksResponse(p.kind, p.kind === 'prescreen' ? [TASK] : []),
      )
      .on('get_current_managed_review_task', () => ({
        success: true,
        project_id: TEST_PROJECT_ID,
        kind: 'prescreen' as const,
        current_branch: onReviewerBranch ? BRANCH : 'dev',
        task: onReviewerBranch ? TASK : null,
      }))
      .on('get_prescreen_queue', () => ({
        success: true,
        project_id: TEST_PROJECT_ID,
        total_count: 3,
        records: ['r1', 'r2', 'r3'].map((id) => ({
          id,
          title: id,
          author: 'author',
          year: '2026',
          abstract: 'abstract',
          can_enrich: false,
          journal: null,
          booktitle: null,
          doi: null,
          pubmedid: null,
        })),
      }));
  });

  it('enters the reviewer branch without duplicate reload passes', async () => {
    // The workflow page's own mount, which wraps the prescreen panel.
    await useManagedReviewStore().refresh({ fetch: true });
    mount(PrescreenPage);
    await flushPromises();
    // Let the debounced post-write refresh land.
    await new Promise((resolve) => setTimeout(resolve, 700));
    await flushPromises();

    // The queue is on screen: this measured a completed entry, not a stall.
    expect(ctx.mock.rpc.countOf('get_prescreen_queue')).toBe(1);

    // One fetch for the workflow page's "where is the other reviewer at?",
    // one for making the reviewer branch available to check out. Every further
    // fetch used to come from `managedReview.refresh()` on a reload path.
    expect(ctx.mock.git.fetch).toHaveBeenCalledTimes(2);

    // The project is re-derived once after the branch switch, not twice.
    expect(ctx.mock.rpc.countOf('get_status')).toBe(1);
    expect(ctx.mock.rpc.countOf('get_settings')).toBe(1);

    const rpcCalls = ctx.mock.rpc.calls.length;
    const gitCalls =
      ctx.mock.git.fetch.mock.calls.length + ctx.mock.gitState.refresh.mock.calls.length;
    expect(rpcCalls + gitCalls).toBeLessThanOrEqual(20);
  });
});
