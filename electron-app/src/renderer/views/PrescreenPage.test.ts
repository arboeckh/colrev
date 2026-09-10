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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setupRendererTest, type RendererTestContext } from '@/test/harness';
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
