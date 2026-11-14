/**
 * Results modal: "Needs Attention" paging after a fix, and dedupe after edits.
 *
 * The dialog teleports into `document.body` (reka-ui), so assertions run
 * against the document.
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PreprocessingResultsModal from './PreprocessingResultsModal.vue';
import { useNotificationsStore } from '@/stores/notifications';
import {
  operationResponse,
  setupRendererTest,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';

// The edit dialog is covered by its own tests; here it only has to report an edit.
vi.mock('@/components/preprocessing/RecordEditDialog.vue', () => ({
  default: {
    name: 'RecordEditDialog',
    props: ['open', 'projectId', 'recordId'],
    emits: ['update:open', 'record-updated'],
    template: '<button data-testid="fake-edit-save" @click="$emit(\'record-updated\')" />',
  },
}));

let ctx: RendererTestContext;
let wrapper: VueWrapper | null = null;

function body(testId: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function record(i: number) {
  return { ID: `r${i}`, ENTRYTYPE: 'article', title: `Title ${i}`, author: 'A', year: '2024' };
}

/** The attention list as the backend would page it, `total` records long. */
function stubAttention(getTotal: () => number) {
  ctx.mock.rpc.on('get_records', (params) => {
    const { filters, pagination } = params as {
      filters: { status?: string };
      pagination: { offset: number; limit: number };
    };
    const total = filters.status === 'md_needs_manual_preparation' ? getTotal() : 0;
    const records = Array.from({ length: total }, (_, i) => record(i + 1)).slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return { success: true, project_id: TEST_PROJECT_ID, total_count: total, records } as never;
  });
}

/** Mounted closed and then opened, as the pages do: loading is triggered by the open. */
async function mountModal(): Promise<VueWrapper> {
  ctx.openProject();
  wrapper = mount(PreprocessingResultsModal, {
    props: { open: false, projectId: TEST_PROJECT_ID },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

describe('PreprocessingResultsModal', () => {
  beforeEach(() => {
    ctx = setupRendererTest();
    ctx.mock.rpc.on('dedupe', operationResponse('dedupe'));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('moves back a page when the only record on the last page was fixed', async () => {
    let total = 21;
    stubAttention(() => total);
    await mountModal();

    // Page 2 holds the 21st record only.
    body('attention-next-page')?.click();
    await flushPromises();
    expect(document.body.textContent).toContain('Page 2 of 2');

    // It is fixed and leaves the list.
    total = 20;
    body('fake-edit-save')?.click();
    await flushPromises();

    expect(document.body.textContent).not.toContain('All records are ready!');
    expect(body('attention-records-table')).not.toBeNull();
    expect(document.body.textContent).toContain('Title 20');
  });

  it('runs dedupe once when the modal closes, not after every edit', async () => {
    stubAttention(() => 3);
    await mountModal();

    body('fake-edit-save')?.click();
    body('fake-edit-save')?.click();
    await flushPromises();
    expect(ctx.mock.rpc.callsTo('dedupe')).toHaveLength(0);

    await wrapper!.setProps({ open: false });
    await flushPromises();
    expect(ctx.mock.rpc.callsTo('dedupe')).toHaveLength(1);

    // Nothing edited since: reopening and closing must not dedupe again.
    await wrapper!.setProps({ open: true });
    await flushPromises();
    await wrapper!.setProps({ open: false });
    await flushPromises();
    expect(ctx.mock.rpc.callsTo('dedupe')).toHaveLength(1);
  });

  it('shows a failed dedupe instead of only logging it', async () => {
    ctx.mock.rpc.on('dedupe', () => {
      throw new Error('dedupe exploded');
    });
    const error = vi.spyOn(useNotificationsStore(), 'error');
    stubAttention(() => 3);
    await mountModal();

    body('fake-edit-save')?.click();
    await wrapper!.setProps({ open: false });
    await flushPromises();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Deduplication'),
      expect.stringContaining('dedupe exploded'),
    );
  });
});
