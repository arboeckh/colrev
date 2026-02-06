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
} from '@/types/project';
import type {
  GetStatusResponse,
  GetGitStatusResponse,
  GetSettingsResponse,
  GetOperationInfoResponse,
} from '@/types/api';

export interface ProjectListItem {
  id: string;
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
    search: null,
    load: null,
    prep: null,
    dedupe: null,
    prescreen: null,
    pdf_get: null,
    pdf_prep: null,
    screen: null,
    data: null,
  });
  const isLoadingProject = ref(false);
  const projectError = ref<string | null>(null);

  // Computed
  const hasProjects = computed(() => projects.value.length > 0);

  const currentGitStatus = computed(() => currentProject.value?.gitStatus ?? null);

  const currentSettings = computed(() => currentProject.value?.settings ?? null);

  const currentStatus = computed(() => currentProject.value?.status ?? null);

  const nextOperation = computed(() => {
    return currentStatus.value?.overall?.next_operation ?? null;
  });

  // Actions
  function addProject(id: string, path?: string) {
    const existingIndex = projects.value.findIndex((p) => p.id === id);
    if (existingIndex === -1) {
      projects.value.push({
        id,
        path: path || `${backend.basePath}/${id}`,
        status: null,
        gitStatus: null,
        loading: false,
        error: null,
      });
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
      const response = await backend.call<GetStatusResponse>('get_status', {
        project_id: id,
      });

      if (response.success && response.status) {
        if (project) {
          project.status = response.status;
          project.path = response.path;
          project.loading = false;
        }
        return response.status;
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
      const response = await backend.call<GetGitStatusResponse>('get_git_status', {
        project_id: id,
      });

      if (response.success && response.git_status) {
        const project = projects.value.find((p) => p.id === id);
        if (project) {
          project.gitStatus = response.git_status;
        }
        return response.git_status;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function loadProjectSettings(id: string): Promise<ProjectSettings | null> {
    try {
      const response = await backend.call<GetSettingsResponse>('get_settings', {
        project_id: id,
      });

      if (response.success && response.settings) {
        return response.settings;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function loadProject(id: string): Promise<boolean> {
    const debug = useDebugStore();
    debug.logInfo(`Loading project: ${id}`);

    isLoadingProject.value = true;
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

  async function loadAllOperationInfo(id: string): Promise<void> {
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
          const response = await backend.call<GetOperationInfoResponse>('get_operation_info', {
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
    if (currentProjectId.value) {
      await loadProject(currentProjectId.value);
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
    operationInfo.value = {
      search: null,
      load: null,
      prep: null,
      dedupe: null,
      prescreen: null,
      pdf_get: null,
      pdf_prep: null,
      screen: null,
      data: null,
    };
  }

  return {
    // State
    projects,
    currentProjectId,
    currentProject,
    operationInfo,
    isLoadingProject,
    projectError,
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
  };
});
