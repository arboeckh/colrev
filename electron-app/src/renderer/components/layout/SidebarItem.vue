<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Check, AlertCircle, FileText } from 'lucide-vue-next';
import type { WorkflowStepInfo, RecordCounts, OverallRecordCounts } from '@/types/project';
import type { GetOperationInfoResponse } from '@/types/api';
import { useProjectsStore } from '@/stores/projects';

const props = defineProps<{
  step: WorkflowStepInfo;
  projectId: string;
  operationInfo?: GetOperationInfoResponse | null;
  recordCounts?: RecordCounts | null;
  overallCounts?: OverallRecordCounts | null;
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

// Records that have *ever been* in output states (survives downstream processing)
// e.g. preprocessing produced md_processed records even if prescreen moved them on
const everProcessedRecords = computed(() => {
  if (!props.overallCounts) return 0;
  return props.step.outputStates.reduce((sum, state) => {
    const key = state as keyof OverallRecordCounts;
    return sum + (props.overallCounts?.[key] ?? 0);
  }, 0);
});

// Determine step status based on CoLRev record states
type StepStatus = 'complete' | 'active' | 'warning' | 'pending';

// Check if search step is complete (for gating subsequent steps)
const isSearchComplete = computed(() => {
  const totalRecords = props.recordCounts?.total ?? 0;
  if (totalRecords === 0) return false;
  if (projects.hasStaleSearchSources) return false;
  return true;
});

const stepStatus = computed((): StepStatus => {
  if (props.step.id === 'review_definition') {
    // Review definition is always accessible and doesn't have a completion state
    return 'active';
  }

  if (props.step.id === 'search') {
    // Search is complete only when there are records AND no sources need action
    if (isSearchComplete.value) {
      return 'complete';
    }
    // Otherwise search is "active" (in progress / needs work)
    return 'active';
  }

  // For all other steps: if search isn't complete, show as pending (greyed out)
  if (!isSearchComplete.value) {
    return 'pending';
  }

  // Step has records waiting to be processed - it's active
  if (pendingRecords.value > 0) {
    return 'active';
  }

  // Step has processed records (and none pending) - it's complete
  if (processedRecords.value > 0) {
    return 'complete';
  }

  // Step was completed in the past but records have moved to later steps
  // (e.g. preprocessing produced md_processed, but prescreen moved them on)
  if (everProcessedRecords.value > 0) {
    return 'complete';
  }

  // No records in input or output states - step is pending (disabled/waiting)
  return 'pending';
});
</script>

<template>
  <RouterLink
    :to="routePath"
    :data-testid="`sidebar-${step.id}`"
    :data-step-status="stepStatus"
    class="group relative flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg text-sm transition-all"
    :class="[
      isActive
        ? 'text-foreground font-medium bg-accent/60'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent/30',
    ]"
  >
    <!-- Vertical line (behind the dot) -->
    <div class="relative flex flex-col items-center w-5">
      <!-- Line segment above -->
      <div
        v-if="!isFirst"
        class="absolute bottom-1/2 w-px h-4 -translate-y-0.5"
        :class="stepStatus === 'complete' ? 'bg-emerald-500' : 'bg-border'"
      />
      <!-- Line segment below -->
      <div
        v-if="!isLast"
        class="absolute top-1/2 w-px h-4 translate-y-0.5"
        :class="stepStatus === 'complete' ? 'bg-emerald-500' : 'bg-border'"
      />

      <!-- Step indicator dot -->
      <div
        class="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all"
        :class="[
          stepStatus === 'complete'
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : stepStatus === 'active'
              ? step.id === 'review_definition'
                ? 'border-blue-500 bg-blue-500 text-white'
                : 'border-primary bg-primary text-primary-foreground'
              : stepStatus === 'warning'
                ? 'border-amber-500 bg-amber-500 text-white'
                : isActive
                  ? 'border-foreground/50 bg-foreground/10'
                  : 'border-muted-foreground/30 bg-background',
        ]"
      >
        <Check
          v-if="stepStatus === 'complete'"
          class="h-3 w-3"
        />
        <AlertCircle
          v-else-if="stepStatus === 'warning'"
          class="h-3 w-3"
        />
        <FileText
          v-else-if="step.id === 'review_definition'"
          class="h-3 w-3"
        />
        <div
          v-else-if="stepStatus === 'active'"
          class="h-1.5 w-1.5 rounded-full bg-current"
        />
      </div>
    </div>

    <!-- Label and count -->
    <div class="flex flex-1 items-center justify-between min-w-0 pr-2">
      <span class="truncate">{{ step.label }}</span>
      <span
        v-if="pendingRecords > 0"
        class="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs tabular-nums text-primary font-medium"
      >
        {{ pendingRecords }}
      </span>
    </div>
  </RouterLink>
</template>
