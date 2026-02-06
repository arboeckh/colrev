import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';

/**
 * Composable for polling Git status at regular intervals.
 * Automatically starts polling when mounted and stops when unmounted.
 */
export function useGitStatus(options?: {
  intervalMs?: number; // Polling interval in milliseconds (default: 30000)
  autoStart?: boolean; // Start polling automatically (default: true)
}) {
  const projects = useProjectsStore();
  const backend = useBackendStore();

  const intervalMs = options?.intervalMs ?? 30000;
  const autoStart = options?.autoStart ?? true;

  const isPolling = ref(false);
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    if (!backend.isRunning || !projects.currentProjectId) {
      return;
    }

    await projects.refreshGitStatus();
  }

  function startPolling() {
    if (isPolling.value) return;

    isPolling.value = true;

    // Initial fetch
    refresh();

    // Set up interval
    pollInterval = setInterval(() => {
      if (backend.isRunning && projects.currentProjectId) {
        refresh();
      }
    }, intervalMs);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    isPolling.value = false;
  }

  // Watch for project changes to restart polling
  watch(
    () => projects.currentProjectId,
    (newId, oldId) => {
      if (newId !== oldId && isPolling.value) {
        // Refresh immediately when project changes
        refresh();
      }
    }
  );

  // Lifecycle management
  onMounted(() => {
    if (autoStart) {
      startPolling();
    }
  });

  onUnmounted(() => {
    stopPolling();
  });

  return {
    isPolling,
    refresh,
    startPolling,
    stopPolling,
    gitStatus: projects.currentGitStatus,
  };
}
