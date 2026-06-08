import { computed, type Ref } from 'vue';
import { useGitStore } from '@/stores/git';
import { usePendingChangesStore } from '@/stores/pendingChanges';

/**
 * Reconciliation needs both reviewers' decisions on the remote. Block navigation
 * until the current user's work is committed and pushed.
 */
export function useReconcileGate(options?: { ready?: Ref<boolean> }) {
  const git = useGitStore();
  const pending = usePendingChangesStore();

  const hasUnpushedWork = computed(() => {
    if (!git.hasRemote) return false;
    return git.ahead > 0 || pending.hasPending;
  });

  const canNavigateToReconcile = computed(() => {
    if (options?.ready && !options.ready.value) return false;
    return !hasUnpushedWork.value;
  });

  return { hasUnpushedWork, canNavigateToReconcile };
}
