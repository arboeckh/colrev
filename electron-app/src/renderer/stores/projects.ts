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
  StatusStep,
  WorkflowStepInfo,
} from '@/types/project';
import { WORKFLOW_STEPS } from '@/types/project';
import { stripUrlUserinfo } from '@/lib/utils';
import {
  computeStepStatus,
  stepsByOperation,
  type StepStatus,
  type StepsByOperation,
} from '@/lib/stepStatus';
// Lazy use only — not called at store init time (circular dep safe via Vite ESM live bindings).
import { useGitStore } from './git';
import { useManagedReviewStore } from './managedReview';
import { useProjectDataStore } from './projectData';

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
  const isLoadingProject = ref(false);
  const projectError = ref<string | null>(null);

  // Freeze state: held during branch switches to prevent sidebar flicker.
  // Snapshotted before checkout; cleared after loadProject completes.
  const frozenRecordCounts = ref<(RecordCounts & { total: number }) | null>(null);
  const frozenStepStatuses = ref<Partial<Record<WorkflowStep, StepStatus>>>({});
  const isBranchSwitching = ref(false);

  // Computed
  const hasProjects = computed(() => projects.value.length > 0);

  const currentGitStatus = computed(() => currentProject.value?.gitStatus ?? null);

  const currentSettings = computed(() => currentProject.value?.settings ?? null);

  const currentStatus = computed(() => currentProject.value?.status ?? null);

  const nextOperation = computed(() => {
    return currentStatus.value?.next_operation ?? null;
  });

  // Per-operation step payload from the engine (status.steps), keyed by
  // operation name. The single source of truth for step status/runnability.
  const payloadSteps = computed<StepsByOperation | null>(() =>
    stepsByOperation(currentStatus.value?.steps),
  );

  // Search staleness comes from the status payload only — the renderer keeps
  // no independent flag, so it can never go sticky (WP-06).
  const hasStaleSearchSources = computed(
    () => currentStatus.value?.search_stale ?? false,
  );

  // Runnability info per operation, straight from the status payload
  // (replaces the old per-operation get_operation_info fan-out).
  const operationInfo = computed<Partial<Record<WorkflowStep, StatusStep | null>>>(() => {
    const map: Partial<Record<WorkflowStep, StatusStep | null>> = {};
    for (const step of WORKFLOW_STEPS) {
      map[step.id] = null;
    }
    const steps = payloadSteps.value;
    if (steps) {
      for (const [op, payload] of Object.entries(steps)) {
        map[op as WorkflowStep] = payload;
      }
    }
    return map;
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

    // Project switch or branch-switch reload: any in-flight project-scoped
    // load belongs to the previous context — invalidate it.
    useProjectDataStore().bumpEpoch();

    // Ensure project is in list
    addProject(id);

    const guard = useProjectDataStore().snapshot();

    try {
      debug.logInfo('Starting parallel load of status, git status, settings...');

      // Load all project data in parallel
      const [status, gitStatus, settings] = await Promise.all([
        loadProjectStatus(id),
        loadProjectGitStatus(id),
        loadProjectSettings(id),
      ]);

      debug.logInfo(`Parallel load complete. Status: ${!!status}, Git: ${!!gitStatus}, Settings: ${!!settings}`);

      if (!guard.isCurrent()) {
        // Another loadProject (project or branch switch) superseded this one
        // mid-flight — let it own the state.
        return false;
      }

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

  // In-flight coalescing with a "dirty re-run": concurrent callers
  // share the in-flight refresh, and at most one follow-up is queued so a
  // refresh requested mid-flight (e.g. post-mutation) re-reads fresh data.
  let _refreshInFlight: Promise<void> | null = null;
  let _refreshQueued: Promise<void> | null = null;

  function refreshCurrentProject(): Promise<void> {
    if (_refreshInFlight) {
      if (!_refreshQueued) {
        _refreshQueued = _refreshInFlight
          .catch(() => {})
          .then(() => {
            _refreshQueued = null;
            return refreshCurrentProject();
          });
      }
      return _refreshQueued;
    }
    _refreshInFlight = _refreshCurrentProjectImpl().finally(() => {
      _refreshInFlight = null;
    });
    return _refreshInFlight;
  }

  /**
   * Refresh the current project in place, without the loading spinner.
   * Newest-wins: results from a superseded context (project/branch switch
   * mid-flight) are discarded. Throws on failure — the invalidation seam
   * (stores/projectData.ts) turns that into a visible staleness flag.
   */
  async function _refreshCurrentProjectImpl(): Promise<void> {
    if (!currentProjectId.value || !currentProject.value) return;

    const id = currentProjectId.value;
    const guard = useProjectDataStore().snapshot();

    // Load all project data in parallel
    const [status, gitStatus, settings] = await Promise.all([
      loadProjectStatus(id),
      loadProjectGitStatus(id),
      loadProjectSettings(id),
    ]);

    if (!guard.isCurrent() || !currentProject.value) return;

    if (status) {
      // Update current project in place (no flicker)
      currentProject.value = {
        ...currentProject.value,
        status,
        gitStatus: gitStatus ?? currentProject.value.gitStatus,
        settings: settings ?? currentProject.value.settings,
      };
    } else {
      throw new Error('Failed to refresh project status');
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
    // Invalidate any in-flight project-scoped loads.
    useProjectDataStore().bumpEpoch();

    // Clean up managed review state
    try {
      // Dynamic import to avoid circular deps
      import('./managedReview').then(({ useManagedReviewStore }) => {
        useManagedReviewStore().cleanup();
      });
    } catch {
      // Non-critical
    }
  }

  // Resolve effective record counts for BADGE display: on a reviewer branch
  // use dev's counts, else current. (Step *status* comes from the payload's
  // per-operation steps, not from these counts.)
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
    frozenRecordCounts.value = resolveEffectiveCounts();

    const statuses: Partial<Record<WorkflowStep, StepStatus>> = {};
    for (const step of WORKFLOW_STEPS) {
      statuses[step.id] = getStepStatus(step.id);
    }
    frozenStepStatuses.value = statuses;
    isBranchSwitching.value = true;
  }

  function endBranchSwitch(): void {
    isBranchSwitching.value = false;
  }

  function getStepStatus(stepId: WorkflowStep): StepStatus {
    const stepIndex = WORKFLOW_STEPS.findIndex((s: WorkflowStepInfo) => s.id === stepId);
    if (stepIndex === -1) return 'pending';

    if (isBranchSwitching.value) {
      return frozenStepStatuses.value[stepId] ?? 'pending';
    }

    const step = WORKFLOW_STEPS[stepIndex];
    const managedReview = useManagedReviewStore();

    const managedStatus = step.managedReviewKind
      ? managedReview.getStepStatus(stepId)
      : null;

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
      steps: payloadSteps.value,
      searchStale: hasStaleSearchSources.value,
      totalRecords: currentStatus.value?.total_records ?? 0,
      managedStepStatus: managedStatus,
      suppressCounts,
    });
  }

  return {
    // State
    projects,
    currentProjectId,
    currentProject,
    isLoadingProject,
    projectError,
    // Computed
    hasProjects,
    currentGitStatus,
    currentSettings,
    currentStatus,
    nextOperation,
    payloadSteps,
    operationInfo,
    hasStaleSearchSources,
    // Actions
    addProject,
    removeProject,
    loadProjectStatus,
    loadProjectGitStatus,
    loadProjectSettings,
    loadProject,
    refreshCurrentProject,
    refreshGitStatus,
    clearCurrentProject,
    // Branch-switch stability
    frozenRecordCounts,
    isBranchSwitching,
    snapshotSidebarState,
    endBranchSwitch,
    getStepStatus,
  };
});
