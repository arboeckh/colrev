import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useBackendStore } from './backend';
import { useDebugStore } from './debug';
import type {
  Project,
  ProjectStatus,
  GitStatus,
  ProjectSettings,
  WorkflowStep,
  RecordCounts,
  OverallRecordCounts,
  WorkflowStepInfo,
} from '@/types/project';
import { WORKFLOW_STEPS } from '@/types/project';
import type { GetOperationInfoResponse } from '@/types/generated/rpc';
import { stripUrlUserinfo } from '@/lib/utils';
import { computeStepStatus, type StepStatus } from '@/lib/stepStatus';
// Lazy use only — not called at store init time (circular dep safe via Vite ESM live bindings).
import { useGitStore } from './git';
import { useManagedReviewStore } from './managedReview';

function sanitizeGitStatus(git: GitStatus): GitStatus {
  if (git.remote_url) {
    return { ...git, remote_url: stripUrlUserinfo(git.remote_url) };
  }
  return git;
}

export interface ProjectListItem {
  id: string;
  title: string;
  path: string;
  status: ProjectStatus | null;
  gitStatus: GitStatus | null;
  loading: boolean;
  error: string | null;
}

export const useProjectsStore = defineStore('projects', () => {
  const backend = useBackendStore();

  // State
  const projects = ref<ProjectListItem[]>([]);
  const currentProjectId = ref<string | null>(null);
  const currentProject = ref<Project | null>(null);
  const operationInfo = ref<Record<WorkflowStep, GetOperationInfoResponse | null>>({
    review_definition: null,
    search: null,
    preprocessing: null,
    load: null,
    prep: null,
    dedupe: null,
    prescreen: null,
    pdf_get: null,
    pdf_prep: null,
    pdfs: null,
    screen: null,
    data: null,
  });
  // Track if any search sources are stale (need re-running)
  const hasStaleSearchSources = ref(false);
  const isLoadingProject = ref(false);
  const projectError = ref<string | null>(null);
  // Bumped after pull/merge to force view remount and data re-fetch
  const dataVersion = ref(0);

  // Freeze state: held during branch switches to prevent sidebar flicker.
  // Snapshotted before checkout; cleared after loadProject completes.
  const frozenRecordCounts = ref<(RecordCounts & { total: number }) | null>(null);
  const frozenOverallCounts = ref<OverallRecordCounts | null>(null);
  const frozenManagedStatuses = ref<Partial<Record<WorkflowStep, StepStatus | null>>>({});
  const isBranchSwitching = ref(false);

  // Computed
  const hasProjects = computed(() => projects.value.length > 0);

  const currentGitStatus = computed(() => currentProject.value?.gitStatus ?? null);

  const currentSettings = computed(() => currentProject.value?.settings ?? null);

  const currentStatus = computed(() => currentProject.value?.status ?? null);

  const nextOperation = computed(() => {
    return currentStatus.value?.next_operation ?? null;
  });

  // Actions
  function addProject(id: string, path?: string, title?: string, prepend = false) {
    const existingIndex = projects.value.findIndex((p) => p.id === id);
    if (existingIndex === -1) {
      const item: ProjectListItem = {
        id,
        title: title || id,
        path: path || `${backend.basePath}/${id}`,
        status: null,
        gitStatus: null,
        loading: false,
        error: null,
      };
      if (prepend) {
        projects.value.unshift(item);
      } else {
        projects.value.push(item);
      }
    }
  }

  function removeProject(id: string) {
    const index = projects.value.findIndex((p) => p.id === id);
    if (index !== -1) {
      projects.value.splice(index, 1);
    }
    if (currentProjectId.value === id) {
      currentProjectId.value = null;
      currentProject.value = null;
    }
  }

  async function loadProjectStatus(id: string): Promise<ProjectStatus | null> {
    const project = projects.value.find((p) => p.id === id);
    if (project) {
      project.loading = true;
      project.error = null;
    }

    try {
      const response = await backend.call('get_status', {
        project_id: id,
      });

      if (response.success && response.status) {
        const status = response.status as unknown as ProjectStatus;
        if (project) {
          project.status = status;
          project.path = response.path;
          project.loading = false;
        }
        return status;
      }
      return null;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load status';
      if (project) {
        project.error = errorMsg;
        project.loading = false;
      }
      return null;
    }
  }

  async function loadProjectGitStatus(id: string): Promise<GitStatus | null> {
    try {
      const response = await backend.call('get_git_status', {
        project_id: id,
      });

      if (response.success && response.git) {
        const git = sanitizeGitStatus(response.git as unknown as GitStatus);
        const project = projects.value.find((p) => p.id === id);
        if (project) {
          project.gitStatus = git;
        }
        return git;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function loadProjectSettings(id: string): Promise<ProjectSettings | null> {
    try {
      const response = await backend.call('get_settings', {
        project_id: id,
      });

      if (response.success && response.settings) {
        return response.settings as unknown as ProjectSettings;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function loadProject(id: string): Promise<boolean> {
    const debug = useDebugStore();
    debug.logInfo(`Loading project: ${id}`);

    // Only show full loading state for initial load (different project).
    // Reloading the same project (e.g. after branch switch) should NOT
    // unmount the page via AppLayout's v-if="isLoadingProject".
    const isReload = currentProjectId.value === id;
    if (!isReload) {
      isLoadingProject.value = true;
    }
    projectError.value = null;
    currentProjectId.value = id;

    // Ensure project is in list
    addProject(id);

    try {
      debug.logInfo('Starting parallel load of status, git status, settings...');

      // Load all project data in parallel
      const [status, gitStatus, settings] = await Promise.all([
        loadProjectStatus(id),
        loadProjectGitStatus(id),
        loadProjectSettings(id),
      ]);

      debug.logInfo(`Parallel load complete. Status: ${!!status}, Git: ${!!gitStatus}, Settings: ${!!settings}`);

      if (!status) {
        projectError.value = 'Failed to load project status';
        debug.logError('Project status is null/undefined');
        isLoadingProject.value = false;
        return false;
      }

      const projectItem = projects.value.find((p) => p.id === id);

      currentProject.value = {
        id,
        path: projectItem?.path || `${backend.basePath}/${id}`,
        status,
        gitStatus,
        settings,
      };

      debug.logInfo('Loading operation info for all steps...');

      // Load operation info for all steps
      await loadAllOperationInfo(id);

      // Load managed review task state for sidebar status
      try {
        const { useManagedReviewStore } = await import('./managedReview');
        const managedReviewStore = useManagedReviewStore();
        await managedReviewStore.refresh();
      } catch {
        // Non-critical
      }

      // Auto-switch to dev (the working branch) if currently on main.
      // Reviewer branches (review/*) are handled by the router guard in
      // router/index.ts — NOT here, because switchBranch calls loadProject
      // which would create an infinite loop.
      try {
        const { useGitStore } = await import('./git');
        const gitStore = useGitStore();
        if (gitStore.isOnMain) {
          await gitStore.ensureDevBranch();
          if (gitStore.currentBranch !== 'dev') {
            await gitStore.switchBranch('dev');
          }
        }
      } catch {
        // Non-critical — user can still work on whatever branch they're on
      }

      debug.logInfo('Project load complete');
      isLoadingProject.value = false;
      return true;
    } catch (err) {
      projectError.value = err instanceof Error ? err.message : 'Failed to load project';
      debug.logError(`Project load failed: ${projectError.value}`, err);
      isLoadingProject.value = false;
      return false;
    }
  }

  let _opInfoInFlight: Promise<void> | null = null;

  async function loadAllOperationInfo(id: string): Promise<void> {
    if (_opInfoInFlight) return _opInfoInFlight;
    _opInfoInFlight = _loadAllOperationInfoImpl(id);
    try { await _opInfoInFlight; } finally { _opInfoInFlight = null; }
  }

  async function _loadAllOperationInfoImpl(id: string): Promise<void> {
    const operations: WorkflowStep[] = [
      'search',
      'load',
      'prep',
      'dedupe',
      'prescreen',
      'pdf_get',
      'pdf_prep',
      'screen',
      'data',
    ];

    await Promise.all(
      operations.map(async (op) => {
        try {
          const response = await backend.call('get_operation_info', {
            project_id: id,
            operation: op,
          });
          operationInfo.value[op] = response;
        } catch {
          operationInfo.value[op] = null;
        }
      })
    );
  }

  async function refreshCurrentProject(): Promise<void> {
    if (!currentProjectId.value || !currentProject.value) return;

    const id = currentProjectId.value;

    // Refresh WITHOUT showing loading spinner (keeps current content visible)
    try {
      // Load all project data in parallel
      const [status, gitStatus, settings] = await Promise.all([
        loadProjectStatus(id),
        loadProjectGitStatus(id),
        loadProjectSettings(id),
      ]);

      if (status) {
        // Update current project in place (no flicker)
        currentProject.value = {
          ...currentProject.value,
          status,
          gitStatus: gitStatus ?? currentProject.value.gitStatus,
          settings: settings ?? currentProject.value.settings,
        };
      }

      // Refresh operation info
      await loadAllOperationInfo(id);

      const searchOp = operationInfo.value.search;
      if (searchOp?.needs_rerun) {
        hasStaleSearchSources.value = true;
      }

      // Refresh managed review task state for sidebar
      try {
        const { useManagedReviewStore } = await import('./managedReview');
        const managedReviewStore = useManagedReviewStore();
        await managedReviewStore.refresh();
      } catch {
        // Non-critical
      }

      // Refresh branch delta (fire-and-forget) when on dev
      try {
        const { useGitStore } = await import('./git');
        const gitStore = useGitStore();
        if (gitStore.isOnDev) {
          gitStore.refreshBranchDelta();
        }
      } catch {
        // Non-critical
      }
    } catch (err) {
      console.error('Failed to refresh project:', err);
      // Keep existing data on error - don't clear
    }
  }

  async function refreshGitStatus(): Promise<void> {
    if (currentProjectId.value) {
      const gitStatus = await loadProjectGitStatus(currentProjectId.value);
      if (currentProject.value && gitStatus) {
        currentProject.value.gitStatus = gitStatus;
      }
    }
  }

  function clearCurrentProject() {
    currentProjectId.value = null;
    currentProject.value = null;
    projectError.value = null;
    hasStaleSearchSources.value = false;

    // Clean up managed review state
    try {
      // Dynamic import to avoid circular deps
      import('./managedReview').then(({ useManagedReviewStore }) => {
        useManagedReviewStore().cleanup();
      });
    } catch {
      // Non-critical
    }
    operationInfo.value = {
      review_definition: null,
      search: null,
      preprocessing: null,
      load: null,
      prep: null,
      dedupe: null,
      prescreen: null,
      pdf_get: null,
      pdf_prep: null,
      pdfs: null,
      screen: null,
      data: null,
    };
  }

  function setHasStaleSearchSources(value: boolean) {
    hasStaleSearchSources.value = value;
  }

  // Resolve effective record counts: on a reviewer branch use dev's counts, else current.
  function resolveEffectiveCounts(): (RecordCounts & { total: number }) | null {
    const git = useGitStore();
    const managedReview = useManagedReviewStore();
    const rawCounts = currentStatus.value?.currently ?? null;
    if (managedReview.isOnReviewerBranch && git.devRecordCounts) {
      const devCounts = git.devRecordCounts as globalThis.Record<string, number>;
      const total = Object.values(devCounts).reduce((sum, n) => sum + n, 0);
      return { ...(devCounts as unknown as RecordCounts), total };
    }
    if (rawCounts) {
      return { ...rawCounts, total: currentStatus.value?.total_records ?? 0 };
    }
    return null;
  }

  // Snapshot sidebar data before a branch switch so it remains stable during reload.
  function snapshotSidebarState(): void {
    const managedReview = useManagedReviewStore();

    frozenRecordCounts.value = resolveEffectiveCounts();
    frozenOverallCounts.value = currentStatus.value?.overall ?? null;

    const statuses: Partial<Record<WorkflowStep, StepStatus | null>> = {};
    for (const step of WORKFLOW_STEPS) {
      if (step.managedReviewKind) {
        statuses[step.id] = managedReview.getStepStatus(step.id);
      }
    }
    frozenManagedStatuses.value = statuses;
    isBranchSwitching.value = true;
  }

  function endBranchSwitch(): void {
    isBranchSwitching.value = false;
  }

  function getStepStatus(stepId: WorkflowStep): StepStatus {
    const stepIndex = WORKFLOW_STEPS.findIndex((s: WorkflowStepInfo) => s.id === stepId);
    if (stepIndex === -1) return 'pending';
    const step = WORKFLOW_STEPS[stepIndex];
    const managedReview = useManagedReviewStore();

    let counts: (RecordCounts & { total: number }) | null;
    let overall: OverallRecordCounts | null;
    let managedStatus: StepStatus | null;

    if (isBranchSwitching.value) {
      counts = frozenRecordCounts.value;
      overall = frozenOverallCounts.value;
      managedStatus = frozenManagedStatuses.value[stepId] ?? null;
    } else {
      counts = resolveEffectiveCounts();
      overall = currentStatus.value?.overall ?? null;
      managedStatus = step.managedReviewKind ? managedReview.getStepStatus(stepId) : null;
    }

    let suppressCounts = false;
    if (managedReview.isOnReviewerBranch) {
      const activeKind = managedReview.activePrescreenTask
        ? 'prescreen'
        : managedReview.activeScreenTask
          ? 'screen'
          : null;
      if (activeKind) {
        const reviewStepIdx = WORKFLOW_STEPS.findIndex((s: WorkflowStepInfo) => s.id === activeKind);
        suppressCounts = reviewStepIdx !== -1 && stepIndex > reviewStepIdx;
      }
    }

    return computeStepStatus(step, stepIndex, WORKFLOW_STEPS, {
      counts,
      overall,
      hasStaleSearchSources: hasStaleSearchSources.value,
      managedStepStatus: managedStatus,
      suppressCounts,
    });
  }

  return {
    // State
    projects,
    currentProjectId,
    currentProject,
    operationInfo,
    hasStaleSearchSources,
    isLoadingProject,
    projectError,
    dataVersion,
    // Computed
    hasProjects,
    currentGitStatus,
    currentSettings,
    currentStatus,
    nextOperation,
    // Actions
    addProject,
    removeProject,
    loadProjectStatus,
    loadProjectGitStatus,
    loadProjectSettings,
    loadProject,
    loadAllOperationInfo,
    refreshCurrentProject,
    refreshGitStatus,
    clearCurrentProject,
    setHasStaleSearchSources,
    // Branch-switch stability
    frozenRecordCounts,
    isBranchSwitching,
    snapshotSidebarState,
    endBranchSwitch,
    getStepStatus,
  };
});
