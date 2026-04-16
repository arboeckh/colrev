import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useBackendStore } from './backend';
import { useProjectsStore } from './projects';
import { useNotificationsStore } from './notifications';
import type {
  GetGitStatusResponse,
  CommitChangesResponse,
  DiscardChangesResponse,
  StagedRecordChange,
} from '@/types/generated/rpc';

type GitStatusPayload = GetGitStatusResponse['git'];

export const usePendingChangesStore = defineStore('pendingChanges', () => {
  const backend = useBackendStore();
  const projects = useProjectsStore();
  const notifications = useNotificationsStore();

  const gitStatus = ref<GitStatusPayload | null>(null);
  const isCommitting = ref(false);
  const isDiscarding = ref(false);
  const lastRefreshError = ref<string | null>(null);

  let inFlightRefresh: Promise<void> | null = null;

  const stagedRecordChanges = computed<StagedRecordChange[]>(
    () => gitStatus.value?.staged_record_changes ?? [],
  );

  const pendingCount = computed(() => {
    const status = gitStatus.value;
    if (!status) return 0;
    return status.uncommitted_changes + status.untracked_files.length;
  });

  const hasPending = computed(() => pendingCount.value > 0);

  const stagedRecordCountsByType = computed(() => {
    const counts: Record<string, number> = {};
    for (const change of stagedRecordChanges.value) {
      counts[change.change_type] = (counts[change.change_type] ?? 0) + 1;
    }
    return counts;
  });

  async function refresh(): Promise<void> {
    if (!projects.currentProjectId || !backend.isRunning) return;
    // Coalesce concurrent refreshes triggered by write-RPC hooks + polling
    if (inFlightRefresh) return inFlightRefresh;

    inFlightRefresh = (async () => {
      try {
        const response = await backend.call<GetGitStatusResponse>('get_git_status', {
          project_id: projects.currentProjectId!,
        });
        gitStatus.value = response.git;
        lastRefreshError.value = null;
      } catch (err) {
        lastRefreshError.value = err instanceof Error ? err.message : 'unknown error';
      } finally {
        inFlightRefresh = null;
      }
    })();

    return inFlightRefresh;
  }

  async function commit(message: string): Promise<boolean> {
    if (!projects.currentProjectId || !backend.isRunning) return false;
    const trimmed = message.trim();
    if (!trimmed) return false;

    isCommitting.value = true;
    try {
      const response = await backend.call<CommitChangesResponse>('commit_changes', {
        project_id: projects.currentProjectId,
        message: trimmed,
      });

      if (!response.committed) {
        notifications.info('Nothing to commit', response.message);
        await refresh();
        return false;
      }

      const shortSha = response.commit_sha?.slice(0, 7) ?? '';
      const changedCount = response.changed_files?.length ?? 0;
      notifications.success(
        'Committed',
        shortSha ? `${shortSha} — ${changedCount} file(s)` : `${changedCount} file(s)`,
      );
      await refresh();
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
      const response = await backend.call<DiscardChangesResponse>('discard_changes', {
        project_id: projects.currentProjectId,
        confirm: true,
      });

      const discardedCount = response.discarded_files?.length ?? 0;
      notifications.success(
        'Discarded',
        `${discardedCount} file(s) reverted`,
      );
      await refresh();
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

  function reset() {
    gitStatus.value = null;
    lastRefreshError.value = null;
  }

  return {
    // state
    gitStatus,
    isCommitting,
    isDiscarding,
    lastRefreshError,
    // getters
    pendingCount,
    hasPending,
    stagedRecordChanges,
    stagedRecordCountsByType,
    // actions
    refresh,
    commit,
    discardAll,
    reset,
  };
});
