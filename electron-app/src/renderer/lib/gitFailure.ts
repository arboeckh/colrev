/**
 * Structured git failure codes (see `electron-app/src/main/git-manager.ts`)
 * and the user-facing copy for each.
 *
 * Sync operations return a code instead of raw stderr whenever the failure is
 * one the user can act on, so the UI can say what to do next rather than
 * pasting git's output into a toast.
 */
export const GIT_FAILURE_CODES = [
  'DIRTY_WORKTREE',
  'DIVERGED',
  'REJECTED_FETCH_FIRST',
  'AUTH_FAILED',
  'OFFLINE',
] as const;

export type GitFailureCode = (typeof GIT_FAILURE_CODES)[number];

export type GitOperation = 'push' | 'pull' | 'fetch' | 'sync';

export interface GitFailureCopy {
  title: string;
  detail: string;
  /** The recovery the user should reach for, when there is a single obvious one. */
  remedy?: 'pull' | 'signIn';
}

export function isGitFailureCode(error: string | null | undefined): error is GitFailureCode {
  return !!error && (GIT_FAILURE_CODES as readonly string[]).includes(error);
}

const OPERATION_LABEL: Record<GitOperation, string> = {
  push: 'Push failed',
  pull: 'Pull failed',
  fetch: 'Refresh failed',
  sync: 'Sync failed',
};

/**
 * Map a failed sync operation to what the user should see.
 *
 * `error` is whatever the main process returned: a `GitFailureCode` when the
 * failure was classifiable, otherwise raw stderr, which is passed through as
 * the detail line under a generic title.
 */
export function describeGitFailure(
  operation: GitOperation,
  error: string | null | undefined,
): GitFailureCopy {
  switch (error) {
    case 'REJECTED_FETCH_FIRST':
      return {
        title: 'Pull first',
        detail:
          'Someone else saved changes to the remote since you last pulled. Pull them in, then push again.',
        remedy: 'pull',
      };
    case 'AUTH_FAILED':
      return {
        title: 'Sign in again',
        detail:
          'GitHub rejected your credentials. Your sign-in may have expired or lost access to this repository.',
        remedy: 'signIn',
      };
    case 'OFFLINE':
      return {
        title: "You're offline",
        detail:
          'The remote could not be reached. Your work is saved locally — try again when you have a connection.',
      };
    case 'DIVERGED':
      return {
        title: 'Changes have diverged',
        detail:
          'You and a collaborator both made changes. Sync to combine them.',
        remedy: 'pull',
      };
    case 'DIRTY_WORKTREE':
      return {
        title: 'Save your work first',
        detail: 'You have unsaved changes that would be overwritten.',
      };
    default:
      return {
        title: OPERATION_LABEL[operation],
        detail: error || 'Unknown error',
      };
  }
}
