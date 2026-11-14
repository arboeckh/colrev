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
  branchDeltaResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  type RendererTestContext,
} from '@/test/harness';
import { useProjectDataStore } from '@/stores/projectData';
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

// The page listens on `window`; a page left mounted would answer the next
// test's key presses too.
let mounted: VueWrapper[] = [];

afterEach(() => {
  mounted.forEach((w) => w.unmount());
  mounted = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mountPage(ctx: RendererTestContext, branch = 'dev'): Promise<VueWrapper> {
  ctx.openProject();
  ctx.setGitState({ branch });
  const wrapper = mount(PrescreenPage);
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

function currentRecordId(wrapper: VueWrapper): string {
  return wrapper.find('[data-testid="prescreen-record-id"]').text();
}

/** Step past the decision debounce, as a user reading the next abstract would. */
function afterReading(): void {
  vi.setSystemTime(Date.now() + 1000);
}

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('PrescreenPage decisions', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    // Only Date is faked: the debounce reads it, flushPromises does not.
    vi.useFakeTimers({ toFake: ['Date'] });
    ctx = setupRendererTest();
    // Access control is out of scope here: no managed task, no branch switch.
    ctx.mock.rpc.onError('get_current_managed_review_task', { message: 'not managed' });
    ctx.mock.rpc.on('list_managed_review_tasks', () => tasksResponse('prescreen'));
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
    afterReading();
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
    await flushPromises();
    afterReading();
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

describe('PrescreenPage managed access', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc.onError('get_current_managed_review_task', { message: 'not managed' });
    stubQueue(ctx);
  });

  it('fails closed with a Retry when the task list cannot be read', async () => {
    ctx.mock.rpc.onError('list_managed_review_tasks', { message: 'backend down' });

    const wrapper = await mountPage(ctx);

    // No queue, so no decision can land on dev during an active task.
    expect(wrapper.text()).toContain('Could not check your review assignment');
    expect(wrapper.find('[data-testid="prescreen-btn-include"]').exists()).toBe(false);

    ctx.mock.rpc.on('list_managed_review_tasks', () => tasksResponse('prescreen'));
    await wrapper.get('[data-testid="managed-access-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="managed-access-retry"]').exists()).toBe(false);
    expect(currentRecordId(wrapper)).toBe('r1');
  });

  it('runs a full invalidation that arrived mid-pass once the pass is done', async () => {
    ctx.mock.rpc.on('list_managed_review_tasks', () => tasksResponse('prescreen'));
    ctx.mock.rpc
      .on('get_status', statusResponse())
      .on('get_settings', settingsResponse())
      .on('get_branch_delta', branchDeltaResponse());
    let first = true;
    ctx.mock.rpc.on('get_prescreen_queue', async () => {
      if (first) {
        first = false;
        // A pull lands while the page is still loading its queue: the epoch
        // bump discards this response, so only a second pass can fill the queue.
        await useProjectDataStore().invalidateAll();
      }
      return {
        success: true,
        project_id: 'lit-review',
        total_count: 1,
        records: [queueRecord('r1')],
      };
    });

    const wrapper = await mountPage(ctx);
    await vi.waitFor(() => expect(ctx.mock.rpc.countOf('get_prescreen_queue')).toBe(2));
    await flushPromises();

    expect(currentRecordId(wrapper)).toBe('r1');
  });
});

describe('PrescreenPage keyboard decisions', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    ctx = setupRendererTest();
    ctx.mock.rpc.onError('get_current_managed_review_task', { message: 'not managed' });
    ctx.mock.rpc.on('list_managed_review_tasks', () => tasksResponse('prescreen'));
    ctx.mock.rpc.on('prescreen_record', () => new Promise(() => {}));
    stubQueue(ctx);
  });

  afterEach(() => {
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  });

  it('decides with the arrow keys', async () => {
    const wrapper = await mountPage(ctx);

    press('ArrowRight');
    await flushPromises();

    expect(currentRecordId(wrapper)).toBe('r2');
    expect(ctx.mock.rpc.callsTo('prescreen_record')[0].params).toMatchObject({
      record_id: 'r1',
      decision: 'include',
    });
  });

  it('ignores a held key', async () => {
    const wrapper = await mountPage(ctx);

    press('ArrowRight', { repeat: true });
    await flushPromises();

    expect(currentRecordId(wrapper)).toBe('r1');
    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(0);
  });

  it('decides one record for a double-click, not two', async () => {
    const wrapper = await mountPage(ctx);

    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await flushPromises();

    expect(currentRecordId(wrapper)).toBe('r2');
    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(1);

    // Once the user has had time to read r2, the next decision lands.
    afterReading();
    press('ArrowLeft');
    await flushPromises();
    // (Its write queues behind the first, which never settles here.)
    expect(currentRecordId(wrapper)).toBe('r3');
  });

  it('ignores an arrow pressed with a modifier', async () => {
    const wrapper = await mountPage(ctx);

    for (const mod of ['metaKey', 'altKey', 'ctrlKey', 'shiftKey'] as const) {
      press('ArrowRight', { [mod]: true });
    }
    await flushPromises();

    expect(currentRecordId(wrapper)).toBe('r1');
    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(0);
  });

  it('ignores arrows while a dialog is open over the page', async () => {
    const wrapper = await mountPage(ctx);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    press('ArrowRight');
    press('ArrowDown');
    await flushPromises();
    expect(currentRecordId(wrapper)).toBe('r1');
    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(0);

    dialog.remove();
    press('ArrowRight');
    await flushPromises();
    expect(currentRecordId(wrapper)).toBe('r2');
  });

  it('writes no decision from the arrow keys when read-only', async () => {
    const wrapper = await mountPage(ctx, 'main');

    press('ArrowRight');
    press('ArrowLeft');
    await flushPromises();

    expect(ctx.mock.rpc.countOf('prescreen_record')).toBe(0);
    expect(currentRecordId(wrapper)).toBe('r1');
  });
});

describe('PrescreenPage last decision', () => {
  let ctx: RendererTestContext;

  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc.onError('get_current_managed_review_task', { message: 'not managed' });
    ctx.mock.rpc.on('list_managed_review_tasks', () => tasksResponse('prescreen'));
    stubQueue(ctx, ['r1']);
    ctx.mock.rpc.on('prescreen_record', (params) => ({
      success: true,
      project_id: 'lit-review',
      record: {
        id: params.record_id as string,
        decision: params.decision as 'include' | 'exclude',
        new_status: 'rev_prescreen_included',
      },
      remaining_count: 0,
      already_decided: false,
    }));
  });

  it('shows the completion screen, not "No records", while the final refresh runs', async () => {
    // The refresh that reads the final counts never settles.
    vi.spyOn(useProjectDataStore(), 'refreshNow').mockReturnValue(new Promise(() => {}));

    const wrapper = await mountPage(ctx);
    await wrapper.find('[data-testid="prescreen-btn-include"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('No records to prescreen');
    expect(wrapper.find('[data-testid="prescreen-complete"]').exists()).toBe(true);
  });
});
