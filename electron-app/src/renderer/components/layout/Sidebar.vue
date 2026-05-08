<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { LayoutDashboard, BookOpen } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';
import SidebarItem from './SidebarItem.vue';
import { UserMenu } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { useGitStore } from '@/stores/git';
import { useManagedReviewStore } from '@/stores/managedReview';
import { type WorkflowStep, type RecordCounts } from '@/types/project';
import { PIPELINE_STEPS } from '@/lib/sidebar';

const props = defineProps<{
  projectId: string;
}>();

const route = useRoute();
const projects = useProjectsStore();
const git = useGitStore();
const managedReview = useManagedReviewStore();

const isOverviewActive = computed(() => route.name === 'project-overview');
const isDefinitionActive = computed(() => route.meta.step === 'review_definition');

function getOperationInfo(stepId: WorkflowStep) {
  return projects.operationInfo[stepId];
}

// Get record counts from the current project status
const recordCounts = computed(() => {
  const status = projects.currentStatus;
  if (!status?.currently) return null;
  return {
    ...status.currently,
    total: status.total_records ?? 0,
  };
});

// On a reviewer branch, prefer dev's per-state counts (from get_branch_delta)
// over the reviewer branch's working-tree counts.
const effectiveRecordCounts = computed<(RecordCounts & { total: number }) | null>(() => {
  if (managedReview.isOnReviewerBranch && git.devRecordCounts) {
    const devCounts = git.devRecordCounts as globalThis.Record<string, number>;
    const total = Object.values(devCounts).reduce((sum, n) => sum + n, 0);
    return {
      ...(devCounts as unknown as RecordCounts),
      total,
    };
  }
  return recordCounts.value;
});

// Stable record counts: use frozen snapshot during branch switch to prevent flicker.
// The frozen data lives in the projects store (shared with getStepStatus).
const stableRecordCounts = computed(() =>
  projects.isBranchSwitching ? projects.frozenRecordCounts : effectiveRecordCounts.value,
);

// Whether to show the badge legend
const showBadgeLegend = computed(() => {
  return (
    (git.isOnDev || managedReview.isOnReviewerBranch) &&
    git.branchDelta != null &&
    git.branchDelta.new_record_count > 0
  );
});

// True when delta badges should render
const showDelta = computed(() => git.isOnDev || managedReview.isOnReviewerBranch);

// On a reviewer branch, suppress record counts for steps after the active managed review step
const suppressCountsForStep = computed(() => {
  if (!managedReview.isOnReviewerBranch) return new Set<string>();
  const activeKind = managedReview.activePrescreenTask ? 'prescreen' : managedReview.activeScreenTask ? 'screen' : null;
  if (!activeKind) return new Set<string>();
  const reviewStepIdx = PIPELINE_STEPS.findIndex((s) => s.id === activeKind);
  if (reviewStepIdx === -1) return new Set<string>();
  const suppressed = new Set<string>();
  for (let i = reviewStepIdx + 1; i < PIPELINE_STEPS.length; i++) {
    suppressed.add(PIPELINE_STEPS[i].id);
  }
  return suppressed;
});

// For each pipeline step, compute states that indicate records have passed through this step
// (needed for delta badge counting in SidebarItem)
const downstreamStatesPerStep = computed(() => {
  return PIPELINE_STEPS.map((_, index) => {
    const passed = new Set<string>();
    for (let i = index + 1; i < PIPELINE_STEPS.length; i++) {
      PIPELINE_STEPS[i].inputStates.forEach((s) => passed.add(s));
      PIPELINE_STEPS[i].outputStates.forEach((s) => passed.add(s));
    }
    return [...passed];
  });
});
</script>

<template>
  <aside class="w-60 border-r border-sidebar-border bg-sidebar flex flex-col">
    <ScrollArea class="flex-1 p-3">
      <!-- Overview link -->
      <RouterLink :to="`/project/${projectId}`" data-testid="sidebar-overview"
        class="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors mb-1" :class="[
          isOverviewActive
            ? 'bg-card border border-sidebar-border text-ink-900 font-medium'
            : 'text-ink-600 hover:bg-card/60 hover:text-ink-900',
        ]">
        <LayoutDashboard class="h-3.5 w-3.5" />
        <span>Overview</span>
      </RouterLink>

      <!-- Definition link (setup / reference, not part of pipeline) -->
      <RouterLink :to="`/project/${projectId}/review-definition`" data-testid="sidebar-review-definition"
        class="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors mb-2" :class="[
          isDefinitionActive
            ? 'bg-card border border-sidebar-border text-ink-900 font-medium'
            : 'text-ink-600 hover:bg-card/60 hover:text-ink-900',
        ]">
        <BookOpen class="h-3.5 w-3.5" />
        <span>Definition</span>
      </RouterLink>

      <div class="px-3 pt-2 pb-1.5">
        <div class="smallcaps">Review pipeline</div>
      </div>

      <!-- Badge legend -->
      <div v-if="showBadgeLegend" class="flex flex-col gap-1 mb-2 px-3">
        <div class="flex items-center gap-1.5">
          <span class="flex h-4 min-w-4 items-center justify-center rounded-full border border-eucalyptus-300/50 bg-eucalyptus-50 px-1 text-[10px] tabular-nums text-eucalyptus-700 font-medium">+n</span>
          <span class="text-[10px] text-ink-400">new unpublished records</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-cream-200 px-1 text-[10px] tabular-nums text-ink-700 font-medium">n</span>
          <span class="text-[10px] text-ink-400">waiting to be processed</span>
        </div>
      </div>

      <!-- Pipeline steps with connecting lines -->
      <nav class="flex flex-col pl-2">
        <SidebarItem v-for="(step, index) in PIPELINE_STEPS" :key="step.id" :step="step" :project-id="projectId"
          :operation-info="getOperationInfo(step.id)" :record-counts="stableRecordCounts"
          :delta-by-state="git.branchDelta?.delta_by_state ?? null" :show-delta="showDelta"
          :downstream-states="downstreamStatesPerStep[index]"
          :suppress-counts="suppressCountsForStep.has(step.id)"
          :is-first="index === 0" :is-last="index === PIPELINE_STEPS.length - 1" />
      </nav>

    </ScrollArea>

    <!-- User menu at the bottom -->
    <div class="border-t border-sidebar-border p-2">
      <UserMenu />
    </div>
  </aside>
</template>
