/**
 * Prescreen navigation must not wait on the backend.
 *
 * The RPC pipe is strictly serial — one Python request at a time, behind the
 * main-process git mutex — and every write drags a refresh tail behind it. So
 * awaiting `prescreen_record` before advancing put seconds between the click
 * and the next abstract, on queues of eight records. The decision is applied
 * locally and the walkthrough advances immediately; the write is flushed on a
 * background chain that preserves click order and rolls back on failure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import {
  makeProjectStatus,
  makeRecordCounts,
  makeStatusStep,
  PIPELINE_OPERATIONS,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { serveSerially } from '@/test/window-mock';
import PrescreenPage from './PrescreenPage.vue';

vi.mock('@/components/layout/StepPageShell.vue', () => ({
  default: { name: 'StepPageShell', template: '<div><slot /></div>' },
}));

function queueRecord(id: string) {
  return {
    id,
    title: `Title ${id}`,
    author: 'Author',
    year: '2024',
    abstract: `Abstract ${id}`,
    can_enrich: false,
    journal: null,
    booktitle: null,
    doi: null,
    pubmedid: null,
  };
}

const RECORD_IDS = ['r1', 'r2', 'r3'];

function stubQueue(ctx: RendererTestContext, ids: string[] = RECORD_IDS) {
  ctx.mock.rpc.on('get_prescreen_queue', () => ({
    success: true,
    project_id: 'lit-review',
    total_count: ids.length,
    records: ids.map(queueRecord),
  }));
}

async function mountPage(ctx: RendererTestContext): Promise<VueWrapper> {
  ctx.openProject();
  ctx.setGitState({ branch: 'dev' });
  const wrapper = mount(PrescreenPage);
  await flushPromises();
  return wrapper;
}

function currentRecordId(wrapper: VueWrapper): string {
  return wrapper.find('[data-testid="prescreen-record-id"]').text();
}

describe('PrescreenPage decisions', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    // Access control is out of scope here: no managed task, no branch switch.
    ctx.mock.rpc.onError('get_current_managed_review_task', { message: 'not managed' });
    ctx.mock.rpc.onError('list_managed_review_tasks', { message: 'not managed' });
    stubQueue(ctx);
  });

  it('advances to the next record before the write resolves', async () => {
    // A decision RPC that never settles: if navigation awaited it, the page
    // would still be showing r1.
    ctx.mock.rpc.on('prescreen_record', () => new Promise(() => {}));

    const wrapper = await mountPage(ctx);
    expect(currentRecordId(wrapper)).toBe('r1');

    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await flushPromises();

    expect(currentRecordId(wrapper)).toBe('r2');
    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(1);
  });

  it('sends decisions in click order even though clicks do not wait', async () => {
    const resolvers: (() => void)[] = [];
    ctx.mock.rpc.on(
      'prescreen_record',
      (params) =>
        new Promise((resolve) => {
          resolvers.push(() =>
            resolve({
              success: true,
              project_id: 'lit-review',
              record: {
                id: params.record_id as string,
                decision: params.decision as 'include' | 'exclude',
                new_status: 'rev_prescreen_included',
              },
              remaining_count: 1,
              already_decided: false,
            }),
          );
        }),
    );

    const wrapper = await mountPage(ctx);
    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="prescreen-btn-exclude"]').trigger('click');
    await flushPromises();

    // The second write is still queued behind the first — a parallel fan-out
    // would have sent both and could reorder them on the wire.
    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(1);
    resolvers[0]();
    await flushPromises();
    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(2);

    const sent = ctx.mock.rpc.callsTo('prescreen_record').map((c) => c.params.record_id);
    expect(sent).toEqual(['r1', 'r2']);
  });

  it('does not let a lagging response bounce the remaining count back up', async () => {
    // Each response reports the tree as of *that* write, so while later
    // decisions are still queued it trails the optimistic count.
    const resolvers: ((remaining: number) => void)[] = [];
    ctx.mock.rpc.on(
      'prescreen_record',
      (params) =>
        new Promise((resolve) => {
          resolvers.push((remaining: number) =>
            resolve({
              success: true,
              project_id: 'lit-review',
              record: {
                id: params.record_id as string,
                decision: params.decision as 'include' | 'exclude',
                new_status: 'rev_prescreen_included',
              },
              remaining_count: remaining,
              already_decided: false,
            }),
          );
        }),
    );

    const wrapper = await mountPage(ctx);
    const remaining = () =>
      wrapper.find('[data-testid="prescreen-remaining-count"]').text();

    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await flushPromises();
    expect(remaining()).toBe('1 remaining');

    // The first write lands while the second is still queued. Its count is one
    // decision behind; adopting it here is the visible bounce.
    resolvers[0](2);
    await flushPromises();
    expect(remaining()).toBe('1 remaining');

    // Once the chain drains, the server's count is the authority again.
    resolvers[1](1);
    await flushPromises();
    expect(remaining()).toBe('1 remaining');
  });

  it('rolls the record back to undecided when the write fails', async () => {
    ctx.mock.rpc.onError('prescreen_record', { message: 'disk full' });

    const wrapper = await mountPage(ctx);
    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await flushPromises();

    // The page moved on optimistically, then the failure put r1 back in play.
    expect(currentRecordId(wrapper)).toBe('r2');
    expect(wrapper.find('[data-testid="prescreen-included-count"]').text()).toBe('0');
    expect(wrapper.find('[data-testid="prescreen-remaining-count"]').text()).toBe('3 remaining');
  });
});

describe('PrescreenPage completion counts', () => {
  // The completion screen reports the backend's counts, so it must not render
  // until they include the decision that finished the queue. On a backend that
  // lags the streak, the refreshes the earlier decisions triggered were still
  // reading when the last one landed; the seam dropped the refresh the page
  // waited on, and the screen showed 5 included / 4 excluded for ten decisions.
  const IDS = Array.from({ length: 10 }, (_, i) => `r${i + 1}`);
  let ctx: RendererTestContext;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = setupRendererTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function stubBackend() {
    const decisions = new Map<string, 'include' | 'exclude'>();
    const decided = (d: 'include' | 'exclude') =>
      [...decisions.values()].filter((x) => x === d).length;
    const undecided = () => IDS.filter((id) => !decisions.has(id));

    ctx.mock.rpc
      .onError('get_current_managed_review_task', { message: 'not managed' })
      .on('list_managed_review_tasks', (p) => tasksResponse(p.kind, []))
      .on('get_settings', settingsResponse())
      .on('get_status', () =>
        statusResponse(
          makeProjectStatus({
            currently: makeRecordCounts({
              md_processed: undecided().length,
              rev_prescreen_included: decided('include'),
              rev_prescreen_excluded: decided('exclude'),
            }),
            steps: PIPELINE_OPERATIONS.map((op) =>
              op === 'prescreen'
                ? makeStatusStep(op, {
                    pending_records: undecided().length,
                    processed_records: decisions.size,
                  })
                : makeStatusStep(op),
            ),
          }),
        ),
      )
      .on('get_prescreen_queue', () => ({
        success: true,
        project_id: TEST_PROJECT_ID,
        total_count: undecided().length,
        records: undecided().map(queueRecord),
      }))
      .on('prescreen_record', (params) => {
        decisions.set(params.record_id, params.decision);
        return {
          success: true,
          project_id: TEST_PROJECT_ID,
          record: {
            id: params.record_id,
            decision: params.decision,
            new_status:
              params.decision === 'include' ? 'rev_prescreen_included' : 'rev_prescreen_excluded',
          },
          remaining_count: undecided().length,
          already_decided: false,
        };
      });
  }

  async function advanceUntil(condition: () => boolean, limitMs = 60_000) {
    for (let waited = 0; !condition(); waited += 5) {
      if (waited > limitMs) throw new Error('condition not reached');
      await vi.advanceTimersByTimeAsync(5);
    }
  }

  function shownRecordId(wrapper: VueWrapper): string | null {
    const el = wrapper.find('[data-testid="prescreen-record-id"]');
    return el.exists() ? el.text() : null;
  }

  it('includes the last decision when the backend lags the decision streak', async () => {
    stubBackend();
    // A loaded machine: status and git reads are slow enough that the
    // refreshes a streak of decisions triggers overlap on the serial pipe.
    serveSerially(ctx.mock, (method) =>
      method === 'get_status' || method === 'get_git_status' ? 300 : 70,
    );
    ctx.openProject();
    // A reviewer branch, as in the managed review this was seen in.
    ctx.setGitState({ branch: 'review/prescreen/t1/alice' });
    const wrapper = mount(PrescreenPage);
    await advanceUntil(() => shownRecordId(wrapper) === 'r1');

    // Decide like a reviewer: click, and read the next record as soon as it
    // shows — navigation does not wait for the write.
    const complete = () => wrapper.find('[data-testid="prescreen-complete"]').exists();
    for (const [i, id] of IDS.entries()) {
      await vi.advanceTimersByTimeAsync(70);
      await wrapper
        .find(`[data-testid="prescreen-btn-${i % 2 === 0 ? 'include' : 'exclude'}"]`)
        .trigger('click');
      await advanceUntil(() => complete() || shownRecordId(wrapper) !== id);
    }
    await advanceUntil(complete);

    // Read the moment the screen appears, as a reviewer would.
    expect(wrapper.find('[data-testid="prescreen-complete-included"]').text()).toBe('5');
    expect(wrapper.find('[data-testid="prescreen-complete-excluded"]').text()).toBe('5');
    expect(wrapper.find('[data-testid="prescreen-complete-total"]').text()).toBe('10');
    wrapper.unmount();
  });
});
