import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGitStore } from './git';
import { usePendingChangesStore } from './pendingChanges';
import { useProjectsStore } from './projects';
import type { GitStateSnapshot } from '@/types/window';

function snapshot(overrides: Partial<GitStateSnapshot> = {}): GitStateSnapshot {
  return {
    projectId: 'lit-review',
    branch: 'dev',
    ahead: 0,
    behind: 0,
    mainAhead: 0,
    mainBehind: 0,
    isClean: true,
    remoteUrl: 'https://github.com/acme/lit-review.git',
    hasMergeConflict: false,
    uncommittedChanges: 0,
    modifiedFiles: [],
    stagedFiles: [],
    untrackedFiles: [],
    stagedRecordChanges: [],
    lastCommit: null,
    refreshedAt: 1,
    ...overrides,
  };
}

describe('git store as snapshot subscriber (WP-07 §2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useProjectsStore().currentProjectId = 'lit-review';
  });

  it('derives every git fact from the snapshot it is handed', () => {
    const git = useGitStore();
    expect(git.currentBranch).toBe('main');

    git.applySnapshot(
      snapshot({ branch: 'review/prescreen/t1/alice', ahead: 3, behind: 2, isClean: false }),
    );

    expect(git.currentBranch).toBe('review/prescreen/t1/alice');
    expect(git.ahead).toBe(3);
    expect(git.behind).toBe(2);
    expect(git.isClean).toBe(false);
    expect(git.isOnDev).toBe(false);
    expect(git.isDiverged).toBe(true);
  });

  it('keeps a snapshot per project so a late arrival cannot overwrite the current one', () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ branch: 'dev' }));
    git.applySnapshot(snapshot({ projectId: 'other', branch: 'main' }));

    expect(git.currentBranch).toBe('dev');
    expect(git.snapshotFor('other')?.branch).toBe('main');
  });

  it('feeds pending changes from the same snapshot, not a second read', () => {
    const git = useGitStore();
    const pending = usePendingChangesStore();

    git.applySnapshot(
      snapshot({
        isClean: false,
        uncommittedChanges: 2,
        untrackedFiles: ['notes.md'],
        stagedRecordChanges: [
          { recordId: 'r1', changeType: 'modified' },
          { recordId: 'r2', changeType: 'modified' },
          { recordId: 'r3', changeType: 'added' },
        ],
      }),
    );

    expect(pending.pendingCount).toBe(3);
    expect(pending.hasPending).toBe(true);
    expect(pending.stagedRecordCountsByType).toEqual({ modified: 2, added: 1 });
    // Cleanliness and the pending count can no longer disagree.
    expect(git.isClean).toBe(!pending.hasPending);
  });

  it('reports push/pull affordances off the one snapshot', () => {
    const git = useGitStore();

    git.applySnapshot(snapshot({ ahead: 1 }));
    expect(git.canPush).toBe(true);
    expect(git.canPull).toBe(false);

    git.applySnapshot(snapshot({ ahead: 0, behind: 4 }));
    expect(git.canPush).toBe(false);
    expect(git.canPull).toBe(true);

    // Diverged: neither direction is a plain fast-forward.
    git.applySnapshot(snapshot({ ahead: 1, behind: 1 }));
    expect(git.canPush).toBe(false);
    expect(git.canPull).toBe(false);
  });

  it('tracks the merge-conflict flag through the snapshot', () => {
    const git = useGitStore();
    expect(git.hasMergeConflict).toBe(false);
    git.applySnapshot(snapshot({ hasMergeConflict: true }));
    expect(git.hasMergeConflict).toBe(true);
  });

  it('ignores a null snapshot rather than blanking the view', () => {
    const git = useGitStore();
    git.applySnapshot(snapshot({ branch: 'dev' }));
    git.applySnapshot(null);
    expect(git.currentBranch).toBe('dev');
  });
});
