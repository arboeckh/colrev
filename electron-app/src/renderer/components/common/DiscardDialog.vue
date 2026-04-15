<script setup lang="ts">
import { AlertTriangle, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePendingChangesStore } from '@/stores/pendingChanges';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const pending = usePendingChangesStore();

async function confirm() {
  if (pending.isDiscarding) return;
  const ok = await pending.discardAll();
  if (ok) {
    emit('update:open', false);
  }
}

function cancel() {
  emit('update:open', false);
}

function onOpenChange(value: boolean) {
  emit('update:open', value);
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[480px]" data-testid="discard-dialog">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-destructive">
          <AlertTriangle class="h-5 w-5" />
          Discard all pending changes?
        </DialogTitle>
        <DialogDescription>
          Reverts every staged change and untracked file to the last commit.
          {{ pending.pendingCount }} change{{ pending.pendingCount === 1 ? '' : 's' }}
          will be lost. This cannot be undone.
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="pending.isDiscarding"
          data-testid="cancel-discard"
          @click="cancel"
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          :disabled="pending.isDiscarding"
          data-testid="confirm-discard-all"
          @click="confirm"
        >
          <Loader2 v-if="pending.isDiscarding" class="h-4 w-4 animate-spin" />
          Discard all
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
