<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, Loader2, RefreshCcw } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGitStore } from '@/stores/git';
import { usePendingChangesStore } from '@/stores/pendingChanges';

const git = useGitStore();
const pending = usePendingChangesStore();

const open = computed({
  get: () => git.showResetToRemoteDialog,
  set: (value: boolean) => {
    git.showResetToRemoteDialog = value;
  },
});

const pendingFileCount = computed(() => pending.pendingCount);
const unpushedCommits = computed(() => git.ahead);
const targetRef = computed(() => `origin/${git.currentBranch}`);

const canReset = computed(() => git.hasRemote && !git.isResettingToRemote);

async function confirm() {
  if (!canReset.value) return;
  await git.resetToRemote();
}

function cancel() {
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]" data-testid="reset-to-remote-dialog">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-destructive">
          <AlertTriangle class="h-5 w-5" />
          Reset project to remote?
        </DialogTitle>
        <DialogDescription>
          This is a recovery action. Use it only when you're stuck and want
          the project to match the remote exactly.
        </DialogDescription>
      </DialogHeader>

      <div class="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-2">
        <p class="font-medium">The following will be permanently discarded:</p>
        <ul class="ml-4 list-disc space-y-1 text-xs">
          <li>
            <span class="tabular-nums">{{ pendingFileCount }}</span>
            uncommitted local change{{ pendingFileCount === 1 ? '' : 's' }}
          </li>
          <li>
            <span class="tabular-nums">{{ unpushedCommits }}</span>
            local commit{{ unpushedCommits === 1 ? '' : 's' }} not yet on the remote
          </li>
          <li>Every untracked file in the project directory</li>
        </ul>
        <p class="pt-1 text-xs text-muted-foreground">
          The project will match <code class="font-mono">{{ targetRef }}</code> exactly.
          This cannot be undone.
        </p>
      </div>

      <div v-if="!git.hasRemote" class="text-xs text-destructive">
        This project has no remote. Push to GitHub first, then you can reset to it.
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="git.isResettingToRemote"
          data-testid="reset-to-remote-cancel"
          @click="cancel"
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          :disabled="!canReset"
          data-testid="reset-to-remote-confirm"
          @click="confirm"
        >
          <Loader2 v-if="git.isResettingToRemote" class="h-4 w-4 animate-spin" />
          <RefreshCcw v-else class="h-4 w-4" />
          Reset to remote
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
