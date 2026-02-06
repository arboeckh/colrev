<script setup lang="ts">
import { computed } from 'vue';
import { GitBranch, ArrowUp, ArrowDown, Check, AlertCircle } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import type { GitStatus } from '@/types/project';

const props = defineProps<{
  status: GitStatus;
  showBranch?: boolean;
}>();

const syncState = computed(() => {
  const { ahead, behind, is_clean, uncommitted_changes } = props.status;

  if (!is_clean || uncommitted_changes > 0) {
    return {
      icon: AlertCircle,
      label: `${uncommitted_changes} uncommitted`,
      variant: 'destructive' as const,
      class: 'text-yellow-500',
    };
  }

  if (ahead > 0 && behind > 0) {
    return {
      icon: GitBranch,
      label: `${ahead}↑ ${behind}↓`,
      variant: 'outline' as const,
      class: 'text-yellow-500',
    };
  }

  if (ahead > 0) {
    return {
      icon: ArrowUp,
      label: `${ahead} ahead`,
      variant: 'outline' as const,
      class: 'text-blue-500',
    };
  }

  if (behind > 0) {
    return {
      icon: ArrowDown,
      label: `${behind} behind`,
      variant: 'outline' as const,
      class: 'text-orange-500',
    };
  }

  return {
    icon: Check,
    label: 'In sync',
    variant: 'outline' as const,
    class: 'text-green-500',
  };
});
</script>

<template>
  <div class="flex items-center gap-2">
    <Badge v-if="showBranch" variant="secondary" class="font-mono text-xs">
      <GitBranch class="h-3 w-3 mr-1" />
      {{ status.branch }}
    </Badge>

    <Badge :variant="syncState.variant" class="gap-1">
      <component :is="syncState.icon" class="h-3 w-3" :class="syncState.class" />
      <span class="text-xs">{{ syncState.label }}</span>
    </Badge>
  </div>
</template>
