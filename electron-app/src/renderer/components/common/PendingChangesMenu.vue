<script setup lang="ts">
import { computed, ref } from 'vue';
import { FileDiff, GitCommit, LifeBuoy, RefreshCw, RotateCcw } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { usePendingChangesStore } from '@/stores/pendingChanges';
import { useGitStore } from '@/stores/git';
import CommitDialog from './CommitDialog.vue';
import DiscardDialog from './DiscardDialog.vue';

const pending = usePendingChangesStore();
const git = useGitStore();

const commitOpen = ref(false);
const discardOpen = ref(false);
const popoverOpen = ref(false);

const recordSummary = computed(() => {
  const counts = pending.stagedRecordCountsByType;
  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.modified) parts.push(`${counts.modified} modified`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  return parts.length > 0 ? parts.join(', ') : null;
});

const fileCounts = computed(() => {
  const status = pending.gitStatus;
  if (!status) return null;
  return {
    modified: status.modified_files.length,
    staged: status.staged_files.length,
    untracked: status.untracked_files.length,
  };
});

function openCommit() {
  popoverOpen.value = false;
  commitOpen.value = true;
}

function openDiscard() {
  popoverOpen.value = false;
  discardOpen.value = true;
}

function openRecover() {
  popoverOpen.value = false;
  git.showResetToRemoteDialog = true;
}
</script>

<template>
  <div class="flex items-center">
    <Popover v-model:open="popoverOpen">
      <PopoverTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="gap-2"
          :disabled="!pending.hasPending && !git.hasRemote"
          data-testid="pending-changes-badge"
        >
          <FileDiff class="h-4 w-4" />
          <span class="hidden sm:inline">Changes</span>
          <Badge
            v-if="pending.hasPending"
            variant="secondary"
            class="tabular-nums"
            data-testid="pending-changes-count"
          >
            {{ pending.pendingCount }}
          </Badge>
        </Button>
      </PopoverTrigger>

      <PopoverContent class="w-80" align="end">
        <div class="space-y-3">
          <div>
            <h3 class="text-sm font-semibold">Pending changes</h3>
            <p class="text-xs text-muted-foreground">
              Staged but not yet committed to this branch.
            </p>
          </div>

          <div v-if="recordSummary" class="rounded border border-border p-2 text-sm">
            <div class="text-xs font-medium text-muted-foreground">Records</div>
            <div>{{ recordSummary }}</div>
          </div>

          <div v-if="fileCounts" class="rounded border border-border p-2 text-xs space-y-1">
            <div class="text-xs font-medium text-muted-foreground">Files</div>
            <div class="flex justify-between">
              <span>Modified</span><span class="tabular-nums">{{ fileCounts.modified }}</span>
            </div>
            <div class="flex justify-between">
              <span>Staged</span><span class="tabular-nums">{{ fileCounts.staged }}</span>
            </div>
            <div class="flex justify-between">
              <span>Untracked</span><span class="tabular-nums">{{ fileCounts.untracked }}</span>
            </div>
          </div>

          <div v-if="pending.lastRefreshError" class="text-xs text-destructive">
            {{ pending.lastRefreshError }}
          </div>

          <div class="flex gap-2">
            <Button
              size="sm"
              class="flex-1 gap-2"
              :disabled="!pending.hasPending || pending.isCommitting"
              data-testid="open-commit-dialog"
              @click="openCommit"
            >
              <GitCommit class="h-4 w-4" />
              Commit…
            </Button>
            <Button
              size="sm"
              variant="outline"
              class="flex-1 gap-2"
              :disabled="!pending.hasPending || pending.isDiscarding"
              data-testid="open-discard-dialog"
              @click="openDiscard"
            >
              <RotateCcw class="h-4 w-4" />
              Discard…
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            class="w-full gap-2"
            @click="pending.refresh"
          >
            <RefreshCw class="h-3.5 w-3.5" />
            Refresh
          </Button>

          <div
            v-if="git.hasRemote"
            class="border-t border-border pt-2 mt-1 space-y-1"
          >
            <div class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Recover
            </div>
            <Button
              size="sm"
              variant="ghost"
              class="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
              data-testid="open-reset-to-remote"
              @click="openRecover"
            >
              <LifeBuoy class="h-3.5 w-3.5" />
              Reset project to remote…
            </Button>
            <p class="text-[10px] text-muted-foreground px-2">
              Last resort. Discards local changes and unpushed commits so the project
              matches <span class="font-mono">origin/{{ git.currentBranch }}</span>.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>

    <CommitDialog v-model:open="commitOpen" />
    <DiscardDialog v-model:open="discardOpen" />
  </div>
</template>
