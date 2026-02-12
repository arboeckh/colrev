<script setup lang="ts">
import 'vue-sonner/style.css';
import { onMounted, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Toaster } from '@/components/ui/sonner';
import AppLayout from '@/components/layout/AppLayout.vue';
import DebugPanel from '@/components/common/DebugPanel.vue';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import type { ListProjectsResponse } from '@/types/api';

const route = useRoute();
const backend = useBackendStore();
const projects = useProjectsStore();

// Determine which layout to use based on route meta
const useProjectLayout = computed(() => {
  return route.meta.layout === 'project' || route.matched.some((r) => r.meta.layout === 'project');
});

// Auto-start backend and discover projects on mount
onMounted(async () => {
  if (backend.canStart) {
    const started = await backend.start();
    if (started) {
      // Discover projects immediately after backend starts
      await discoverProjects();
    }
  }
});

// Discover existing projects from disk
async function discoverProjects() {
  try {
    const response = await backend.call<ListProjectsResponse>('list_projects', {});
    if (response.success && response.projects) {
      for (const proj of response.projects) {
        projects.addProject(proj.id, proj.path, proj.title);
      }
    }
    // Projects are now displayed immediately
    // Status/git status will be loaded on-demand when viewing individual projects
  } catch (err) {
    console.error('Failed to discover projects:', err);
  }
}

// Watch for backend errors
watch(
  () => backend.error,
  (error) => {
    if (error) {
      console.error('Backend error:', error);
    }
  }
);
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Toast notifications -->
    <Toaster position="bottom-right" :expand="true" />

    <!-- Debug panel (floating button in bottom right) -->
    <DebugPanel />

    <!-- Main content with conditional layout -->
    <AppLayout v-if="useProjectLayout">
      <router-view />
    </AppLayout>

    <router-view v-else />
  </div>
</template>
