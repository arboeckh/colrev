import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';

/**
 * Wraps colrev operations with pre/post guards.
 *
 * Flow:
 * 1. Block on main (read-only) and on known divergence
 * 2. Set isOperationRunning = true
 * 3. Run the colrev operation
 * 4. Refresh git status (local read)
 * 5. Set isOperationRunning = false
 */
export function useOperationGuard() {
  const git = useGitStore();
  const notifications = useNotificationsStore();

  async function guardedOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T | null> {
    if (git.isOnMain) {
      notifications.warning(
        'Read-only on main',
        'Switch to the dev branch to make changes.',
      );
      return null;
    }

    if (git.isDiverged) {
      notifications.error(
        'Cannot run operation',
        'Remote has changes that conflict with your local changes. Click Refresh, then resolve the conflict before running.',
      );
      return null;
    }

    git.isOperationRunning = true;

    try {
      const result = await operation();

      await git.refreshStatus();

      return result;
    } finally {
      git.isOperationRunning = false;
    }
  }

  return { guardedOperation };
}
