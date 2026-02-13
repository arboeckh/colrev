<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { LayoutDashboard, Settings } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import SidebarItem from './SidebarItem.vue';
import { UserMenu } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { WORKFLOW_STEPS, type WorkflowStep } from '@/types/project';

const props = defineProps<{
  projectId: string;
}>();

const route = useRoute();
const projects = useProjectsStore();

const isOverviewActive = computed(() => {
  return route.name === 'project-overview';
});

const isSettingsActive = computed(() => {
  return route.name === 'project-settings';
});

function getOperationInfo(stepId: WorkflowStep) {
  return projects.operationInfo[stepId];
}

// Get record counts from the current project status
// Use 'currently' which has the current record counts by state
// Include total_records from the parent status object
const recordCounts = computed(() => {
  const status = projects.currentStatus;
  if (!status?.currently) return null;
  return {
    ...status.currently,
    total: status.total_records ?? 0,
  };
});

// Overall counts: records that have *ever been* in each state
// Used by SidebarItem to detect steps completed in the past
// (e.g. preprocessing is complete even after prescreen moves records past md_processed)
const overallCounts = computed(() => {
  return projects.currentStatus?.overall ?? null;
});
</script>

<template>
  <aside class="w-56 border-r border-border bg-muted/30 flex flex-col">
    <ScrollArea class="flex-1 p-3">
      <!-- Overview link -->
      <RouterLink
        :to="`/project/${projectId}`"
        data-testid="sidebar-overview"
        class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors mb-1"
        :class="[
          isOverviewActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        ]"
      >
        <LayoutDashboard class="h-4 w-4" />
        <span>Overview</span>
      </RouterLink>

      <Separator class="my-3" />

      <!-- Workflow steps with connecting lines -->
      <nav class="flex flex-col pl-2">
        <SidebarItem
          v-for="(step, index) in WORKFLOW_STEPS"
          :key="step.id"
          :step="step"
          :project-id="projectId"
          :operation-info="getOperationInfo(step.id)"
          :record-counts="recordCounts"
          :overall-counts="overallCounts"
          :is-first="index === 0"
          :is-last="index === WORKFLOW_STEPS.length - 1"
        />
      </nav>

      <Separator class="my-3" />

      <!-- Settings link -->
      <RouterLink
        :to="`/project/${projectId}/settings`"
        data-testid="sidebar-settings"
        class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors"
        :class="[
          isSettingsActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        ]"
      >
        <Settings class="h-4 w-4" />
        <span>Settings</span>
      </RouterLink>
    </ScrollArea>

    <!-- User menu at the bottom -->
    <div class="border-t border-border p-2">
      <UserMenu />
    </div>
  </aside>
</template>
