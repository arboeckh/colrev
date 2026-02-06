<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import Header from './Header.vue';
import Sidebar from './Sidebar.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';

const route = useRoute();
const projects = useProjectsStore();
const backend = useBackendStore();
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
      notifications.error('Failed to load project', projects.projectError || undefined);
    }
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
</script>

<template>
  <div class="flex flex-col h-screen">
    <!-- Header -->
    <Header />

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
            <p class="text-muted-foreground">Loading project...</p>
          </div>
        </div>

        <!-- Error state -->
        <div v-else-if="projects.projectError" class="flex items-center justify-center h-full">
          <div class="text-center max-w-md p-6">
            <div class="text-destructive text-4xl mb-4">!</div>
            <h2 class="text-lg font-semibold mb-2">Failed to load project</h2>
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
