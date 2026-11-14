<script setup lang="ts">
/**
 * Says what the backend is doing once a call has been waiting a while.
 *
 * The Python backend handles one request at a time (docs/adr/0001) and slow
 * methods have no timeout by design, so a hung call freezes every other call
 * behind it. This shows what is running and how many calls wait, and offers
 * "Restart backend" as the way out.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBackendStore } from '@/stores/backend';

/** A call faster than this is not worth a notice. */
const SHOW_AFTER_MS = 2000;

const backend = useBackendStore();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 500);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const waitedMs = computed(() =>
  backend.rpcInFlightSince === null ? 0 : now.value - backend.rpcInFlightSince,
);
const visible = computed(
  () => backend.isRunning && backend.rpcInFlight !== null && waitedMs.value >= SHOW_AFTER_MS,
);
const waitedSeconds = computed(() => Math.floor(waitedMs.value / 1000));

const confirmOpen = ref(false);
const restarting = ref(false);

async function restart() {
  restarting.value = true;
  try {
    await backend.restart();
  } finally {
    restarting.value = false;
    confirmOpen.value = false;
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="fixed bottom-4 left-4 z-50 flex max-w-sm items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm shadow-lg"
    data-testid="backend-busy-indicator"
    role="status"
    aria-live="polite"
  >
    <Loader2 class="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
    <div class="min-w-0">
      <div data-testid="backend-busy-working-on">
        Waiting on: <span class="font-medium">{{ backend.rpcInFlight }}</span>
        <span class="text-muted-foreground"> ({{ waitedSeconds }}s)</span>
      </div>
      <div
        v-if="backend.rpcQueued.length > 0"
        class="text-xs text-muted-foreground"
        data-testid="backend-busy-queued"
      >
        {{ backend.rpcQueued.length }}
        {{ backend.rpcQueued.length === 1 ? 'call is' : 'calls are' }} waiting behind it
      </div>
    </div>
    <Button
      variant="outline"
      size="sm"
      class="h-7 shrink-0 text-xs"
      data-testid="backend-restart-button"
      @click="confirmOpen = true"
    >
      Restart backend
    </Button>
  </div>

  <Dialog v-model:open="confirmOpen">
    <DialogContent data-testid="backend-restart-dialog">
      <DialogHeader>
        <DialogTitle>Restart the backend?</DialogTitle>
        <DialogDescription>
          The running operation ({{ backend.rpcInFlight ?? 'none' }}) will be interrupted and any
          calls waiting behind it will fail. Work already saved to the review is kept; an
          operation that was cut off part-way may need to be run again.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" :disabled="restarting" @click="confirmOpen = false">
          Cancel
        </Button>
        <Button
          variant="destructive"
          :disabled="restarting"
          data-testid="backend-restart-confirm"
          @click="restart"
        >
          <Loader2 v-if="restarting" class="mr-2 h-4 w-4 animate-spin" />
          Restart backend
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
