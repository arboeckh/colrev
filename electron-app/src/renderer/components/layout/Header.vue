<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, RefreshCw } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import GitSyncStatus from '@/components/common/GitSyncStatus.vue';
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
  <header class="h-14 border-b border-sidebar-border bg-cream-100">
    <div class="flex h-full items-center justify-between px-5">
      <!-- Left side: brand mark + Back button + Project name -->
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2.5 pr-1">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-sm bg-eucalyptus-700 text-cream-50 font-display italic text-base font-medium"
          >
            c
          </div>
          <div class="leading-tight">
            <div class="font-display text-[15px] font-normal tracking-[-0.01em] text-ink-900">ColRev</div>
            <div class="smallcaps !text-[9px] !leading-none mt-0.5">workspace</div>
          </div>
        </div>

        <div class="h-6 w-px bg-sidebar-border" />

        <Button variant="ghost" size="sm" class="gap-2 text-ink-600 hover:text-ink-900" @click="goToProjects">
          <ArrowLeft class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">Reviews</span>
        </Button>

        <div class="h-6 w-px bg-sidebar-border" />

        <h1 class="font-display text-[18px] font-normal tracking-[-0.015em] text-ink-900 truncate max-w-[320px]">
          {{ projectTitle }}
        </h1>
      </div>

      <!-- Right side: Git sync + Refresh -->
      <div class="flex items-center gap-3">
        <GitSyncStatus v-if="projects.currentGitStatus" :status="projects.currentGitStatus" />

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
