<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Circle, CircleDot, CircleCheck, CircleAlert } from 'lucide-vue-next';
import { useProjectsStore } from '@/stores/projects';
import type { WorkflowStepInfo, RecordCounts } from '@/types/project';
import type { GetOperationInfoResponse } from '@/types/api';

const props = defineProps<{
  step: WorkflowStepInfo;
  projectId: string;
  operationInfo?: GetOperationInfoResponse | null;
  recordCounts?: RecordCounts | null;
  isFirst?: boolean;
  isLast?: boolean;
}>();

const route = useRoute();
const projects = useProjectsStore();

const isActive = computed(() => {
  return route.meta.step === props.step.id;
});

const routePath = computed(() => {
  return `/project/${props.projectId}/${props.step.route}`;
});

// Count of records in input states (waiting for this step)
const pendingRecords = computed(() => {
  if (!props.recordCounts) return 0;
  return props.step.inputStates.reduce((sum, state) => {
    return sum + (props.recordCounts?.[state] ?? 0);
  }, 0);
});

// Count of records in output states (processed by this step)
const processedRecords = computed(() => {
  if (!props.recordCounts) return 0;
  return props.step.outputStates.reduce((sum, state) => {
    return sum + (props.recordCounts?.[state] ?? 0);
  }, 0);
});

// Determine step status based on CoLRev record states
// - 'complete': No pending records AND has processed records (or is search with sources)
// - 'active': Has pending records to process
// - 'warning': Operation can't run for an unexpected reason (after having processed records)
// - 'pending': Not yet reached (no records have entered this stage)
type StepStatus = 'complete' | 'active' | 'warning' | 'pending';

const stepStatus = computed((): StepStatus => {
  // Special case for search: only complete when records have actually been retrieved
  // and no sources have been modified since the last search
  if (props.step.id === 'search') {
    // If sources were modified, search needs to be re-run
    if (projects.searchSourcesModified) {
      return 'pending';
    }
    // Search is "complete" only when there are actual records in the system
    // (not just because sources exist - the default FILES source always exists)
    const totalRecords = props.recordCounts?.total ?? 0;
    if (totalRecords > 0) {
      return 'complete';
    }
    return 'pending';
  }

  // If there are records waiting to be processed by this step
  if (pendingRecords.value > 0) {
    return 'active';
  }

  // If this step has processed records and none are pending, it's complete
  if (processedRecords.value > 0) {
    return 'complete';
  }

  // If no records have reached this step (neither pending nor processed), it's pending
  // This takes priority over warning since the step simply hasn't been reached yet
  if (pendingRecords.value === 0 && processedRecords.value === 0) {
    return 'pending';
  }

  // Check for warning conditions (can't run for reasons other than no records)
  // This only applies if we have some records but something is blocking the operation
  if (props.operationInfo && !props.operationInfo.can_run && props.operationInfo.reason) {
    return 'warning';
  }

  // Default: not yet reached
  return 'pending';
});

const statusIcon = computed(() => {
  switch (stepStatus.value) {
    case 'complete':
      return CircleCheck;
    case 'active':
      return CircleDot;
    case 'warning':
      return CircleAlert;
    case 'pending':
    default:
      return Circle;
  }
});

const statusClass = computed(() => {
  switch (stepStatus.value) {
    case 'complete':
      return 'text-green-500';
    case 'active':
      return 'text-primary';
    case 'warning':
      return 'text-yellow-500';
    case 'pending':
    default:
      return 'text-muted-foreground';
  }
});

// Line color matches the step's completion status
const lineClass = computed(() => {
  if (stepStatus.value === 'complete') {
    return 'bg-green-500';
  }
  return 'bg-border';
});
</script>

<template>
  <div class="relative">
    <!-- Connecting line above (except for first item) -->
    <div
      v-if="!isFirst"
      class="absolute left-[22px] -top-1 w-0.5 h-2"
      :class="lineClass"
    />

    <RouterLink
      :to="routePath"
      :data-testid="`sidebar-${step.id}`"
      :data-step-status="stepStatus"
      class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative"
      :class="[
        isActive
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      ]"
    >
      <component :is="statusIcon" class="h-4 w-4 flex-shrink-0" :class="statusClass" />
      <span class="truncate">{{ step.label }}</span>
      <span
        v-if="pendingRecords > 0"
        class="ml-auto text-xs tabular-nums text-muted-foreground"
      >
        {{ pendingRecords }}
      </span>
    </RouterLink>

    <!-- Connecting line below (except for last item) -->
    <div
      v-if="!isLast"
      class="absolute left-[22px] -bottom-1 w-0.5 h-2"
      :class="stepStatus === 'complete' ? 'bg-green-500' : 'bg-border'"
    />
  </div>
</template>
