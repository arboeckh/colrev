<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Check, AlertCircle, BookOpen } from 'lucide-vue-next';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { WorkflowStepInfo, RecordCounts, OverallRecordCounts } from '@/types/project';
import type { GetOperationInfoResponse } from '@/types/api';
import { useProjectsStore } from '@/stores/projects';

const props = defineProps<{
  step: WorkflowStepInfo;
  projectId: string;
  operationInfo?: GetOperationInfoResponse | null;
  recordCounts?: RecordCounts | null;
  overallCounts?: OverallRecordCounts | null;
  deltaByState?: globalThis.Record<string, number> | null;
  isOnDev?: boolean;
  hasPriorPending?: boolean;
  downstreamStates?: string[];
  managedStepStatus?: 'pending' | 'active' | 'complete' | null;
  suppressCounts?: boolean;
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
// Suppressed on reviewer branches for steps after the managed review step
const pendingRecords = computed(() => {
  if (props.suppressCounts || !props.recordCounts) return 0;
  return props.step.inputStates.reduce((sum, state) => {
    return sum + (props.recordCounts?.[state] ?? 0);
  }, 0);
});

// Count of records in output states (processed by this step)
const processedRecords = computed(() => {
  if (props.suppressCounts || !props.recordCounts) return 0;
  return props.step.outputStates.reduce((sum, state) => {
    return sum + (props.recordCounts?.[state] ?? 0);
  }, 0);
});

// Records that have *ever been* in output states (survives downstream processing)
// e.g. preprocessing produced md_processed records even if prescreen moved them on
const everProcessedRecords = computed(() => {
  if (props.suppressCounts || !props.overallCounts) return 0;
  return props.step.outputStates.reduce((sum, state) => {
    const key = state as keyof OverallRecordCounts;
    return sum + (props.overallCounts?.[key] ?? 0);
  }, 0);
});

// Count of new records (from delta) that have reached this step or beyond
// Only show for steps that actually process records (have inputStates)
const deltaPendingRecords = computed(() => {
  if (!props.isOnDev || !props.deltaByState) return 0;
  if (props.step.inputStates.length === 0 && props.step.outputStates.length === 0) return 0;
  const states = props.downstreamStates ?? props.step.inputStates;
  return states.reduce((sum, state) => {
    return sum + (props.deltaByState?.[state] ?? 0);
  }, 0);
});

// Determine step status based on CoLRev record states
type StepStatus = 'complete' | 'active' | 'warning' | 'pending';

// Gate steps (launch, reconcile) don't process records — suppress badges
const isGateStep = computed(() => props.step.stepKind === 'gate');

// Check if search step is complete (for gating subsequent steps)
const isSearchComplete = computed(() => {
  const totalRecords = props.recordCounts?.total ?? 0;
  if (totalRecords === 0) return false;
  if (projects.hasStaleSearchSources) return false;
  return true;
});

const stepStatus = computed((): StepStatus => {
  // Managed review steps: use task-derived status when available
  if (props.managedStepStatus != null) {
    return props.managedStepStatus;
  }

  if (props.step.id === 'review_definition') {
    // Review definition is always accessible and doesn't have a completion state
    return 'active';
  }

  if (props.step.id === 'search') {
    // Search is complete when sources are not stale and records exist
    if (isSearchComplete.value && (processedRecords.value > 0 || everProcessedRecords.value > 0)) {
      return 'complete';
    }
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
    // If any prior step has pending work, don't show as complete (but not active either —
    // only show in-progress dot when this step itself has pending records)
    if (props.hasPriorPending) return 'pending';
    return 'complete';
  }

  // Step was completed in the past but records have moved to later steps
  // (e.g. preprocessing produced md_processed, but prescreen moved them on)
  if (everProcessedRecords.value > 0) {
    if (props.hasPriorPending) return 'pending';
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
    class="group relative flex items-center gap-3 py-2 px-2 rounded-lg text-sm transition-all"
    :class="[
      isActive
        ? 'text-foreground font-semibold bg-primary/10'
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

      <!-- Definition step: plain icon, no circle -->
      <div
        v-if="step.id === 'review_definition'"
        class="relative z-10 flex h-5 w-5 items-center justify-center bg-background text-foreground"
      >
        <BookOpen class="h-3.5 w-3.5" />
      </div>

      <!-- Step indicator dot (all other steps) -->
      <div
        v-else
        class="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all"
        :class="[
          stepStatus === 'complete'
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : stepStatus === 'active'
              ? 'border-foreground bg-background text-foreground'
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
        <div
          v-else-if="stepStatus === 'active'"
          class="h-1.5 w-1.5 rounded-full bg-current"
        />
      </div>
    </div>

    <!-- Label and count -->
    <div class="flex flex-1 items-center justify-between min-w-0 pr-2">
      <span class="truncate">{{ step.label }}</span>
      <div v-if="!isGateStep" class="flex items-center gap-1 ml-2">
        <TooltipProvider :delay-duration="300">
          <Tooltip v-if="deltaPendingRecords > 0">
            <TooltipTrigger as-child>
              <span
                class="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500/15 px-1.5 text-xs tabular-nums text-emerald-500 font-medium"
              >
                +{{ deltaPendingRecords }}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" class="max-w-[200px]">
              <p class="text-xs">{{ deltaPendingRecords }} new record{{ deltaPendingRecords !== 1 ? 's' : '' }} from dev that have reached this step</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip v-if="processedRecords > 0 && pendingRecords > 0 && !deltaPendingRecords">
            <TooltipTrigger as-child>
              <span
                class="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500/15 px-1.5 text-xs tabular-nums text-emerald-500 font-medium"
              >
                +{{ processedRecords }}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" class="max-w-[200px]">
              <p class="text-xs">{{ processedRecords }} record{{ processedRecords !== 1 ? 's' : '' }} completed at this step</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip v-if="pendingRecords > 0">
            <TooltipTrigger as-child>
              <span
                class="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs tabular-nums text-primary font-medium"
              >
                {{ pendingRecords }}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" class="max-w-[200px]">
              <p class="text-xs">{{ pendingRecords }} record{{ pendingRecords !== 1 ? 's' : '' }} waiting to be processed</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  </RouterLink>
</template>
