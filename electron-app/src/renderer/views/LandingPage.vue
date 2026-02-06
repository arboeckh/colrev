<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { Plus, FolderOpen, Loader2, RefreshCw } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ProjectCard } from '@/components/project';
import { EmptyState } from '@/components/common';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import type { InitProjectResponse } from '@/types/api';

const backend = useBackendStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();

// New project dialog state
const showNewProjectDialog = ref(false);
const newProjectId = ref('');
const isCreatingProject = ref(false);
const useExampleData = ref(true);

// Loading state for project list
const isLoadingProjects = ref(false);

async function loadAllProjects() {
  if (!backend.isRunning) return;

  isLoadingProjects.value = true;

  // Load status for each project in parallel
  await Promise.all(
    projects.projects.map(async (project) => {
      await projects.loadProjectStatus(project.id);
      await projects.loadProjectGitStatus(project.id);
    })
  );

  isLoadingProjects.value = false;
}

async function createProject() {
  if (!newProjectId.value.trim()) {
    notifications.error('Project ID required', 'Please enter a project ID');
    return;
  }

  isCreatingProject.value = true;

  try {
    const result = await backend.call<InitProjectResponse>('init_project', {
      project_id: newProjectId.value.trim(),
      review_type: 'colrev.literature_review',
      example: useExampleData.value,
      force_mode: false,
      light: false,
    });

    if (result.success) {
      notifications.success('Project created', `Created ${result.project_id}`);

      // Add to projects list and load its status
      projects.addProject(result.project_id, result.path);
      await projects.loadProjectStatus(result.project_id);
      await projects.loadProjectGitStatus(result.project_id);

      // Reset dialog
      showNewProjectDialog.value = false;
      newProjectId.value = '';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to create project', message);
  } finally {
    isCreatingProject.value = false;
  }
}

// Watch for backend becoming ready
watch(
  () => backend.isRunning,
  async (running) => {
    if (running && projects.projects.length > 0) {
      await loadAllProjects();
    }
  }
);

onMounted(async () => {
  if (backend.isRunning && projects.projects.length > 0) {
    await loadAllProjects();
  }
});
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <header class="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="max-w-5xl mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold">CoLRev</h1>
            <p class="text-sm text-muted-foreground">Collaborative Literature Reviews</p>
          </div>

          <div class="flex items-center gap-2">
            <!-- Backend status indicator -->
            <div class="flex items-center gap-2 text-sm">
              <div
                class="h-2 w-2 rounded-full"
                :class="{
                  'bg-green-500': backend.isRunning,
                  'bg-yellow-500 animate-pulse': backend.isStarting,
                  'bg-red-500': backend.status === 'error',
                  'bg-muted': backend.status === 'stopped',
                }"
              />
              <span class="text-muted-foreground capitalize">{{ backend.status }}</span>
            </div>

            <!-- Refresh button -->
            <Button
              variant="ghost"
              size="icon"
              :disabled="!backend.isRunning || isLoadingProjects"
              @click="loadAllProjects"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoadingProjects }" />
            </Button>

            <!-- New project button -->
            <Dialog v-model:open="showNewProjectDialog">
              <DialogTrigger as-child>
                <Button :disabled="!backend.isRunning">
                  <Plus class="h-4 w-4 mr-2" />
                  New Project
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Project</DialogTitle>
                  <DialogDescription>
                    Enter a unique identifier for your literature review project.
                  </DialogDescription>
                </DialogHeader>

                <div class="space-y-4 py-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Project ID</label>
                    <Input
                      v-model="newProjectId"
                      placeholder="my-literature-review"
                      data-testid="project-id-input"
                      :disabled="isCreatingProject"
                      @keyup.enter="createProject"
                    />
                    <p class="text-xs text-muted-foreground">
                      Use lowercase letters, numbers, and hyphens only.
                    </p>
                  </div>

                  <div class="flex items-center gap-2">
                    <input
                      id="useExample"
                      v-model="useExampleData"
                      type="checkbox"
                      class="rounded border-border"
                      :disabled="isCreatingProject"
                    />
                    <label for="useExample" class="text-sm">
                      Include example data (30 sample records)
                    </label>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    :disabled="isCreatingProject"
                    data-testid="cancel-create-project"
                    @click="showNewProjectDialog = false"
                  >
                    Cancel
                  </Button>
                  <Button
                    :disabled="isCreatingProject || !newProjectId.trim()"
                    data-testid="submit-create-project"
                    @click="createProject"
                  >
                    <Loader2 v-if="isCreatingProject" class="h-4 w-4 mr-2 animate-spin" />
                    Create Project
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </header>

    <!-- Main content -->
    <main class="max-w-5xl mx-auto px-6 py-8">
      <!-- Backend not running message -->
      <div v-if="!backend.isRunning && !backend.isStarting" class="text-center py-12">
        <div class="inline-flex items-center gap-2 text-yellow-500 mb-4">
          <Loader2 class="h-5 w-5 animate-spin" />
          <span>Waiting for backend to start...</span>
        </div>
      </div>

      <!-- Empty state -->
      <EmptyState
        v-else-if="projects.projects.length === 0"
        :icon="FolderOpen"
        title="No projects yet"
        description="Create your first literature review project to get started."
      >
        <template #action>
          <Button :disabled="!backend.isRunning" @click="showNewProjectDialog = true">
            <Plus class="h-4 w-4 mr-2" />
            Create Project
          </Button>
        </template>
      </EmptyState>

      <!-- Project grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ProjectCard
          v-for="project in projects.projects"
          :key="project.id"
          :project="project"
        />
      </div>
    </main>
  </div>
</template>
