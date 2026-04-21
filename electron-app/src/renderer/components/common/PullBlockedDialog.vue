<script setup lang="ts">
import { computed, ref } from 'vue';
import { AlertTriangle, ArrowDown, Loader2, RotateCcw, Save } from 'lucide-vue-next';
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
  get: () => git.showPullBlockedDialog,
  set: (value: boolean) => {
    git.showPullBlockedDialog = value;
  },
});

const busy = ref<null | 'save' | 'discard'>(null);

const pendingCount = computed(() => pending.pendingCount);
const behindCount = computed(() => git.behind);

async function saveAndPull() {
  if (busy.value) return;
  busy.value = 'save';
  try {
    if (pending.hasPending) {
      const committed = await pending.commit('Save before pulling');
      if (!committed) return;
    }
    open.value = false;
    await git.pull();
  } finally {
    busy.value = null;
  }
}

async function discardAndPull() {
  if (busy.value) return;
  busy.value = 'discard';
  try {
    if (pending.hasPending) {
      const ok = await pending.discardAll();
      if (!ok) return;
    }
    open.value = false;
    await git.pull();
  } finally {
    busy.value = null;
  }
}

function openResetDialog() {
  open.value = false;
  git.showResetToRemoteDialog = true;
}

function cancel() {
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]" data-testid="pull-blocked-dialog">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-orange-500">
          <AlertTriangle class="h-5 w-5" />
          Can't pull: you have unsaved local changes
        </DialogTitle>
        <DialogDescription>
          There
          {{ behindCount === 1 ? 'is' : 'are' }}
          {{ behindCount }} new change{{ behindCount === 1 ? '' : 's' }} on the remote,
          but your local changes would be overwritten. Choose how to proceed.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3 py-2">
        <button
          type="button"
          class="w-full rounded border border-border p-3 text-left hover:bg-accent disabled:opacity-50"
          :disabled="busy !== null"
          data-testid="pull-blocked-save"
          @click="saveAndPull"
        >
          <div class="flex items-center gap-2 text-sm font-medium">
            <Save v-if="busy !== 'save'" class="h-4 w-4" />
            <Loader2 v-else class="h-4 w-4 animate-spin" />
            Save my changes, then pull
          </div>
          <div class="mt-1 text-xs text-muted-foreground">
            Commits your {{ pendingCount }} pending change{{ pendingCount === 1 ? '' : 's' }}
            first, then pulls. If this creates a conflict you'll be walked through resolving it.
          </div>
        </button>

        <button
          type="button"
          class="w-full rounded border border-border p-3 text-left hover:bg-accent disabled:opacity-50"
          :disabled="busy !== null"
          data-testid="pull-blocked-discard"
          @click="discardAndPull"
        >
          <div class="flex items-center gap-2 text-sm font-medium text-destructive">
            <RotateCcw v-if="busy !== 'discard'" class="h-4 w-4" />
            <Loader2 v-else class="h-4 w-4 animate-spin" />
            Discard my changes, then pull
          </div>
          <div class="mt-1 text-xs text-muted-foreground">
            Reverts your {{ pendingCount }} pending change{{ pendingCount === 1 ? '' : 's' }}
            and pulls the remote version. Cannot be undone.
          </div>
        </button>
      </div>

      <DialogFooter class="flex items-center justify-between gap-2 sm:justify-between">
        <Button
          variant="link"
          size="sm"
          class="text-muted-foreground"
          :disabled="busy !== null"
          data-testid="pull-blocked-reset"
          @click="openResetDialog"
        >
          Still stuck? Reset to remote…
        </Button>
        <div class="flex gap-2">
          <Button
            variant="outline"
            :disabled="busy !== null"
            data-testid="pull-blocked-cancel"
            @click="cancel"
          >
            <ArrowDown class="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
