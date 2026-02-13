<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Plus, FolderOpen, Loader2, RefreshCw, FolderKanban, Settings } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ProjectsTable } from '@/components/project';
import { EmptyState, ThemeToggle, UserMenu } from '@/components/common';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import type { InitProjectResponse, ListProjectsResponse } from '@/types/api';

const router = useRouter();
const route = useRoute();
const backend = useBackendStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();

// New project dialog state
const showNewProjectDialog = ref(false);
const newProjectName = ref('');
const isCreatingProject = ref(false);

// Auto-generate slug from project name
const generatedSlug = computed(() => {
  const name = newProjectName.value.trim();
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
});

// Loading state for project list
const isLoadingProjects = ref(false);

async function discoverProjects() {
  if (!backend.isRunning) return;

  isLoadingProjects.value = true;

  try {
    // Discover existing projects from disk
    const response = await backend.call<ListProjectsResponse>('list_projects', {});

    if (response.success && response.projects) {
      // Add discovered projects to the store
      for (const proj of response.projects) {
        projects.addProject(proj.id, proj.path, proj.title);
      }
    }
  } catch (err) {
    console.error('Failed to discover projects:', err);
  } finally {
    isLoadingProjects.value = false;
  }

  // Projects are displayed immediately
  // Status/git status will be loaded on-demand when viewing individual projects
}

async function createProject() {
  if (!generatedSlug.value) {
    notifications.error('Project name required', 'Please enter a project name');
    return;
  }

  isCreatingProject.value = true;

  const title = newProjectName.value.trim();
  const slug = generatedSlug.value;

  try {
    const result = await backend.call<InitProjectResponse>('init_project', {
      project_id: slug,
      title,
      review_type: 'colrev.literature_review',
      example: false,
      force_mode: false,
      light: false,
    });

    if (result.success) {
      notifications.success('Project created', `Created ${title}`);

      // Add to projects list and load its status
      projects.addProject(result.project_id, result.path, title);
      await projects.loadProjectStatus(result.project_id);
      await projects.loadProjectGitStatus(result.project_id);

      // Reset dialog
      showNewProjectDialog.value = false;
      newProjectName.value = '';

      // Navigate to the new project
      router.push({ name: 'project-overview', params: { id: result.project_id } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to create project', message);
  } finally {
    isCreatingProject.value = false;
  }
}

// Note: Initial project discovery is handled in App.vue after backend starts
// The discoverProjects function here is only for manual refresh
</script>

<template>
  <div class="flex h-screen bg-background">
    <!-- Sidebar -->
    <aside class="w-56 border-r border-border bg-muted/30 flex flex-col">
      <!-- App branding -->
      <div class="px-4 py-4">
        <h1 class="text-lg font-bold">CoLRev</h1>
        <p class="text-xs text-muted-foreground">Collaborative Literature Reviews</p>
      </div>

      <ScrollArea class="flex-1 px-3">
        <!-- Projects nav item -->
        <RouterLink
          to="/"
          class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors mb-1 bg-accent text-accent-foreground font-medium"
        >
          <FolderKanban class="h-4 w-4" />
          <span>Projects</span>
        </RouterLink>

        <!-- Settings nav item (placeholder) -->
        <button
          disabled
          class="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground/50 cursor-not-allowed"
        >
          <Settings class="h-4 w-4" />
          <span>Settings</span>
        </button>
      </ScrollArea>

      <!-- User menu at the bottom -->
      <div class="border-t border-border p-2">
        <UserMenu />
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header bar -->
      <header class="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div class="flex h-full items-center justify-between px-6">
          <h2 class="text-lg font-semibold">Projects</h2>

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

            <!-- Theme toggle -->
            <ThemeToggle />

            <!-- Refresh button -->
            <Button
              variant="ghost"
              size="icon"
              :disabled="!backend.isRunning || isLoadingProjects"
              @click="discoverProjects"
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
                    Give your literature review project a name.
                  </DialogDescription>
                </DialogHeader>

                <div class="space-y-4 py-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Project Name</label>
                    <Input
                      v-model="newProjectName"
                      placeholder="My Literature Review"
                      data-testid="project-id-input"
                      :disabled="isCreatingProject"
                      @keyup.enter="createProject"
                    />
                    <p v-if="generatedSlug" class="text-xs text-muted-foreground">
                      ID: {{ generatedSlug }}
                    </p>
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
                    :disabled="isCreatingProject || !generatedSlug"
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
      </header>

      <!-- Page content -->
      <main class="flex-1 overflow-auto px-6 py-8">
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

        <!-- Projects table -->
        <ProjectsTable v-else :projects="projects.projects" />
      </main>
    </div>
  </div>
</template>
