<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import Header from './Header.vue';
import Sidebar from './Sidebar.vue';
import SyncStatusBanner from '@/components/common/SyncStatusBanner.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useSyncStore } from '@/stores/sync';
import { useNotificationsStore } from '@/stores/notifications';
import { usePendingChangesStore } from '@/stores/pendingChanges';

const route = useRoute();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();
const sync = useSyncStore();
const notifications = useNotificationsStore();
const pending = usePendingChangesStore();

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

    // The coordinator's timers, fetch clock and suspensions all belong to the
    // project being left. Stop before loading so none of it carries over.
    sync.stop();

    const success = await projects.loadProject(projectId);
    if (!success) {
      notifications.error('Failed to load review', projects.projectError || undefined);
      return;
    }
    await git.initialize();
  }

  // Hand freshness to the sync coordinator: it owns the background fetch
  // cadence, auto-pull and auto-push from here on. This is the only place it
  // is started — `architecture.test.ts` enforces that, so a second surface
  // cannot spawn a competing loop. `start()` is idempotent, so re-entering
  // the same project (remount, hot reload) does not stack timers.
  if (projects.currentProjectId) sync.start();
}

// Refresh everything on window focus — the app is the user's "view" into the
// repo; tabbing back is the natural moment to pick up external changes
// (collaborator pushes, CLI commits) without running interval polls.
let focusRefreshInFlight = false;
async function handleWindowFocus() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  if (focusRefreshInFlight) return;
  focusRefreshInFlight = true;
  try {
    // One snapshot refresh: git facts and pending changes come from it.
    await git.refreshStatus();
    // Focus forces the coordinator's next tick to fetch, then act on what it
    // finds — so tabbing back picks up a collaborator's work immediately.
    sync.onWindowFocus();
  } finally {
    focusRefreshInFlight = false;
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
  sync.stop();
  git.cleanup();
});
</script>

<template>
  <div class="flex flex-col h-screen">
    <!-- Header -->
    <Header />

    <SyncStatusBanner />

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
