import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useBackendStore } from './backend';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import { useGitStore } from './git';

/**
 * Uncommitted work, read off the one git snapshot (WP-07 §2).
 *
 * This store used to call `get_git_status` itself, which meant the header's
 * "unsaved changes" count and the git store's cleanliness flag could disagree
 * whenever one refreshed and the other didn't. It now derives everything from
 * `git.snapshot` and owns only the write actions (commit / discard).
 */
export const usePendingChangesStore = defineStore('pendingChanges', () => {
  const backend = useBackendStore();
  const projects = useProjectsStore();
  const notifications = useNotificationsStore();
  const git = useGitStore();

  const isCommitting = ref(false);
  const isDiscarding = ref(false);

  const stagedRecordChanges = computed(() => git.snapshot?.stagedRecordChanges ?? []);

  const pendingCount = computed(() => {
    const status = git.snapshot;
    if (!status) return 0;
    return status.uncommittedChanges + status.untrackedFiles.length;
  });

  const hasPending = computed(() => pendingCount.value > 0);

  const stagedRecordCountsByType = computed(() => {
    const counts: Record<string, number> = {};
    for (const change of stagedRecordChanges.value) {
      counts[change.changeType] = (counts[change.changeType] ?? 0) + 1;
    }
    return counts;
  });

  async function commit(message: string): Promise<boolean> {
    if (!projects.currentProjectId || !backend.isRunning) return false;
    const trimmed = message.trim();
    if (!trimmed) return false;

    isCommitting.value = true;
    try {
      const response = await backend.call('commit_changes', {
        project_id: projects.currentProjectId,
        message: trimmed,
      });

      if (!response.committed) {
        notifications.info('Nothing to commit', response.message);
        await git.refreshStatus();
        return false;
      }

      notifications.success('Saved');
      await git.refreshStatus();
      return true;
    } catch (err) {
      notifications.error(
        'Commit failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    } finally {
      isCommitting.value = false;
    }
  }

  async function discardAll(): Promise<boolean> {
    if (!projects.currentProjectId || !backend.isRunning) return false;

    isDiscarding.value = true;
    try {
      const response = await backend.call('discard_changes', {
        project_id: projects.currentProjectId,
        confirm: true,
      });

      const discardedCount = response.discarded_files?.length ?? 0;
      notifications.success(
        'Discarded',
        `${discardedCount} file(s) reverted`,
      );
      await git.refreshStatus();
      return true;
    } catch (err) {
      notifications.error(
        'Discard failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    } finally {
      isDiscarding.value = false;
    }
  }

  return {
    // state
    isCommitting,
    isDiscarding,
    // getters
    pendingCount,
    hasPending,
    stagedRecordChanges,
    stagedRecordCountsByType,
    // actions
    commit,
    discardAll,
  };
});
