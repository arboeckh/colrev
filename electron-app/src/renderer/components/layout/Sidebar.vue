<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { LayoutDashboard } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import SidebarItem from './SidebarItem.vue';
import { UserMenu } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { useGitStore } from '@/stores/git';
import { useManagedReviewStore } from '@/stores/managedReview';
import { WORKFLOW_STEPS, type WorkflowStep, type RecordCounts } from '@/types/project';

const props = defineProps<{
  projectId: string;
}>();

const route = useRoute();
const projects = useProjectsStore();
const git = useGitStore();
const managedReview = useManagedReviewStore();

const isOverviewActive = computed(() => {
  return route.name === 'project-overview';
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

// On a reviewer branch, prefer dev's per-state counts (from get_branch_delta)
// over the reviewer branch's working-tree counts. The reviewer branch is
// temporary; dev is the authoritative view of progress.
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

// Derive sidebar step status for managed review steps (launch/review/reconcile)
const managedStepStatuses = computed(() => {
  const map: Partial<globalThis.Record<WorkflowStep, 'pending' | 'active' | 'complete' | null>> = {};
  for (const step of WORKFLOW_STEPS) {
    if (step.managedReviewKind) {
      map[step.id] = managedReview.getStepStatus(step.id);
    }
  }
  return map;
});

// Whether to show the badge legend — on dev, or on a reviewer branch (where
// we mirror dev's view) with new records relative to main.
const showBadgeLegend = computed(() => {
  return (
    (git.isOnDev || managedReview.isOnReviewerBranch) &&
    git.branchDelta != null &&
    git.branchDelta.new_record_count > 0
  );
});

// True when delta badges should render (dev itself, or a reviewer branch
// mirroring dev's perspective).
const showDelta = computed(() => git.isOnDev || managedReview.isOnReviewerBranch);

// On a reviewer branch, suppress record counts for steps after the active managed review step
// (e.g. pdf_get, pdf_prep, screen shouldn't show counts because those records aren't actionable
// until after reconciliation on dev)
const suppressCountsForStep = computed(() => {
  if (!managedReview.isOnReviewerBranch) return new Set<string>();
  // Find the index of the managed review step that is active (prescreen or screen)
  const activeKind = managedReview.activePrescreenTask ? 'prescreen' : managedReview.activeScreenTask ? 'screen' : null;
  if (!activeKind) return new Set<string>();
  // Find the reconcile step index for this kind — everything after it should be suppressed
  const reviewStepIdx = WORKFLOW_STEPS.findIndex((s) => s.id === activeKind);
  if (reviewStepIdx === -1) return new Set<string>();
  // Suppress all steps after the review step (reconcile + downstream)
  const suppressed = new Set<string>();
  for (let i = reviewStepIdx + 1; i < WORKFLOW_STEPS.length; i++) {
    suppressed.add(WORKFLOW_STEPS[i].id);
  }
  return suppressed;
});

// Freeze sidebar data during branch switches to prevent flicker.
// When isSwitchingBranch is true, hold onto the last known snapshot.
type CountSnapshot = typeof effectiveRecordCounts.value;
type OverallSnapshot = typeof overallCounts.value;
type StatusSnapshot = typeof managedStepStatuses.value;

const frozenRecordCounts = ref<CountSnapshot>(null);
const frozenOverallCounts = ref<OverallSnapshot>(null);
const frozenManagedStatuses = ref<StatusSnapshot>({});

watch(() => git.isSwitchingBranch, (switching) => {
  if (switching) {
    // Snapshot current state before the reload
    frozenRecordCounts.value = effectiveRecordCounts.value;
    frozenOverallCounts.value = overallCounts.value;
    frozenManagedStatuses.value = { ...managedStepStatuses.value };
  }
});

const stableRecordCounts = computed(() =>
  git.isSwitchingBranch ? frozenRecordCounts.value : effectiveRecordCounts.value,
);
const stableOverallCounts = computed(() =>
  git.isSwitchingBranch ? frozenOverallCounts.value : overallCounts.value,
);
const stableManagedStatuses = computed(() =>
  git.isSwitchingBranch ? frozenManagedStatuses.value : managedStepStatuses.value,
);

// For each step index, check whether any prior step has pending records
const priorStepHasPending = computed(() => {
  const counts = stableRecordCounts.value;
  return WORKFLOW_STEPS.map((_, index) => {
    for (let i = 0; i < index; i++) {
      const priorStep = WORKFLOW_STEPS[i];
      const pending = priorStep.inputStates.reduce((sum, state) => {
        return sum + (counts?.[state] ?? 0);
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
        <span>Overview</span>
      </RouterLink>

      <Separator class="my-3" />

      <!-- Badge legend -->
      <div v-if="showBadgeLegend" class="flex flex-col gap-1 mb-2 px-1">
        <div class="flex items-center gap-1.5">
          <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/15 px-1 text-[10px] tabular-nums text-emerald-500 font-medium">+n</span>
          <span class="text-[10px] text-muted-foreground/60">new unpublished records</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] tabular-nums text-primary font-medium">n</span>
          <span class="text-[10px] text-muted-foreground/60">waiting to be processed</span>
        </div>
      </div>

      <!-- Workflow steps with connecting lines -->
      <nav class="flex flex-col pl-2">
        <SidebarItem v-for="(step, index) in WORKFLOW_STEPS" :key="step.id" :step="step" :project-id="projectId"
          :operation-info="getOperationInfo(step.id)" :record-counts="stableRecordCounts" :overall-counts="stableOverallCounts"
          :delta-by-state="git.branchDelta?.delta_by_state ?? null" :show-delta="showDelta"
          :has-prior-pending="priorStepHasPending[index]"
          :downstream-states="downstreamStatesPerStep[index]"
          :managed-step-status="stableManagedStatuses[step.id] ?? null"
          :suppress-counts="suppressCountsForStep.has(step.id)"
          :is-first="index === 0" :is-last="index === WORKFLOW_STEPS.length - 1" />
      </nav>

    </ScrollArea>

    <!-- User menu at the bottom -->
    <div class="border-t border-border p-2">
      <UserMenu />
    </div>
  </aside>
</template>
