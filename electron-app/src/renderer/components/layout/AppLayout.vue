<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AlertTriangle, ArrowDown, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import Header from './Header.vue';
import Sidebar from './Sidebar.vue';
import { ReadOnlyBanner } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';

const route = useRoute();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();
const notifications = useNotificationsStore();

// Load project when route changes
async function loadProjectFromRoute() {
  const projectId = route.params.id as string;

  if (!projectId) return;

  // Only load if different from current project
  if (projectId !== projects.currentProjectId) {
    if (!backend.isRunning) {
      notifications.error('Backend not running', 'Please wait for the backend to start');
      return;
    }

    const success = await projects.loadProject(projectId);
    if (!success) {
      notifications.error('Failed to load review', projects.projectError || undefined);
    } else {
      // Initialize git state after project loads
      await git.initialize();
    }
  }
}

// Fetch on window focus
function handleWindowFocus() {
  if (git.hasRemote && projects.currentProjectId) {
    git.fetch();
  }
}

// Watch for route changes
watch(
  () => route.params.id,
  () => {
    loadProjectFromRoute();
  },
  { immediate: false }
);

// Load project on mount if backend is running
onMounted(async () => {
  window.addEventListener('focus', handleWindowFocus);

  // Wait for backend if it's starting
  if (backend.isStarting) {
    const unwatch = watch(
      () => backend.isRunning,
      async (running) => {
        if (running) {
          unwatch();
          await loadProjectFromRoute();
        }
      }
    );
  } else if (backend.isRunning) {
    await loadProjectFromRoute();
  }
});

onUnmounted(() => {
  window.removeEventListener('focus', handleWindowFocus);
  git.cleanup();
});
</script>

<template>
  <div class="flex flex-col h-screen">
    <!-- Header -->
    <Header />

    <!-- Read-only banner (main branch) -->
    <ReadOnlyBanner />

    <!-- Merge conflict banner -->
    <div
      v-if="git.hasMergeConflict"
      class="bg-destructive/10 border-b border-destructive/30 px-4 py-2 flex items-center gap-2"
    >
      <AlertTriangle class="h-4 w-4 text-destructive shrink-0" />
      <span class="text-sm text-destructive">
        Merge conflict detected. Resolve manually or abort the merge.
      </span>
      <Button
        variant="outline"
        size="sm"
        class="ml-auto h-7 text-xs"
        data-testid="abort-merge-button"
        @click="git.abortMerge()"
      >
        <X class="h-3 w-3 mr-1" />
        Abort Merge
      </Button>
    </div>

    <!-- Remote has new changes banner -->
    <div
      v-if="git.behind > 0 && !git.isDiverged && !git.hasMergeConflict"
      class="bg-blue-500/10 border-b border-blue-500/30 px-4 py-2 flex items-center gap-2"
    >
      <ArrowDown class="h-4 w-4 text-blue-500 shrink-0" />
      <span class="text-sm text-blue-500">
        Collaborators pushed {{ git.behind }} new commit{{ git.behind === 1 ? '' : 's' }}.
      </span>
      <Button
        variant="outline"
        size="sm"
        class="ml-auto h-7 text-xs"
        :disabled="git.isPulling"
        data-testid="pull-changes-button"
        @click="git.pull()"
      >
        {{ git.isPulling ? 'Pulling...' : 'Pull now' }}
      </Button>
    </div>

    <!-- Main content area -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar -->
      <Sidebar v-if="projects.currentProjectId" :project-id="projects.currentProjectId" />

      <!-- Page content -->
      <main class="flex-1 overflow-auto">
        <!-- Loading state -->
        <div v-if="projects.isLoadingProject" class="flex items-center justify-center h-full">
          <div class="text-center">
            <div class="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p class="text-muted-foreground">Loading review...</p>
          </div>
        </div>

        <!-- Error state -->
        <div v-else-if="projects.projectError" class="flex items-center justify-center h-full">
          <div class="text-center max-w-md p-6">
            <div class="text-destructive text-4xl mb-4">!</div>
            <h2 class="text-lg font-semibold mb-2">Failed to load review</h2>
            <p class="text-muted-foreground">{{ projects.projectError }}</p>
          </div>
        </div>

        <!-- Content slot -->
        <div v-else class="h-full">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
