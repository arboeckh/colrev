<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { LayoutDashboard, Settings } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import SidebarItem from './SidebarItem.vue';
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
</script>

<template>
  <aside class="w-56 border-r border-border bg-muted/30 flex flex-col">
    <ScrollArea class="flex-1 p-3">
      <!-- Overview link -->
      <RouterLink
        :to="`/project/${projectId}`"
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

      <!-- Workflow steps -->
      <div class="space-y-1">
        <SidebarItem
          v-for="step in WORKFLOW_STEPS"
          :key="step.id"
          :step="step"
          :project-id="projectId"
          :operation-info="getOperationInfo(step.id)"
        />
      </div>

      <Separator class="my-3" />

      <!-- Settings link -->
      <RouterLink
        :to="`/project/${projectId}/settings`"
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
  </aside>
</template>
