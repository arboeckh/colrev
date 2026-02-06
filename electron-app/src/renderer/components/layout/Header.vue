<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, RefreshCw } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import GitSyncStatus from '@/components/common/GitSyncStatus.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';

const router = useRouter();
const projects = useProjectsStore();
const backend = useBackendStore();

const projectTitle = computed(() => {
  return projects.currentSettings?.project?.title || projects.currentProjectId || 'Project';
});

const isRefreshing = computed(() => projects.isLoadingProject);

function goToProjects() {
  projects.clearCurrentProject();
  router.push('/');
}

async function refresh() {
  await projects.refreshCurrentProject();
}
</script>

<template>
  <header class="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div class="flex h-full items-center justify-between px-4">
      <!-- Left side: Back button + Project name -->
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="sm" class="gap-2" @click="goToProjects">
          <ArrowLeft class="h-4 w-4" />
          <span class="hidden sm:inline">Projects</span>
        </Button>

        <div class="h-6 w-px bg-border" />

        <h1 class="text-lg font-semibold truncate max-w-[300px]">
          {{ projectTitle }}
        </h1>
      </div>

      <!-- Right side: Git status + Refresh -->
      <div class="flex items-center gap-3">
        <GitSyncStatus v-if="projects.currentGitStatus" :status="projects.currentGitStatus" />

        <Button
          variant="ghost"
          size="icon"
          :disabled="!backend.isRunning || isRefreshing"
          @click="refresh"
        >
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isRefreshing }" />
        </Button>
      </div>
    </div>
  </header>
</template>
