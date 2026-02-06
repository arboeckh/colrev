<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Circle, CircleDot, CircleCheck, CircleAlert } from 'lucide-vue-next';
import type { WorkflowStepInfo } from '@/types/project';
import type { GetOperationInfoResponse } from '@/types/api';

const props = defineProps<{
  step: WorkflowStepInfo;
  projectId: string;
  operationInfo?: GetOperationInfoResponse | null;
  recordCount?: number;
}>();

const route = useRoute();

const isActive = computed(() => {
  return route.meta.step === props.step.id;
});

const routePath = computed(() => {
  return `/project/${props.projectId}/${props.step.route}`;
});

// Determine status icon based on operation info and record count
const statusIcon = computed(() => {
  if (!props.operationInfo) return Circle;

  // If operation can't run and there's a reason, show warning
  if (!props.operationInfo.can_run && props.operationInfo.reason) {
    // Check if it's because the step is not reached yet vs needs attention
    if (props.operationInfo.reason.includes('No records')) {
      return Circle; // Empty state
    }
    return CircleAlert; // Needs attention
  }

  // If there are affected records, show activity
  if (props.operationInfo.affected_records > 0) {
    return CircleDot; // Has records in this stage
  }

  // If operation has been completed (no affected records but can run)
  if (props.recordCount && props.recordCount > 0) {
    return CircleCheck; // Completed
  }

  return Circle; // Default empty
});

const statusClass = computed(() => {
  if (!props.operationInfo) return 'text-muted-foreground';

  if (!props.operationInfo.can_run && props.operationInfo.reason) {
    if (!props.operationInfo.reason.includes('No records')) {
      return 'text-yellow-500'; // Warning
    }
    return 'text-muted-foreground'; // Not reached
  }

  if (props.operationInfo.affected_records > 0) {
    return 'text-primary'; // Active
  }

  return 'text-green-500'; // Completed
});
</script>

<template>
  <RouterLink
    :to="routePath"
    :data-testid="`sidebar-${step.id}`"
    class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors"
    :class="[
      isActive
        ? 'bg-accent text-accent-foreground font-medium'
        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
    ]"
  >
    <component :is="statusIcon" class="h-4 w-4 flex-shrink-0" :class="statusClass" />
    <span class="truncate">{{ step.label }}</span>
    <span
      v-if="operationInfo?.affected_records"
      class="ml-auto text-xs tabular-nums text-muted-foreground"
    >
      {{ operationInfo.affected_records }}
    </span>
  </RouterLink>
</template>
