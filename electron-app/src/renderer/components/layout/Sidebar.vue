<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { LayoutDashboard, Settings } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import SidebarItem from './SidebarItem.vue';
import { UserMenu } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { useGitStore } from '@/stores/git';
import { WORKFLOW_STEPS, type WorkflowStep } from '@/types/project';

const props = defineProps<{
  projectId: string;
}>();

const route = useRoute();
const projects = useProjectsStore();
const git = useGitStore();

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

// For each step, compute states that indicate records have *passed through* this step
// = all states from the NEXT step onward (excludes rejection states like rev_prescreen_excluded)
const downstreamStatesPerStep = computed(() => {
  return WORKFLOW_STEPS.map((_, index) => {
    const passed = new Set<string>();
    for (let i = index + 1; i < WORKFLOW_STEPS.length; i++) {
      WORKFLOW_STEPS[i].inputStates.forEach((s) => passed.add(s));
      WORKFLOW_STEPS[i].outputStates.forEach((s) => passed.add(s));
    }
    return [...passed];
  });
});

// Whether to show the badge legend (only when on dev with new records)
const showBadgeLegend = computed(() => {
  return git.isOnDev && git.branchDelta && git.branchDelta.new_record_count > 0;
});

// For each step index, check whether any prior step has pending records
const priorStepHasPending = computed(() => {
  return WORKFLOW_STEPS.map((_, index) => {
    for (let i = 0; i < index; i++) {
      const priorStep = WORKFLOW_STEPS[i];
      const pending = priorStep.inputStates.reduce((sum, state) => {
        return sum + (recordCounts.value?.[state] ?? 0);
      }, 0);
      if (pending > 0) return true;
    }
    return false;
  });
});
</script>

<template>
  <aside class="w-56 border-r border-border bg-muted/30 flex flex-col">
    <ScrollArea class="flex-1 p-3">
      <!-- Overview link -->
      <RouterLink :to="`/project/${projectId}`" data-testid="sidebar-overview"
        class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors mb-1" :class="[
          isOverviewActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        ]">
        <LayoutDashboard class="h-4 w-4" />
        <span>Versions</span>
      </RouterLink>

      <Separator class="my-3" />

      <!-- Badge legend -->
      <div v-if="showBadgeLegend" class="flex flex-col gap-1 mb-2 px-1">
        <div class="flex items-center gap-1.5">
          <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/15 px-1 text-[10px] tabular-nums text-emerald-500 font-medium">+n</span>
          <span class="text-[10px] text-muted-foreground/60">new records from dev</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] tabular-nums text-primary font-medium">n</span>
          <span class="text-[10px] text-muted-foreground/60">waiting to be processed</span>
        </div>
      </div>

      <!-- Workflow steps with connecting lines -->
      <nav class="flex flex-col pl-2">
        <SidebarItem v-for="(step, index) in WORKFLOW_STEPS" :key="step.id" :step="step" :project-id="projectId"
          :operation-info="getOperationInfo(step.id)" :record-counts="recordCounts" :overall-counts="overallCounts"
          :delta-by-state="git.branchDelta?.delta_by_state ?? null" :is-on-dev="git.isOnDev"
          :has-prior-pending="priorStepHasPending[index]"
          :downstream-states="downstreamStatesPerStep[index]"
          :is-first="index === 0" :is-last="index === WORKFLOW_STEPS.length - 1" />
      </nav>

      <Separator class="my-3" />

      <!-- Settings link -->
      <RouterLink :to="`/project/${projectId}/settings`" data-testid="sidebar-settings"
        class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors" :class="[
          isSettingsActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        ]">
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
