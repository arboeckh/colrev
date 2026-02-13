<script setup lang="ts">
import { computed } from 'vue';
import { GitBranch, ArrowUp, ArrowDown, Check, AlertCircle, WifiOff, Loader2 } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { GitStatus } from '@/types/project';
import { useGitStore } from '@/stores/git';

const props = defineProps<{
  status: GitStatus;
  showBranch?: boolean;
}>();

const git = useGitStore();

const syncState = computed(() => {
  if (git.isOffline) {
    return {
      icon: WifiOff,
      label: 'Offline',
      variant: 'outline' as const,
      class: 'text-muted-foreground',
      clickable: false,
      action: null as (() => void) | null,
      tooltip: 'No connection to remote. Local operations still work.',
    };
  }

  const { ahead, behind, is_clean, uncommitted_changes } = props.status;

  if (uncommitted_changes > 0) {
    return {
      icon: AlertCircle,
      label: `${uncommitted_changes} uncommitted`,
      variant: 'destructive' as const,
      class: 'text-yellow-500',
      clickable: false,
      action: null,
      tooltip: 'There are uncommitted changes in the working directory.',
    };
  }

  if (ahead > 0 && behind > 0) {
    return {
      icon: GitBranch,
      label: `${ahead}\u2191 ${behind}\u2193`,
      variant: 'outline' as const,
      class: 'text-yellow-500',
      clickable: false,
      action: null,
      tooltip: 'Branches have diverged. Consider creating a Pull Request.',
    };
  }

  if (ahead > 0) {
    return {
      icon: ArrowUp,
      label: `${ahead} to save`,
      variant: 'outline' as const,
      class: 'text-blue-500',
      clickable: true,
      action: () => git.push(),
      tooltip: `${ahead} commit(s) ahead of remote. Click to save.`,
    };
  }

  if (behind > 0) {
    return {
      icon: ArrowDown,
      label: `${behind} to pull`,
      variant: 'outline' as const,
      class: 'text-orange-500',
      clickable: true,
      action: () => git.pull(),
      tooltip: `${behind} commit(s) behind remote. Click to pull.`,
    };
  }

  return {
    icon: Check,
    label: 'In sync',
    variant: 'outline' as const,
    class: 'text-green-500',
    clickable: false,
    action: null,
    tooltip: 'Up to date with remote.',
  };
});

const isLoading = computed(() => git.isPushing || git.isPulling || git.isFetching);

function handleClick() {
  if (syncState.value.action && !isLoading.value) {
    syncState.value.action();
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <Badge v-if="showBranch" variant="secondary" class="font-mono text-xs">
      <GitBranch class="h-3 w-3 mr-1" />
      {{ status.branch }}
    </Badge>

    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <Badge
            :variant="syncState.variant"
            class="gap-1"
            :class="syncState.clickable && !isLoading ? 'cursor-pointer hover:bg-accent' : ''"
            data-testid="git-sync-status"
            @click="handleClick"
          >
            <Loader2 v-if="isLoading" class="h-3 w-3 animate-spin" />
            <component v-else :is="syncState.icon" class="h-3 w-3" :class="syncState.class" />
            <span class="text-xs">{{ syncState.label }}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p class="text-xs">{{ syncState.tooltip }}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- Auto-save toggle -->
    <TooltipProvider v-if="git.hasRemote">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-1.5 text-[10px]"
            :class="git.autoSave ? 'text-green-500' : 'text-muted-foreground'"
            data-testid="auto-save-toggle"
            @click="git.setAutoSave(!git.autoSave)"
          >
            {{ git.autoSave ? 'AUTO' : 'MANUAL' }}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p class="text-xs">{{ git.autoSave ? 'Auto-save: ON. Changes are pushed after each operation.' : 'Auto-save: OFF. Click "Save" to push changes.' }}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
