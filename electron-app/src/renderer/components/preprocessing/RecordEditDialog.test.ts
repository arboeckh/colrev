/**
 * Record edit dialog: clearing a field, and a failed load.
 *
 * The dialog teleports into `document.body` (reka-ui), so assertions run
 * against the document.
 */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RecordEditDialog from './RecordEditDialog.vue';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';

let ctx: RendererTestContext;
let wrapper: VueWrapper | null = null;

function el<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return document.body.querySelector<T>(`[data-testid="${testId}"]`);
}

async function type(testId: string, value: string) {
  const input = el<HTMLInputElement>(testId)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}

async function mountDialog(): Promise<VueWrapper> {
  ctx.openProject();
  wrapper = mount(RecordEditDialog, {
    props: { open: false, projectId: TEST_PROJECT_ID, recordId: 'Smith2020' },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

const RECORD = {
  ID: 'Smith2020',
  ENTRYTYPE: 'article',
  colrev_status: 'md_needs_manual_preparation',
  title: 'A title',
  author: 'Smith, A',
  year: '2020',
  journal: 'A Journal',
  booktitle: 'A Book',
};

describe('RecordEditDialog', () => {
  beforeEach(() => {
    ctx = setupRendererTest();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('sends a cleared field as null so the backend removes it', async () => {
    ctx.mock.rpc
      .on('get_record', { success: true, project_id: TEST_PROJECT_ID, record: RECORD } as never)
      .on('prep_man_update_record', {
        success: true,
        project_id: TEST_PROJECT_ID,
        operation: 'prep_man_update_record',
        details: { new_status: 'md_prepared', message: 'ok', record: RECORD },
      } as never);
    await mountDialog();

    expect(el<HTMLButtonElement>('record-edit-save-button')!.disabled).toBe(true);

    await type('record-edit-field-booktitle', '');
    expect(el<HTMLButtonElement>('record-edit-save-button')!.disabled).toBe(false);

    el('record-edit-save-button')!.click();
    await flushPromises();

    const calls = ctx.mock.rpc.callsTo('prep_man_update_record');
    expect(calls).toHaveLength(1);
    expect(calls[0].params.fields).toEqual({ booktitle: null });
  });

  it('sends edited values as they are, next to cleared ones', async () => {
    ctx.mock.rpc
      .on('get_record', { success: true, project_id: TEST_PROJECT_ID, record: RECORD } as never)
      .on('prep_man_update_record', {
        success: true,
        project_id: TEST_PROJECT_ID,
        operation: 'prep_man_update_record',
        details: { new_status: 'md_prepared', message: 'ok', record: RECORD },
      } as never);
    await mountDialog();

    await type('record-edit-field-title', 'New title');
    await type('record-edit-field-booktitle', '   ');
    el('record-edit-save-button')!.click();
    await flushPromises();

    expect(ctx.mock.rpc.callsTo('prep_man_update_record')[0].params.fields).toEqual({
      title: 'New title',
      booktitle: null,
    });
  });

  it('does not count an untouched empty field as a change', async () => {
    ctx.mock.rpc.on('get_record', {
      success: true,
      project_id: TEST_PROJECT_ID,
      record: { ...RECORD, booktitle: undefined },
    } as never);
    await mountDialog();

    await type('record-edit-field-doi', '');
    expect(el<HTMLButtonElement>('record-edit-save-button')!.disabled).toBe(true);
  });

  it('shows why the record did not load, and can retry', async () => {
    let fail = true;
    ctx.mock.rpc.on('get_record', () => {
      if (fail) throw new Error('record vanished');
      return { success: true, project_id: TEST_PROJECT_ID, record: RECORD } as never;
    });
    await mountDialog();

    expect(el('record-edit-load-error')?.textContent).toContain('record vanished');

    fail = false;
    el('record-edit-retry-button')!.click();
    await flushPromises();

    expect(el('record-edit-load-error')).toBeNull();
    expect(el('record-edit-field-title')).not.toBeNull();
  });
});
