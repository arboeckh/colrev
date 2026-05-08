<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUp, ArrowDown, Loader2, WifiOff } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useGitStore } from '@/stores/git';
import { usePendingChangesStore } from '@/stores/pendingChanges';
import { computeGitSyncState } from '@/lib/gitSyncState';

const git = useGitStore();
const pending = usePendingChangesStore();

const syncState = computed(() =>
  computeGitSyncState({
    ahead: git.ahead,
    behind: git.behind,
    pendingCount: pending.pendingCount,
    isOffline: git.isOffline,
    isResolving: git.isResolving,
    isPushing: git.isPushing,
    isPulling: git.isPulling,
    hasRemote: git.hasRemote,
  }),
);

async function handlePush() {
  const push = syncState.value.push;
  if (push.status !== 'active') return;
  if (pending.hasPending) {
    const committed = await pending.commit('Save changes');
    if (!committed) return;
    await git.refreshStatus();
  }
  if (git.ahead > 0) {
    await git.push();
  }
}

async function handlePull() {
  const pull = syncState.value.pull;
  if (pull.status === 'divergedWarning') {
    await git.startDivergenceResolution();
  } else if (pull.status === 'active') {
    await git.pull();
  }
}

const pushDisabled = computed(() => {
  const s = syncState.value.push.status;
  return s === 'hidden' || s === 'idle' || s === 'loading' || s === 'divergedBlocked' || s === 'offline';
});

const pullDisabled = computed(() => {
  const s = syncState.value.pull.status;
  return s === 'hidden' || s === 'idle' || s === 'loading' || s === 'offline';
});

const pushButtonClass = computed(() => {
  const s = syncState.value.push.status;
  if (s === 'active') return 'border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100';
  return 'text-muted-foreground border-border';
});

const pullButtonClass = computed(() => {
  const s = syncState.value.pull.status;
  if (s === 'divergedWarning') return 'border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20';
  if (s === 'active') return 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100';
  return 'text-muted-foreground border-border';
});
</script>

<template>
  <div v-if="syncState.push.status !== 'hidden'" class="flex items-center gap-1.5">
    <!-- Push button -->
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 text-xs px-2.5 transition-colors"
            :class="pushButtonClass"
            :disabled="pushDisabled"
            data-testid="push-button"
            @click="handlePush"
          >
            <Loader2 v-if="syncState.push.status === 'loading'" class="h-3 w-3 animate-spin" />
            <WifiOff v-else-if="syncState.push.status === 'offline'" class="h-3 w-3" />
            <ArrowUp v-else class="h-3 w-3" />
            {{ syncState.push.label }}
          </Button>
        </TooltipTrigger>
        <TooltipContent v-if="syncState.push.tooltip">
          <p class="text-xs">{{ syncState.push.tooltip }}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- Pull button -->
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 text-xs px-2.5 transition-colors"
            :class="pullButtonClass"
            :disabled="pullDisabled"
            data-testid="pull-button"
            @click="handlePull"
          >
            <Loader2 v-if="syncState.pull.status === 'loading'" class="h-3 w-3 animate-spin" />
            <WifiOff v-else-if="syncState.pull.status === 'offline'" class="h-3 w-3" />
            <ArrowDown v-else class="h-3 w-3" />
            {{ syncState.pull.label }}
          </Button>
        </TooltipTrigger>
        <TooltipContent v-if="syncState.pull.tooltip">
          <p class="text-xs">{{ syncState.pull.tooltip }}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
