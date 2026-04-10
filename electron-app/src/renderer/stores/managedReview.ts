import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useBackendStore } from './backend';
import { useProjectsStore } from './projects';
import type { ManagedReviewTask, ListManagedReviewTasksResponse } from '@/types/api';
import type { WorkflowStep } from '@/types/project';

const TASK_STATES_ACTIVE = new Set(['active', 'reconciling']);

export const useManagedReviewStore = defineStore('managedReview', () => {
  const backend = useBackendStore();
  const projects = useProjectsStore();

  // State
  const prescreenTasks = ref<ManagedReviewTask[]>([]);
  const screenTasks = ref<ManagedReviewTask[]>([]);
  const isLoading = ref(false);

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

  /**
   * Derive sidebar step status for any managed review step.
   * Returns the status to display, or null if this step has no managed review context.
   */
  function getStepStatus(stepId: WorkflowStep): 'pending' | 'active' | 'complete' | null {
    const isPrescreen = stepId.startsWith('prescreen');
    const kind = isPrescreen ? 'prescreen' : 'screen';
    const activeTask = kind === 'prescreen' ? activePrescreenTask.value : activeScreenTask.value;
    const completedTask = kind === 'prescreen'
      ? latestCompletedPrescreenTask.value
      : latestCompletedScreenTask.value;

    const isLaunch = stepId.endsWith('_launch');
    const isReconcile = stepId.endsWith('_reconcile');

    // Active or reconciling task exists
    if (activeTask) {
      const allReviewersDone = activeTask.reviewer_progress.every((r) => r.pending_count === 0);

      if (isLaunch) return 'complete';

      if (isReconcile) {
        if (allReviewersDone) return 'active';
        return 'pending';
      }

      // Review step
      if (allReviewersDone) return 'complete';
      return 'active';
    }

    // A completed task exists (reconciliation done)
    if (completedTask) {
      return 'complete';
    }

    // No task exists at all
    if (isLaunch) {
      // Check if there are eligible records to show launch as actionable
      const eligibleState = kind === 'prescreen' ? 'md_processed' : 'pdf_prepared';
      const currently = projects.currentStatus?.currently;
      const eligibleCount = currently?.[eligibleState] ?? 0;
      return eligibleCount > 0 ? 'active' : 'pending';
    }

    // No task → review and reconcile are pending
    return 'pending';
  }

  async function refresh(): Promise<void> {
    const id = projects.currentProjectId;
    if (!id || !backend.isRunning) return;

    isLoading.value = true;
    try {
      const [prescreenResp, screenResp] = await Promise.all([
        backend.call<ListManagedReviewTasksResponse>('list_managed_review_tasks', {
          project_id: id,
          kind: 'prescreen',
        }),
        backend.call<ListManagedReviewTasksResponse>('list_managed_review_tasks', {
          project_id: id,
          kind: 'screen',
        }),
      ]);
      prescreenTasks.value = prescreenResp.tasks;
      screenTasks.value = screenResp.tasks;
    } catch {
      prescreenTasks.value = [];
      screenTasks.value = [];
    } finally {
      isLoading.value = false;
    }
  }

  function cleanup() {
    prescreenTasks.value = [];
    screenTasks.value = [];
  }

  return {
    prescreenTasks,
    screenTasks,
    activePrescreenTask,
    activeScreenTask,
    latestCompletedPrescreenTask,
    latestCompletedScreenTask,
    isLoading,
    getStepStatus,
    refresh,
    cleanup,
  };
});
