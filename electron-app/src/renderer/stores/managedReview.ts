import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useBackendStore } from './backend';
import { useProjectsStore } from './projects';
import { useGitStore } from './git';
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

  // Whether the current user is on a reviewer branch for a managed review
  const isOnReviewerBranch = computed(() => {
    const gitStore = useGitStore();
    return gitStore.currentBranch.startsWith('review/');
  });

  /**
   * Derive sidebar step status for any managed review step.
   * Returns the status to display, or null if this step has no managed review context.
   */
  function getStepStatus(stepId: WorkflowStep): 'pending' | 'active' | 'complete' | null {
    const kind = stepId === 'prescreen' ? 'prescreen' : stepId === 'screen' ? 'screen' : null;
    if (!kind) return null;

    const activeTask = kind === 'prescreen' ? activePrescreenTask.value : activeScreenTask.value;
    const completedTask = kind === 'prescreen'
      ? latestCompletedPrescreenTask.value
      : latestCompletedScreenTask.value;

    // Active task — step is in progress
    if (activeTask) return 'active';

    // New eligible records take precedence over a past completed task:
    // if records are waiting to be screened, the step is active again.
    const eligibleState = kind === 'prescreen' ? 'md_processed' : 'pdf_prepared';
    const currently = projects.currentStatus?.currently;
    const eligibleCount = currently?.[eligibleState] ?? 0;
    if (eligibleCount > 0) return 'active';

    // Completed task and no eligible records — step is done
    if (completedTask) return 'complete';

    return 'pending';
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
    isOnReviewerBranch,
    isLoading,
    getStepStatus,
    refresh,
    cleanup,
  };
});
