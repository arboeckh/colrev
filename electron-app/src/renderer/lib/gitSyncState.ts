export type PushStatus = 'hidden' | 'idle' | 'active' | 'loading' | 'divergedBlocked' | 'offline';
export type PullStatus = 'hidden' | 'idle' | 'active' | 'loading' | 'divergedWarning' | 'offline';

export interface ButtonDescriptor<S> {
  status: S;
  label: string;
  count: number;
  tooltip: string;
}

/**
 * The push button covers two different quantities, and they are not
 * interchangeable: only one of them drains on its own.
 *
 * Uncommitted work reaches the remote only when a human presses this button —
 * the write handlers stage but never commit (see `framework/__init__.py`), and
 * the sync coordinator refuses to commit on the user's behalf. Unpushed
 * commits, by contrast, are auto-push's job and disappear within seconds.
 *
 * Adding them into one badge made auto-push look broken: the number sat still
 * through a successful push because the half that moved was never the half the
 * user was looking at. They are reported separately for that reason, and
 * `count` remains the total for callers that just need "is there anything".
 */
export interface PushDescriptor extends ButtonDescriptor<PushStatus> {
  /** Uncommitted/untracked files. Cleared only by pressing the button. */
  unsavedCount: number;
  /** Commits the remote lacks. Auto-push clears these without being asked. */
  unpushedCount: number;
}

export interface GitSyncState {
  push: PushDescriptor;
  pull: ButtonDescriptor<PullStatus>;
}

/**
 * `Save 2 · Push 1` rather than `Push (3)`: the two halves have different
 * fates, so collapsing them hides which one the user has to act on.
 */
function pushLabel(unsaved: number, unpushed: number): string {
  if (unsaved > 0 && unpushed > 0) return `Save ${unsaved} · Push ${unpushed}`;
  if (unsaved > 0) return `Save (${unsaved})`;
  if (unpushed > 0) return `Push (${unpushed})`;
  return 'Push';
}

function pushTooltip(unsaved: number, unpushed: number): string {
  if (unsaved > 0 && unpushed > 0) {
    return `${unsaved} unsaved change(s) and ${unpushed} unpushed commit(s). Click to save and push everything.`;
  }
  if (unsaved > 0) {
    return `${unsaved} unsaved change(s). Click to save and push them — automatic sync never commits for you.`;
  }
  if (unpushed > 0) {
    return `${unpushed} commit(s) not yet pushed. This happens automatically; click to push now.`;
  }
  return 'Nothing to push.';
}

export interface GitSyncInput {
  ahead: number;
  behind: number;
  pendingCount: number;
  isOffline: boolean;
  isResolving: boolean;
  isPushing: boolean;
  isPulling: boolean;
  hasRemote: boolean;
}

export function computeGitSyncState(input: GitSyncInput): GitSyncState {
  const { ahead, behind, pendingCount, isOffline, isResolving, isPushing, isPulling, hasRemote } = input;
  const pushCount = ahead + pendingCount;
  const pullCount = behind;
  /** Every push descriptor carries the same split; only status/label/tooltip vary. */
  const push = (
    status: PushStatus,
    label: string,
    tooltip: string,
  ): PushDescriptor => ({
    status,
    label,
    count: pushCount,
    tooltip,
    unsavedCount: pendingCount,
    unpushedCount: ahead,
  });

  if (!hasRemote) {
    return {
      push: push('hidden', 'Push', ''),
      pull: { status: 'hidden', label: 'Pull', count: pullCount, tooltip: '' },
    };
  }

  if (isOffline) {
    return {
      push: push('offline', pushLabel(pendingCount, ahead), 'No connection to remote.'),
      pull: {
        status: 'offline',
        label: pullCount > 0 ? `Pull (${pullCount})` : 'Pull',
        count: pullCount,
        tooltip: 'No connection to remote.',
      },
    };
  }

  if (isResolving) {
    return {
      push: push('loading', 'Pushing...', 'Analyzing and merging changes...'),
      pull: { status: 'loading', label: 'Syncing...', count: pullCount, tooltip: 'Analyzing and merging changes...' },
    };
  }

  if (isPushing) {
    return {
      push: push('loading', 'Pushing...', 'Pushing to remote...'),
      pull: {
        status: pullCount > 0 ? 'active' : 'idle',
        label: pullCount > 0 ? `Pull (${pullCount})` : 'Pull',
        count: pullCount,
        tooltip: pullCount > 0 ? `${pullCount} commit(s) available to pull.` : 'Up to date.',
      },
    };
  }

  if (isPulling) {
    return {
      push: push(
        pushCount > 0 ? 'active' : 'idle',
        pushLabel(pendingCount, ahead),
        pushTooltip(pendingCount, ahead),
      ),
      pull: { status: 'loading', label: 'Pulling...', count: pullCount, tooltip: 'Pulling from remote...' },
    };
  }

  if (ahead > 0 && behind > 0) {
    return {
      push: push(
        'divergedBlocked',
        pushLabel(pendingCount, ahead),
        'Pull first to merge remote changes before pushing.',
      ),
      pull: {
        status: 'divergedWarning',
        label: `Pull & merge (${pullCount})`,
        count: pullCount,
        tooltip: 'You and a collaborator both made changes. Click to resolve.',
      },
    };
  }

  if (pushCount > 0) {
    return {
      push: push('active', pushLabel(pendingCount, ahead), pushTooltip(pendingCount, ahead)),
      pull: { status: 'idle', label: 'Pull', count: 0, tooltip: 'Nothing to pull.' },
    };
  }

  if (pullCount > 0) {
    return {
      push: push('idle', 'Push', 'Nothing to push.'),
      pull: {
        status: 'active',
        label: `Pull (${pullCount})`,
        count: pullCount,
        tooltip: `${pullCount} commit(s) available from remote. Click to pull.`,
      },
    };
  }

  return {
    push: push('idle', 'Push', 'Nothing to push.'),
    pull: { status: 'idle', label: 'Pull', count: 0, tooltip: 'Up to date with remote.' },
  };
}
