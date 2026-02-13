import { computed } from 'vue';
import { useGitStore } from '@/stores/git';

/**
 * Composable providing read-only state when on the main branch.
 * All workflow actions should be disabled on main — users must switch to dev.
 */
export function useReadOnly() {
  const git = useGitStore();

  const isReadOnly = computed(() => git.isOnMain);
  const readOnlyReason = computed(() =>
    git.isOnMain ? 'You are on the main branch. Switch to dev to make changes.' : '',
  );

  async function switchToDev() {
    if (git.hasDevBranch) {
      await git.switchBranch('dev');
    } else {
      await git.ensureDevBranch();
    }
  }

  return { isReadOnly, readOnlyReason, switchToDev };
}
