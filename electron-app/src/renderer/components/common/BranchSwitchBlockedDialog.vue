<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertTriangle, Loader2, RotateCcw, Save, X } from 'lucide-vue-next';
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
  get: () => git.showBranchSwitchBlockedDialog,
  set: (value: boolean) => {
    git.showBranchSwitchBlockedDialog = value;
  },
});

const busy = ref<null | 'save' | 'discard'>(null);

const target = computed(() => git.blockedSwitchTarget ?? '');
const targetLabel = computed(() =>
  target.value.startsWith('review/') ? 'your review branch' : `"${target.value}"`,
);

// Prefer the counts git reported at the moment of refusal — pendingChanges may
// not have refreshed yet when the switch was triggered by navigation.
const pendingCount = computed(() => {
  const dirty = git.blockedSwitchDirty;
  if (dirty) return dirty.uncommittedCount + dirty.untrackedCount;
  return pending.pendingCount;
});

async function switchToTarget() {
  const branch = target.value;
  if (!branch) return;
  // Take the continuation before the switch: switchBranch clears it if it
  // blocks again, and it must run at most once either way.
  const resume = git.blockedSwitchResume;
  git.blockedSwitchResume = null;
  open.value = false;
  const switched = await git.switchBranch(branch);
  if (switched && resume) await resume();
}

async function saveAndSwitch() {
  if (busy.value) return;
  busy.value = 'save';
  try {
    await pending.refresh();
    if (pending.hasPending) {
      const committed = await pending.commit(`Save before switching to ${target.value}`);
      if (!committed) return;
    }
    await switchToTarget();
  } finally {
    busy.value = null;
  }
}

async function discardAndSwitch() {
  if (busy.value) return;
  busy.value = 'discard';
  try {
    await pending.refresh();
    if (pending.hasPending) {
      const ok = await pending.discardAll();
      if (!ok) return;
    }
    await switchToTarget();
  } finally {
    busy.value = null;
  }
}

function cancel() {
  git.blockedSwitchResume = null;
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]" data-testid="branch-switch-blocked-dialog">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-orange-500">
          <AlertTriangle class="h-5 w-5" />
          Save your work before switching
        </DialogTitle>
        <DialogDescription>
          You have {{ pendingCount }} unsaved change{{ pendingCount === 1 ? '' : 's' }}.
          Switching to {{ targetLabel }} would leave them behind, so choose what to do
          with them first.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3 py-2">
        <button
          type="button"
          class="w-full rounded border border-border p-3 text-left hover:bg-accent disabled:opacity-50"
          :disabled="busy !== null"
          data-testid="branch-switch-blocked-save"
          @click="saveAndSwitch"
        >
          <div class="flex items-center gap-2 text-sm font-medium">
            <Save v-if="busy !== 'save'" class="h-4 w-4" />
            <Loader2 v-else class="h-4 w-4 animate-spin" />
            Save my changes, then switch
          </div>
          <div class="mt-1 text-xs text-muted-foreground">
            Commits your work to the current branch first, then switches. Nothing is lost.
          </div>
        </button>

        <button
          type="button"
          class="w-full rounded border border-border p-3 text-left hover:bg-accent disabled:opacity-50"
          :disabled="busy !== null"
          data-testid="branch-switch-blocked-discard"
          @click="discardAndSwitch"
        >
          <div class="flex items-center gap-2 text-sm font-medium text-destructive">
            <RotateCcw v-if="busy !== 'discard'" class="h-4 w-4" />
            <Loader2 v-else class="h-4 w-4 animate-spin" />
            Discard my changes, then switch
          </div>
          <div class="mt-1 text-xs text-muted-foreground">
            Throws away your {{ pendingCount }} unsaved
            change{{ pendingCount === 1 ? '' : 's' }}. Cannot be undone.
          </div>
        </button>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="busy !== null"
          data-testid="branch-switch-blocked-cancel"
          @click="cancel"
        >
          <X class="h-4 w-4" />
          Stay on this branch
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
