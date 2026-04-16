<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, RefreshCw } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import GitSyncStatus from '@/components/common/GitSyncStatus.vue';
import ThemeToggle from '@/components/common/ThemeToggle.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { usePendingChangesStore } from '@/stores/pendingChanges';
const router = useRouter();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();
const pending = usePendingChangesStore();

const projectTitle = computed(() => {
  return projects.currentSettings?.project?.title || projects.currentProjectId || 'Review';
});

const isRefreshingManual = ref(false);
const isRefreshing = computed(
  () => projects.isLoadingProject || isRefreshingManual.value,
);

function goToProjects() {
  git.cleanup();
  projects.clearCurrentProject();
  router.push('/');
}

// Single user-initiated refresh covering project metadata, local git state,
// pending changes, and (if remote) a fetch so ahead/behind is fresh. This is
// the explicit replacement for the interval polling that used to run.
async function refresh() {
  if (isRefreshingManual.value) return;
  isRefreshingManual.value = true;
  try {
    await Promise.all([
      projects.refreshCurrentProject(),
      git.refreshStatus(),
      pending.refresh(),
      git.hasRemote ? git.fetch() : Promise.resolve(),
    ]);
  } finally {
    isRefreshingManual.value = false;
  }
}

</script>

<template>
  <header class="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div class="flex h-full items-center justify-between px-4">
      <!-- Left side: Back button + Project name -->
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="sm" class="gap-2" @click="goToProjects">
          <ArrowLeft class="h-4 w-4" />
          <span class="hidden sm:inline">Reviews</span>
        </Button>

        <div class="h-6 w-px bg-border" />

        <h1 class="text-lg font-semibold truncate max-w-[300px]">
          {{ projectTitle }}
        </h1>
      </div>

      <!-- Right side: Pending changes + Git sync + Theme toggle + Refresh -->
      <div class="flex items-center gap-3">
        <GitSyncStatus v-if="projects.currentGitStatus" :status="projects.currentGitStatus" />

        <ThemeToggle />

        <Button
          variant="ghost"
          size="icon"
          :disabled="!backend.isRunning || isRefreshing"
          data-testid="refresh-git-state"
          title="Refresh project and git state"
          @click="refresh"
        >
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isRefreshing }" />
        </Button>
      </div>
    </div>
  </header>
</template>
