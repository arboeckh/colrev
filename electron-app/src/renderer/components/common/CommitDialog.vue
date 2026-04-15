<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Loader2, GitCommit } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { usePendingChangesStore } from '@/stores/pendingChanges';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const pending = usePendingChangesStore();

const message = ref('');

const suggestedMessage = computed(() => {
  const counts = pending.stagedRecordCountsByType;
  const total =
    (counts.added ?? 0) + (counts.modified ?? 0) + (counts.removed ?? 0);
  if (total === 0) return 'Update project';
  if (total === 1) return 'Update 1 record';
  return `Update ${total} records`;
});

// Re-seed the suggested default whenever the dialog opens.
watch(
  () => props.open,
  (open) => {
    if (open) {
      message.value = suggestedMessage.value;
    }
  },
);

const canSubmit = computed(
  () => message.value.trim().length > 0 && !pending.isCommitting,
);

async function submit() {
  if (!canSubmit.value) return;
  const ok = await pending.commit(message.value);
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
    <DialogContent class="sm:max-w-[500px]" data-testid="commit-dialog">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <GitCommit class="h-5 w-5" />
          Commit pending changes
        </DialogTitle>
        <DialogDescription>
          {{ pending.pendingCount }} change{{ pending.pendingCount === 1 ? '' : 's' }}
          will be committed to the current branch.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-2">
        <label for="commit-message" class="text-sm font-medium">Commit message</label>
        <Textarea
          id="commit-message"
          v-model="message"
          rows="3"
          placeholder="Describe what changed"
          data-testid="commit-message-input"
          :disabled="pending.isCommitting"
        />
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="pending.isCommitting"
          data-testid="cancel-commit"
          @click="cancel"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSubmit"
          data-testid="submit-commit"
          @click="submit"
        >
          <Loader2 v-if="pending.isCommitting" class="h-4 w-4 animate-spin" />
          <GitCommit v-else class="h-4 w-4" />
          Commit
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
