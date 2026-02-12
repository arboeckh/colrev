import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
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

  // Git status
  const gitStatus = computed(() => projects.currentGitStatus);

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
    return projects.operationInfo[step]?.can_run ?? false;
  }

  // Get affected records count for an operation
  function getAffectedRecords(step: WorkflowStep): number {
    return projects.operationInfo[step]?.affected_records ?? 0;
  }

  // Navigate to a step page
  function navigateToStep(step: WorkflowStep) {
    const stepRoutes: Record<WorkflowStep, string> = {
      review_definition: 'review-definition',
      search: 'search',
      preprocessing: 'preprocessing',
      load: 'load',
      prep: 'prep',
      dedupe: 'dedupe',
      prescreen: 'prescreen',
      pdfs: 'pdfs',
      pdf_get: 'pdfs',
      pdf_prep: 'pdfs',
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
