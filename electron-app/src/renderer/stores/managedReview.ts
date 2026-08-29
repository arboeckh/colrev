import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useBackendStore } from './backend';
import { useProjectsStore } from './projects';
import { useGitStore } from './git';
import type { ManagedReviewTask } from '@/types/generated/rpc';
import type { WorkflowStep } from '@/types/project';
import { computeManagedStepStatus, type StepStatus } from '@/lib/stepStatus';

const TASK_STATES_ACTIVE = new Set(['active']);

export const useManagedReviewStore = defineStore('managedReview', () => {
  const backend = useBackendStore();
  const projects = useProjectsStore();

  // State
  const prescreenTasks = ref<ManagedReviewTask[]>([]);
  const screenTasks = ref<ManagedReviewTask[]>([]);
  const isLoading = ref(false);
  // Set when the last refresh failed. Task state gates access control, so a
  // fetch failure must be distinguishable from "no tasks": on failure the
  // last-known task lists are kept and this flag is set.
  const lastRefreshError = ref<string | null>(null);

  // Computed: active task per kind
  const activePrescreenTask = computed(() =>
    prescreenTasks.value.find((t) => TASK_STATES_ACTIVE.has(t.state)) ?? null,
  );
  const activeScreenTask = computed(() =>
    screenTasks.value.find((t) => TASK_STATES_ACTIVE.has(t.state)) ?? null,
  );

  // Computed: latest completed task per kind
  const latestCompletedPrescreenTask = computed(() =>
    prescreenTasks.value.find((t) => t.state === 'completed') ?? null,
  );
  const latestCompletedScreenTask = computed(() =>
    screenTasks.value.find((t) => t.state === 'completed') ?? null,
  );

  // Whether the current user is on a reviewer branch for a managed review
  const isOnReviewerBranch = computed(() => {
    const gitStore = useGitStore();
    return gitStore.currentBranch.startsWith('review/');
  });

  /**
   * Derive sidebar step status for any managed review step.
   * Returns the status to display, or null if this step has no managed
   * review context. Data collection only — the derivation lives in the
   * shared status module (lib/stepStatus.ts).
   */
  function getStepStatus(stepId: WorkflowStep): StepStatus | null {
    const kind = stepId === 'prescreen' ? 'prescreen' : stepId === 'screen' ? 'screen' : null;
    if (!kind) return null;

    const activeTask = kind === 'prescreen' ? activePrescreenTask.value : activeScreenTask.value;
    const completedTask = kind === 'prescreen'
      ? latestCompletedPrescreenTask.value
      : latestCompletedScreenTask.value;

    return computeManagedStepStatus({
      hasActiveTask: activeTask != null,
      hasCompletedTask: completedTask != null,
      eligibleCount: projects.payloadSteps?.[kind]?.pending_records ?? 0,
    });
  }

  async function refresh(): Promise<void> {
    const id = projects.currentProjectId;
    if (!id || !backend.isRunning) return;

    isLoading.value = true;
    try {
      // Fetch remote refs first so we can see other reviewers' progress
      const gitStore = useGitStore();
      if (gitStore.hasRemote) {
        await gitStore.fetch();
      }

      const [prescreenResp, screenResp] = await Promise.all([
        backend.call('list_managed_review_tasks', {
          project_id: id,
          kind: 'prescreen',
        }),
        backend.call('list_managed_review_tasks', {
          project_id: id,
          kind: 'screen',
        }),
      ]);
      prescreenTasks.value = prescreenResp.tasks;
      screenTasks.value = screenResp.tasks;
      lastRefreshError.value = null;
    } catch (err) {
      // Keep last-known tasks — clearing them would make a failed fetch look
      // like "no active tasks" and wrongly change access decisions.
      lastRefreshError.value = err instanceof Error ? err.message : 'Failed to load review tasks';
    } finally {
      isLoading.value = false;
    }
  }

  function cleanup() {
    prescreenTasks.value = [];
    screenTasks.value = [];
    lastRefreshError.value = null;
  }

  return {
    prescreenTasks,
    screenTasks,
    activePrescreenTask,
    activeScreenTask,
    latestCompletedPrescreenTask,
    latestCompletedScreenTask,
    isOnReviewerBranch,
    isLoading,
    lastRefreshError,
    getStepStatus,
    refresh,
    cleanup,
  };
});
