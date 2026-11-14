<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import Header from './Header.vue';
import Sidebar from './Sidebar.vue';
import BackendStatusBanner from '@/components/common/BackendStatusBanner.vue';
import SyncStatusBanner from '@/components/common/SyncStatusBanner.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useSyncStore } from '@/stores/sync';
import { useNotificationsStore } from '@/stores/notifications';
import { usePendingChangesStore } from '@/stores/pendingChanges';
import { Button } from '@/components/ui/button';
import ReviewerBranchBanner from '@/components/common/ReviewerBranchBanner.vue';

const route = useRoute();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();
const sync = useSyncStore();
const notifications = useNotificationsStore();
const pending = usePendingChangesStore();

// Load project when route changes
async function loadProjectFromRoute(options: { force?: boolean } = {}) {
  const projectId = route.params.id as string;

  if (!projectId) return;

  // Load when the route names a different project, or when the one it names
  // has nothing loaded: a failed load leaves the id set with no project, and
  // comparing ids alone would never try again. A load already in flight is
  // left to finish.
  const needsLoad =
    projectId !== projects.currentProjectId ||
    (!projects.currentProject && !projects.isLoadingProject);
  if (needsLoad || options.force) {
    if (!backend.isRunning) {
      // The `running` watcher below loads it once the backend is back.
      notifications.error(
        'Backend not running',
        'The review opens as soon as the backend is back.',
      );
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

// A review opened while the backend was down (starting, or restarting after a
// crash) has nothing to show until it is back: load as soon as it is running,
// whatever state it was in at mount. A review that is already loaded is not
// touched; the restart's own invalidation refreshes it.
watch(
  () => backend.isRunning,
  (running) => {
    if (running) void loadProjectFromRoute();
  },
);

// Something outside the layout (the header Refresh with nothing loaded) asked
// for the review to be loaded again.
watch(
  () => projects.reloadRequest,
  () => {
    void loadProjectFromRoute({ force: true });
  },
);

// Load project on mount if backend is running
onMounted(async () => {
  window.addEventListener('focus', handleWindowFocus);
  if (backend.isRunning) await loadProjectFromRoute();
});

onUnmounted(() => {
  window.removeEventListener('focus', handleWindowFocus);
  sync.stop();
  git.cleanup();
  // Leaving the project layout (back to the list, signing out, a rejected
  // token redirecting to /login) ends the session with this review. Keeping
  // the id made reopening the same review look "already loaded", which skipped
  // both the load and the git initialisation.
  projects.clearCurrentProject();
});
</script>

<template>
  <div class="flex flex-col h-screen">
    <!-- Header -->
    <Header />

    <!-- Backend exited or failed to start: says so, with Retry. -->
    <BackendStatusBanner />

    <SyncStatusBanner />

    <!-- Reviewer-branch explainer: says why the sidebar just changed shape. -->
    <ReviewerBranchBanner />

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
            <Button
              class="mt-4"
              data-testid="project-load-retry"
              :disabled="!backend.isRunning"
              @click="loadProjectFromRoute({ force: true })"
            >
              Retry
            </Button>
            <p v-if="!backend.isRunning" class="mt-2 text-xs text-muted-foreground">
              Waiting for the backend to start.
            </p>
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
