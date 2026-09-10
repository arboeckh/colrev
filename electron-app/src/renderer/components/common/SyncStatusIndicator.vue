<script setup lang="ts">
/**
 * Quiet, always-visible proof that syncing is happening.
 *
 * Background sync that gives no sign of itself is indistinguishable from
 * background sync that is broken, so this states what the coordinator is
 * doing and when it last succeeded. It also carries the off switch: a user
 * who cannot turn automatic syncing off has no recourse when it misbehaves.
 */
import { computed } from 'vue';
import { Check, Loader2, RefreshCw, WifiOff } from 'lucide-vue-next';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useGitStore } from '@/stores/git';
import { useSyncStore } from '@/stores/sync';

const git = useGitStore();
const sync = useSyncStore();

const autoSyncOff = computed(() => !sync.autoPullEnabled && !sync.autoPushEnabled);

function relativeTime(at: number | null): string {
  if (at === null) return 'not yet';
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

const state = computed(() => {
  if (!git.hasRemote) return null;
  if (git.isOffline) {
    return { icon: WifiOff, label: 'Offline', tooltip: 'No connection to the remote. Syncing resumes automatically.' };
  }
  if (sync.busy) {
    return { icon: Loader2, label: 'Syncing', tooltip: 'Talking to the remote…', spin: true };
  }
  if (autoSyncOff.value) {
    return { icon: RefreshCw, label: 'Manual', tooltip: 'Automatic syncing is off. Use the buttons to push and pull.' };
  }
  if (sync.isSuspended) {
    return {
      icon: Check,
      label: 'Synced',
      tooltip: `Paused while you finish what you're doing. Last synced ${relativeTime(sync.lastSyncAt)}.`,
    };
  }
  return {
    icon: Check,
    label: 'Synced',
    tooltip: `Changes sync automatically. Last checked ${relativeTime(sync.lastFetchAt)}.`,
  };
});
</script>

<template>
  <DropdownMenu v-if="state">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger
            class="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            data-testid="sync-status-indicator"
          >
            <component
              :is="state.icon"
              class="h-3 w-3"
              :class="state.spin ? 'animate-spin' : ''"
            />
            {{ state.label }}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p class="text-xs">{{ state.tooltip }}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
        Syncing keeps your review in step with collaborators. Turning it off
        makes conflicts more likely, not less.
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        :model-value="sync.autoPullEnabled"
        data-testid="toggle-auto-pull"
        @update:model-value="sync.setAutoPull($event)"
      >
        Receive changes automatically
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        :model-value="sync.autoPushEnabled"
        data-testid="toggle-auto-push"
        @update:model-value="sync.setAutoPush($event)"
      >
        Share my changes automatically
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="sync-now" @click="sync.syncNow()">
        <RefreshCw class="h-3.5 w-3.5" />
        Sync now
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
