<script setup lang="ts">
/**
 * Shown inside a project when the backend is not running (it exited, or
 * failed to start). Without it, every control that needs the backend is dead
 * and nothing says why. Starting and restarting are covered by the overlay.
 */
import { computed, ref } from 'vue';
import { AlertTriangle, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useBackendStore } from '@/stores/backend';

const backend = useBackendStore();

const visible = computed(
  () => backend.hasStarted && (backend.status === 'stopped' || backend.status === 'error'),
);

const retrying = ref(false);
async function retry() {
  retrying.value = true;
  try {
    await backend.start();
  } finally {
    retrying.value = false;
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2"
    data-testid="backend-status-banner"
    role="alert"
  >
    <AlertTriangle class="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
    <span class="text-sm text-red-600 dark:text-red-400">
      The review engine is not running, so nothing can be loaded or changed.
      <span v-if="backend.error" data-testid="backend-status-banner-error">{{ backend.error }}.</span>
    </span>
    <Button
      variant="outline"
      size="sm"
      class="ml-auto h-7 text-xs"
      :disabled="retrying"
      data-testid="backend-retry-button"
      @click="retry"
    >
      <Loader2 v-if="retrying" class="mr-1 h-3 w-3 animate-spin" />
      Retry
    </Button>
  </div>
</template>
