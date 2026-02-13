<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Plus, FolderOpen, Loader2, RefreshCw, FolderKanban, Settings, Github, Globe, Lock, Download } from 'lucide-vue-next';
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
import { Badge } from '@/components/ui/badge';
import { ProjectsTable } from '@/components/project';
import { EmptyState, ThemeToggle, UserMenu } from '@/components/common';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import { useAuthStore } from '@/stores/auth';
import { useGithubReposStore } from '@/stores/github-repos';
import type { InitProjectResponse, ListProjectsResponse } from '@/types/api';

const router = useRouter();
const route = useRoute();
const backend = useBackendStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();
const auth = useAuthStore();
const githubRepos = useGithubReposStore();

// New project dialog state
const showNewProjectDialog = ref(false);
const newProjectName = ref('');
const isCreatingProject = ref(false);
const createOnGitHub = ref(false);
const isPrivateRepo = ref(true);
const isPushingToGitHub = ref(false);

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
    notifications.error('Review name required', 'Please enter a review name');
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
      // Add to projects list and load its status
      projects.addProject(result.project_id, result.path, title);
      await projects.loadProjectStatus(result.project_id);

      // Push to GitHub if requested
      if (createOnGitHub.value && auth.isAuthenticated) {
        isPushingToGitHub.value = true;
        try {
          const ghResult = await window.github.createRepoAndPush({
            repoName: slug,
            projectPath: result.path,
            isPrivate: isPrivateRepo.value,
          });
          if (ghResult.success) {
            notifications.success('Review created', `Created ${title} and pushed to GitHub`);
          } else {
            notifications.error('GitHub push failed', ghResult.error || 'Unknown error. Review was created locally.');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          notifications.error('GitHub push failed', msg + '. Review was created locally.');
        } finally {
          isPushingToGitHub.value = false;
        }
      } else {
        notifications.success('Review created', `Created ${title}`);
      }

      await projects.loadProjectGitStatus(result.project_id);

      // Create dev branch and switch to it so user starts working there
      try {
        await window.git.createBranch(result.path, 'dev', 'main');
        if (createOnGitHub.value && auth.isAuthenticated) {
          await window.git.push(result.path);
        }
      } catch {
        // Non-critical — dev branch can be created later
      }

      // Reset dialog
      showNewProjectDialog.value = false;
      newProjectName.value = '';
      createOnGitHub.value = false;

      // Navigate to the new project
      router.push({ name: 'project-overview', params: { id: result.project_id } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to create review', message);
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
          <span>Reviews</span>
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
          <h2 class="text-lg font-semibold">Reviews</h2>

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
                  New Review
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Review</DialogTitle>
                  <DialogDescription>
                    Give your literature review a name.
                  </DialogDescription>
                </DialogHeader>

                <div class="space-y-4 py-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Review Name</label>
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

                  <!-- GitHub toggle (only when authenticated) -->
                  <div v-if="auth.isAuthenticated" class="space-y-3">
                    <label class="text-sm font-medium">Repository</label>
                    <div class="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        :class="{ 'ring-2 ring-primary': !createOnGitHub }"
                        :disabled="isCreatingProject"
                        data-testid="toggle-local-only"
                        @click="createOnGitHub = false"
                      >
                        <FolderOpen class="h-4 w-4 mr-1.5" />
                        Local only
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        :class="{ 'ring-2 ring-primary': createOnGitHub }"
                        :disabled="isCreatingProject"
                        data-testid="toggle-create-on-github"
                        @click="createOnGitHub = true"
                      >
                        <Github class="h-4 w-4 mr-1.5" />
                        Create on GitHub
                      </Button>
                    </div>
                    <div v-if="createOnGitHub" class="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        class="text-xs h-7 px-2"
                        :disabled="isCreatingProject"
                        data-testid="toggle-repo-visibility"
                        @click="isPrivateRepo = !isPrivateRepo"
                      >
                        <Lock v-if="isPrivateRepo" class="h-3.5 w-3.5 mr-1" />
                        <Globe v-else class="h-3.5 w-3.5 mr-1" />
                        {{ isPrivateRepo ? 'Private' : 'Public' }}
                      </Button>
                    </div>
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
                    {{ isPushingToGitHub ? 'Pushing to GitHub...' : isCreatingProject ? 'Creating...' : 'Create Review' }}
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
          title="No reviews yet"
          description="Create your first literature review to get started."
        >
          <template #action>
            <Button :disabled="!backend.isRunning" @click="showNewProjectDialog = true">
              <Plus class="h-4 w-4 mr-2" />
              Create Review
            </Button>
          </template>
        </EmptyState>

        <!-- Projects table -->
        <ProjectsTable v-else :projects="projects.projects" />

        <!-- GitHub Projects section (only when authenticated) -->
        <div v-if="auth.isAuthenticated && backend.isRunning" class="mt-8" data-testid="github-projects-section">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <Github class="h-5 w-5 text-muted-foreground" />
              <h3 class="text-base font-semibold">GitHub Reviews</h3>
              <Badge v-if="githubRepos.availableRepos.length > 0" variant="secondary" class="text-xs">
                {{ githubRepos.availableRepos.length }}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              :disabled="githubRepos.isLoading"
              data-testid="refresh-github-repos"
              @click="githubRepos.fetchRepos(true)"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': githubRepos.isLoading }" />
            </Button>
          </div>

          <!-- Loading state -->
          <div v-if="githubRepos.isLoading && githubRepos.remoteRepos.length === 0" class="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 class="h-4 w-4 animate-spin" />
            <span>Checking your GitHub repos for CoLRev projects...</span>
          </div>

          <!-- Error state -->
          <p v-else-if="githubRepos.error" class="text-sm text-destructive py-2">
            {{ githubRepos.error }}
          </p>

          <!-- Empty state -->
          <p v-else-if="!githubRepos.isLoading && githubRepos.remoteRepos.length > 0 && githubRepos.availableRepos.length === 0" class="text-sm text-muted-foreground py-2">
            All your GitHub CoLRev reviews are already added locally.
          </p>

          <!-- Repos table -->
          <div v-else-if="githubRepos.availableRepos.length > 0" class="rounded-md border">
            <table class="w-full caption-bottom text-sm">
              <thead class="[&_tr]:border-b">
                <tr class="border-b transition-colors">
                  <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Repository</th>
                  <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-[100px]">Visibility</th>
                  <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-[120px]">Updated</th>
                  <th class="h-10 px-4 text-right align-middle font-medium text-muted-foreground w-[120px]">Actions</th>
                </tr>
              </thead>
              <tbody class="[&_tr:last-child]:border-0">
                <tr
                  v-for="repo in githubRepos.availableRepos"
                  :key="repo.fullName"
                  class="border-b transition-colors hover:bg-muted/50"
                  :data-testid="`github-repo-${repo.name}`"
                >
                  <td class="p-4 align-middle">
                    <div class="font-medium">{{ repo.name }}</div>
                    <div v-if="repo.description" class="text-xs text-muted-foreground truncate max-w-[400px]">{{ repo.description }}</div>
                  </td>
                  <td class="p-4 align-middle">
                    <Badge variant="outline" class="text-xs">
                      <Lock v-if="repo.isPrivate" class="h-3 w-3 mr-1" />
                      <Globe v-else class="h-3 w-3 mr-1" />
                      {{ repo.isPrivate ? 'Private' : 'Public' }}
                    </Badge>
                  </td>
                  <td class="p-4 align-middle text-muted-foreground text-xs">
                    {{ new Date(repo.updatedAt).toLocaleDateString() }}
                  </td>
                  <td class="p-4 align-middle text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      :disabled="githubRepos.isCloning(repo.fullName)"
                      :data-testid="`clone-repo-${repo.name}`"
                      @click="githubRepos.cloneRepo(repo)"
                    >
                      <Loader2 v-if="githubRepos.isCloning(repo.fullName)" class="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      <Download v-else class="h-3.5 w-3.5 mr-1.5" />
                      Add Locally
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
