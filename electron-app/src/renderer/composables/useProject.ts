import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import type { WorkflowStep } from '@/types/project';

/**
 * Composable for accessing and manipulating the current project.
 * Provides computed properties and actions for the active project.
 */
export function useProject() {
  const route = useRoute();
  const router = useRouter();
  const projects = useProjectsStore();
  const backend = useBackendStore();

  // Current project ID from route
  const projectId = computed(() => {
    return (route.params.id as string) || projects.currentProjectId;
  });

  // Current project data
  const project = computed(() => projects.currentProject);

  // Project status
  const status = computed(() => projects.currentStatus);

  // Git status — the one snapshot, owned by the git store (WP-07 §2).
  const gitStatus = computed(() => useGitStore().snapshot);

  // Settings
  const settings = computed(() => projects.currentSettings);

  // Loading state
  const isLoading = computed(() => projects.isLoadingProject);

  // Error state
  const error = computed(() => projects.projectError);

  // Operation info for a specific step
  function getOperationInfo(step: WorkflowStep) {
    return projects.operationInfo[step];
  }

  // Check if an operation can run
  function canRunOperation(step: WorkflowStep): boolean {
    return projects.operationInfo[step]?.runnable ?? false;
  }

  // Get affected records count for an operation
  function getAffectedRecords(step: WorkflowStep): number {
    return projects.operationInfo[step]?.pending_records ?? 0;
  }

  // Navigate to a step page
  function navigateToStep(step: WorkflowStep) {
    const stepRoutes: Record<WorkflowStep, string> = {
      review_definition: 'review-definition',
      search: 'search',
      preprocessing: 'preprocessing',
      load: 'preprocessing',
      prep: 'preprocessing',
      dedupe: 'preprocessing',
      prescreen: 'prescreen',
      pdf_get: 'pdfs',
      pdf_prep: 'pdfs',
      pdfs: 'pdfs',
      screen: 'screen',
      data: 'data',
    };

    if (projectId.value) {
      router.push(`/project/${projectId.value}/${stepRoutes[step]}`);
    }
  }

  // Refresh project data
  async function refresh() {
    if (projectId.value && backend.isRunning) {
      await projects.loadProject(projectId.value);
    }
  }

  // Go back to projects list
  function goToProjects() {
    projects.clearCurrentProject();
    router.push('/');
  }

  return {
    // State
    projectId,
    project,
    status,
    gitStatus,
    settings,
    isLoading,
    error,
    // Methods
    getOperationInfo,
    canRunOperation,
    getAffectedRecords,
    navigateToStep,
    refresh,
    goToProjects,
  };
}
