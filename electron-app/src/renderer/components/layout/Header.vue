<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, RefreshCw, ArrowUp } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import GitSyncStatus from '@/components/common/GitSyncStatus.vue';
import BranchSwitcher from '@/components/common/BranchSwitcher.vue';
import ThemeToggle from '@/components/common/ThemeToggle.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';

const router = useRouter();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();

const projectTitle = computed(() => {
  return projects.currentSettings?.project?.title || projects.currentProjectId || 'Project';
});

const isRefreshing = computed(() => projects.isLoadingProject);

function goToProjects() {
  git.cleanup();
  projects.clearCurrentProject();
  router.push('/');
}

async function refresh() {
  await projects.refreshCurrentProject();
  await git.refreshStatus();
}

async function handlePush() {
  await git.push();
}
</script>

<template>
  <header class="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div class="flex h-full items-center justify-between px-4">
      <!-- Left side: Back button + Project name + Branch -->
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="sm" class="gap-2" @click="goToProjects">
          <ArrowLeft class="h-4 w-4" />
          <span class="hidden sm:inline">Projects</span>
        </Button>

        <div class="h-6 w-px bg-border" />

        <h1 class="text-lg font-semibold truncate max-w-[300px]">
          {{ projectTitle }}
        </h1>

        <BranchSwitcher />
      </div>

      <!-- Right side: Save button + Git status + Theme toggle + Refresh -->
      <div class="flex items-center gap-3">
        <!-- Unsaved changes / Save button (when auto-save is off) -->
        <Button
          v-if="git.hasRemote && !git.autoSave && git.hasUnsavedChanges"
          variant="outline"
          size="sm"
          class="gap-1.5 h-8 text-xs"
          :disabled="git.isPushing || git.isDiverged"
          data-testid="save-changes-button"
          @click="handlePush"
        >
          <ArrowUp class="h-3.5 w-3.5" />
          {{ git.isPushing ? 'Saving...' : `${git.ahead} unsaved` }}
        </Button>

        <GitSyncStatus v-if="projects.currentGitStatus" :status="projects.currentGitStatus" />

        <ThemeToggle />

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
