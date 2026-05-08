export type PushStatus = 'hidden' | 'idle' | 'active' | 'loading' | 'divergedBlocked' | 'offline';
export type PullStatus = 'hidden' | 'idle' | 'active' | 'loading' | 'divergedWarning' | 'offline';

export interface ButtonDescriptor<S> {
  status: S;
  label: string;
  count: number;
  tooltip: string;
}

export interface GitSyncState {
  push: ButtonDescriptor<PushStatus>;
  pull: ButtonDescriptor<PullStatus>;
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

  if (!hasRemote) {
    return {
      push: { status: 'hidden', label: 'Push', count: pushCount, tooltip: '' },
      pull: { status: 'hidden', label: 'Pull', count: pullCount, tooltip: '' },
    };
  }

  if (isOffline) {
    return {
      push: {
        status: 'offline',
        label: pushCount > 0 ? `Push (${pushCount})` : 'Push',
        count: pushCount,
        tooltip: 'No connection to remote.',
      },
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
      push: { status: 'loading', label: 'Pushing...', count: pushCount, tooltip: 'Analyzing and merging changes...' },
      pull: { status: 'loading', label: 'Syncing...', count: pullCount, tooltip: 'Analyzing and merging changes...' },
    };
  }

  if (isPushing) {
    return {
      push: { status: 'loading', label: 'Pushing...', count: pushCount, tooltip: 'Pushing to remote...' },
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
      push: {
        status: pushCount > 0 ? 'active' : 'idle',
        label: pushCount > 0 ? `Push (${pushCount})` : 'Push',
        count: pushCount,
        tooltip: pushCount > 0 ? `${pushCount} change(s) not yet pushed.` : 'Nothing to push.',
      },
      pull: { status: 'loading', label: 'Pulling...', count: pullCount, tooltip: 'Pulling from remote...' },
    };
  }

  if (ahead > 0 && behind > 0) {
    return {
      push: {
        status: 'divergedBlocked',
        label: pushCount > 0 ? `Push (${pushCount})` : 'Push',
        count: pushCount,
        tooltip: 'Pull first to merge remote changes before pushing.',
      },
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
      push: {
        status: 'active',
        label: `Push (${pushCount})`,
        count: pushCount,
        tooltip: pendingCount > 0
          ? `${pushCount} change(s) not yet saved to remote. Click to commit and push.`
          : `${ahead} local commit(s) not yet pushed. Click to push.`,
      },
      pull: { status: 'idle', label: 'Pull', count: 0, tooltip: 'Nothing to pull.' },
    };
  }

  if (pullCount > 0) {
    return {
      push: { status: 'idle', label: 'Push', count: 0, tooltip: 'Nothing to push.' },
      pull: {
        status: 'active',
        label: `Pull (${pullCount})`,
        count: pullCount,
        tooltip: `${pullCount} commit(s) available from remote. Click to pull.`,
      },
    };
  }

  return {
    push: { status: 'idle', label: 'Push', count: 0, tooltip: 'Nothing to push.' },
    pull: { status: 'idle', label: 'Pull', count: 0, tooltip: 'Up to date with remote.' },
  };
}
