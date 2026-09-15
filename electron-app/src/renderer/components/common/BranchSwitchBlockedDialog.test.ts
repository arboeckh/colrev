/**
 * The save-or-discard dialog a dirty tree opens instead of switching branches.
 *
 * On a reviewer branch, "save" used to mean commit and nothing more. The user
 * was then moved to dev, where nothing ever pushed the reviewer branch: their
 * decisions stayed on this device, their co-reviewer saw them at 0/N, and
 * reconciliation could not start on either side. Saving there has to share.
 *
 * The dialog teleports into `document.body` (reka-ui), so assertions run
 * against the document rather than the wrapper subtree.
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BranchSwitchBlockedDialog from './BranchSwitchBlockedDialog.vue';
import { useGitStore } from '@/stores/git';
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

const REVIEWER_BRANCH = 'review/prescreen/t1/alice';

let ctx: RendererTestContext;
let wrapper: VueWrapper | null = null;

async function flush(): Promise<void> {
  await wrapper?.vm.$nextTick();
  await new Promise((r) => setTimeout(r, 0));
}

function byTestId(id: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no element with data-testid="${id}"`);
  return el;
}

async function openBlockedSwitch(branch: string, target = 'dev') {
  ctx.setGitState({
    branch,
    isClean: false,
    uncommittedChanges: 1,
    modifiedFiles: ['data/records.bib'],
  });
  const git = useGitStore();
  git.blockedSwitchTarget = target;
  git.blockedSwitchDirty = { uncommittedCount: 1, untrackedCount: 0 };
  git.showBranchSwitchBlockedDialog = true;
  wrapper = mount(BranchSwitchBlockedDialog, { attachTo: document.body });
  await flush();
  return git;
}

/** The commit lands: the tree is clean and the branch is one ahead. */
function commitSucceeds(branch: string) {
  ctx.mock.rpc.on('commit_changes', () => {
    ctx.setGitState({ branch, ahead: 1 });
    return {
      success: true,
      project_id: TEST_PROJECT_ID,
      committed: true,
      message: 'Committed',
    };
  });
}

beforeEach(() => {
  ctx = setupRendererTest();
  ctx.openProject();
  ctx.mock.rpc
    .on('get_status', statusResponse())
    .on('get_settings', settingsResponse())
    .on('get_branch_delta', branchDeltaResponse())
    .on('list_managed_review_tasks', (p) => tasksResponse(p.kind, []));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('BranchSwitchBlockedDialog', () => {
  it('shares saved decisions before leaving a reviewer branch', async () => {
    commitSucceeds(REVIEWER_BRANCH);
    await openBlockedSwitch(REVIEWER_BRANCH);

    byTestId('branch-switch-blocked-save').click();
    await flush();
    await flush();

    expect(ctx.mock.rpc.countOf('commit_changes')).toBe(1);
    expect(ctx.mock.git.push).toHaveBeenCalledWith(TEST_PROJECT_PATH);
    expect(ctx.mock.git.checkout).toHaveBeenCalledWith(TEST_PROJECT_PATH, 'dev');
    // Pushed while the reviewer branch was still checked out.
    expect(ctx.mock.git.push.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.mock.git.checkout.mock.invocationCallOrder[0],
    );
  });

  it('speaks about decisions, not branches, when leaving a review', async () => {
    await openBlockedSwitch(REVIEWER_BRANCH);

    const text = document.body.textContent ?? '';
    expect(text).toContain('Save your decisions before leaving the review');
    // Git reports changed files, not records: a count here would be wrong.
    expect(text).not.toMatch(/\d+ unsaved/);
    expect(byTestId('branch-switch-blocked-save').textContent).toContain(
      'Save and share my decisions',
    );
    expect(byTestId('branch-switch-blocked-cancel').textContent).toContain('Stay in the review');
  });

  it('keeps the plain save-then-switch for ordinary branches', async () => {
    commitSucceeds('dev');
    await openBlockedSwitch('dev', 'main');

    expect(document.body.textContent).toContain('Save your work before switching');
    byTestId('branch-switch-blocked-save').click();
    await flush();
    await flush();

    expect(ctx.mock.rpc.countOf('commit_changes')).toBe(1);
    expect(ctx.mock.git.push).not.toHaveBeenCalled();
    expect(ctx.mock.git.checkout).toHaveBeenCalledWith(TEST_PROJECT_PATH, 'main');
  });

  it('runs the caller’s continuation once the switch goes through', async () => {
    commitSucceeds(REVIEWER_BRANCH);
    const git = await openBlockedSwitch(REVIEWER_BRANCH);
    let resumed = 0;
    git.blockedSwitchResume = () => {
      resumed += 1;
    };

    byTestId('branch-switch-blocked-save').click();
    await flush();
    await flush();

    expect(resumed).toBe(1);
  });
});
