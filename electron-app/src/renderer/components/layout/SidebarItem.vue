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
import type { WorkflowStepInfo, RecordCounts } from '@/types/project';
import type { GetOperationInfoResponse } from '@/types/api';
import { useProjectsStore } from '@/stores/projects';

const props = defineProps<{
  step: WorkflowStepInfo;
  projectId: string;
  operationInfo?: GetOperationInfoResponse | null;
  recordCounts?: RecordCounts | null;
  deltaByState?: globalThis.Record<string, number> | null;
  showDelta?: boolean;
  downstreamStates?: string[];
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

// Status is derived by the projects store getter (single source of truth)
const stepStatus = computed(() => projects.getStepStatus(props.step.id));

// Count of records in input states (waiting for this step)
const pendingRecords = computed(() => {
  if (props.suppressCounts || !props.recordCounts) return 0;
  return props.step.inputStates.reduce((sum, state) => {
    return sum + (props.recordCounts?.[state] ?? 0);
  }, 0);
});

// Count of records in non-terminal output states (successfully forwarded to later steps)
const forwardedRecords = computed(() => {
  if (props.suppressCounts || !props.recordCounts) return 0;
  const terminal = new Set(props.step.terminalOutputStates ?? []);
  return props.step.outputStates
    .filter((state) => !terminal.has(state))
    .reduce((sum, state) => sum + (props.recordCounts?.[state] ?? 0), 0);
});

// Count of new records (from delta) that have reached this step or beyond
const deltaPendingRecords = computed(() => {
  if (!props.showDelta || !props.deltaByState) return 0;
  if (props.step.inputStates.length === 0 && props.step.outputStates.length === 0) return 0;
  const states = props.downstreamStates ?? props.step.inputStates;
  return states.reduce((sum, state) => {
    return sum + (props.deltaByState?.[state] ?? 0);
  }, 0);
});

// Gate steps (launch, reconcile) don't process records — suppress badges
const isGateStep = computed(() => props.step.stepKind === 'gate');
</script>

<template>
  <RouterLink
    :to="routePath"
    :data-testid="`sidebar-${step.id}`"
    :data-step-status="stepStatus"
    class="group relative flex items-center gap-3 py-2 px-2 rounded-md text-[13px] transition-all"
    :class="[
      isActive
        ? 'text-ink-900 font-medium bg-card border border-sidebar-border'
        : 'text-ink-600 hover:text-ink-900 hover:bg-card/60 border border-transparent',
    ]"
  >
    <!-- Vertical line (behind the dot) -->
    <div class="relative flex flex-col items-center w-5">
      <!-- Line segment above -->
      <div
        v-if="!isFirst"
        class="absolute bottom-1/2 w-px h-4 -translate-y-0.5"
        :class="stepStatus === 'complete' ? 'bg-eucalyptus-600' : 'bg-sidebar-border'"
      />
      <!-- Line segment below -->
      <div
        v-if="!isLast"
        class="absolute top-1/2 w-px h-4 translate-y-0.5"
        :class="stepStatus === 'complete' ? 'bg-eucalyptus-600' : 'bg-sidebar-border'"
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
            ? 'border-eucalyptus-600 bg-eucalyptus-600 text-cream-50'
            : stepStatus === 'active'
              ? 'border-eucalyptus-700 bg-card text-eucalyptus-700'
              : stepStatus === 'warning'
                ? 'border-amber-accent bg-amber-accent text-cream-50'
                : isActive
                  ? 'border-ink-300 bg-cream-200'
                  : 'border-ink-200 bg-card',
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
                class="flex h-5 min-w-5 items-center justify-center rounded-full border border-eucalyptus-300/50 bg-eucalyptus-50 px-1.5 text-[11px] tabular-nums text-eucalyptus-700 font-medium"
              >
                +{{ deltaPendingRecords }}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" class="max-w-[200px]">
              <p class="text-xs">{{ deltaPendingRecords }} new record{{ deltaPendingRecords !== 1 ? 's' : '' }} from dev that have reached this step</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip v-if="forwardedRecords > 0 && !deltaPendingRecords">
            <TooltipTrigger as-child>
              <span
                class="flex h-5 min-w-5 items-center justify-center rounded-full border border-eucalyptus-300/50 bg-eucalyptus-50 px-1.5 text-[11px] tabular-nums text-eucalyptus-700 font-medium"
              >
                +{{ forwardedRecords }}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" class="max-w-[200px]">
              <p class="text-xs">{{ forwardedRecords }} record{{ forwardedRecords !== 1 ? 's' : '' }} completed at this step</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip v-if="pendingRecords > 0">
            <TooltipTrigger as-child>
              <span
                class="flex h-5 min-w-5 items-center justify-center rounded-full bg-cream-200 px-1.5 text-[11px] tabular-nums text-ink-700 font-medium"
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
