/**
 * The conflict dialog is the only place a user resolves a semantic merge, and
 * a wrong resolution silently rewrites review decisions — so the mapping from
 * clicks to the `{id, choice}[]` handed to the store is worth pinning
 * (WP-08 §1).
 *
 * The dialog teleports into `document.body` (reka-ui), so assertions run
 * against the document rather than the wrapper subtree.
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ConflictResolutionDialog from './ConflictResolutionDialog.vue';
import { useGitStore } from '@/stores/git';
import type { MergeAnalysis } from '@/types/window';
import { setupRendererTest, type RendererTestContext } from '@/test/harness';

let ctx: RendererTestContext;
let wrapper: VueWrapper | null = null;

const TWO_CONFLICTS: MergeAnalysis = {
  hasConflicts: true,
  autoMergeable: false,
  conflicts: [
    {
      id: 'records:r1',
      file: 'data/records.bib',
      path: 'r1.colrev_status',
      label: 'Smith 2020',
      localValue: 'rev_included',
      remoteValue: 'rev_excluded',
    },
    {
      id: 'settings:project.title',
      file: 'settings.json',
      path: 'project.title',
      label: 'Review title',
      localValue: 'Mine',
      remoteValue: 'Theirs',
    },
  ],
  blockers: [],
};

/** Buttons rendered inside the teleported dialog, in document order. */
function dialogButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('button'));
}

function buttonWithText(text: string): HTMLButtonElement {
  const match = dialogButtons().find((b) => b.textContent?.trim().includes(text));
  if (!match) throw new Error(`no dialog button containing "${text}"`);
  return match;
}

async function click(el: HTMLElement): Promise<void> {
  el.click();
  await flush();
}

async function openDialog(analysis: MergeAnalysis = TWO_CONFLICTS) {
  const git = useGitStore();
  git.mergeAnalysis = analysis;
  git.showConflictDialog = true;
  wrapper = mount(ConflictResolutionDialog, { attachTo: document.body });
  // reka-ui mounts the teleported content on the next tick.
  await flush();
  return git;
}

/** Let Vue flush and any pending microtask settle. */
async function flush(): Promise<void> {
  await wrapper?.vm.$nextTick();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  ctx = setupRendererTest();
  ctx.openProject();
  ctx.setGitState({ branch: 'dev' });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('resolution flow', () => {
  it('keeps Apply disabled until every conflict has a choice', async () => {
    await openDialog();
    const apply = buttonWithText('Apply');
    expect(apply.disabled).toBe(true);

    await click(buttonWithText('Your version'));
    expect(buttonWithText('Apply').disabled).toBe(true);

    // Second conflict's "Collaborator's version"
    const theirs = dialogButtons().filter((b) =>
      b.textContent?.includes("Collaborator's version"),
    );
    await click(theirs[1]);
    expect(buttonWithText('Apply').disabled).toBe(false);
  });

  it('hands the store one resolution per conflict, in the user\'s choices', async () => {
    const git = await openDialog();
    const yours = dialogButtons().filter((b) => b.textContent?.includes('Your version'));
    const theirs = dialogButtons().filter((b) =>
      b.textContent?.includes("Collaborator's version"),
    );
    await click(yours[0]);
    await click(theirs[1]);
    await click(buttonWithText('Apply'));
    await flush();

    expect(ctx.mock.git.applyMerge).toHaveBeenCalledWith('/projects/alice/lit-review', 'lit-review', [
      { id: 'records:r1', choice: 'local' },
      { id: 'settings:project.title', choice: 'remote' },
    ]);
    expect(git.showConflictDialog).toBe(false);
  });

  it('offers bulk select only when there is more than one conflict', async () => {
    await openDialog();
    expect(dialogButtons().some((b) => b.textContent?.includes('Keep all yours'))).toBe(true);

    wrapper!.unmount();
    document.body.innerHTML = '';
    await openDialog({ ...TWO_CONFLICTS, conflicts: [TWO_CONFLICTS.conflicts[0]] });
    expect(dialogButtons().some((b) => b.textContent?.includes('Keep all yours'))).toBe(false);
  });

  it('bulk select resolves every conflict at once', async () => {
    await openDialog();
    await click(buttonWithText('Keep all theirs'));

    expect(buttonWithText('Apply').disabled).toBe(false);
    await click(buttonWithText('Apply'));
    await flush();

    expect(ctx.mock.git.applyMerge).toHaveBeenCalledWith(
      '/projects/alice/lit-review',
      'lit-review',
      [
        { id: 'records:r1', choice: 'remote' },
        { id: 'settings:project.title', choice: 'remote' },
      ],
    );
  });

  it('cancelling applies nothing and closes the dialog', async () => {
    const git = await openDialog();
    await click(buttonWithText('Keep all yours'));
    await click(buttonWithText('Cancel'));

    expect(ctx.mock.git.applyMerge).not.toHaveBeenCalled();
    expect(git.showConflictDialog).toBe(false);
  });

  it('does not carry choices over when the same dialog reopens', async () => {
    const git = await openDialog();
    await click(buttonWithText('Keep all yours'));
    await click(buttonWithText('Cancel'));

    git.showConflictDialog = true;
    await flush();

    // Reopening with stale choices would let Apply commit decisions the user
    // never made for this merge.
    expect(buttonWithText('Apply').disabled).toBe(true);
  });
});
