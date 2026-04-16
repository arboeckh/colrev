import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';

/**
 * Wraps colrev operations with post-operation auto-save (push).
 *
 * Pre-op fetch/pull were removed: they held the shared git mutex in the main
 * process and queued every other git call behind a network round-trip, which
 * the user experienced as "the app is frozen while the sync pill spins."
 * Remote freshness is driven by window-focus fetch and the manual Refresh
 * button. If the push at the end fails due to divergence, the existing
 * divergence-resolution flow on the sync pill handles it.
 *
 * Flow:
 * 1. Block on main (read-only) and on known divergence
 * 2. Set isOperationRunning = true
 * 3. Run the colrev operation
 * 4. Refresh git status (local read)
 * 5. If autoSave and ahead > 0 → push
 * 6. Set isOperationRunning = false
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

      if (git.hasRemote && git.autoSave && git.ahead > 0) {
        await git.push();
      }

      return result;
    } finally {
      git.isOperationRunning = false;
    }
  }

  return { guardedOperation };
}
