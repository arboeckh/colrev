import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';

/**
 * Wraps colrev operations with pre-operation sync (pull) and post-operation auto-save (push).
 * This is the primary conflict prevention mechanism.
 *
 * Flow:
 * 1. Set isOperationRunning = true
 * 2. Fetch from remote
 * 3. If behind > 0 and ahead == 0 and clean → auto-pull (FF)
 * 4. If diverged → show error, return null (block operation)
 * 5. Run the colrev operation
 * 6. Refresh git status
 * 7. If autoSave → push to remote
 * 8. Set isOperationRunning = false
 */
export function useOperationGuard() {
  const git = useGitStore();
  const notifications = useNotificationsStore();

  async function guardedOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T | null> {
    git.isOperationRunning = true;

    try {
      // Pre-operation: sync with remote
      if (git.hasRemote) {
        await git.fetch();

        // Auto-pull if safe
        if (git.behind > 0 && git.ahead === 0 && git.isClean) {
          const pullSuccess = await git.pull();
          if (!pullSuccess) {
            notifications.error(
              'Sync failed',
              'Could not pull latest changes. Please try again.',
            );
            return null;
          }
        }

        // Block if diverged
        if (git.isDiverged) {
          notifications.error(
            'Cannot run operation',
            'Remote has changes that conflict with your local changes. Push your changes or create a Pull Request first.',
          );
          return null;
        }
      }

      // Run the actual operation
      const result = await operation();

      // Post-operation: refresh and optionally push
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
