<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useBackendStore } from '@/stores/backend';

const backend = useBackendStore();

// Show while the backend is starting or restarting. A backend that is stopped
// or failed is not "starting": that state has a Retry (landing page, project
// banner) rather than a spinner that never ends.
const shouldShow = computed(
  () => backend.status === 'starting' || backend.status === 'restarting',
);
const isRestarting = computed(() => backend.status === 'restarting');

const startTime = ref(Date.now());
const elapsed = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  startTime.value = Date.now();
  timer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startTime.value) / 1000);
  }, 1000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

// After 15s show the elapsed counter — reassures the user that things are
// still moving when the wait exceeds normal expectation.
const showElapsed = computed(() => elapsed.value >= 15);
</script>

<template>
  <Transition name="backend-overlay">
    <div
      v-if="shouldShow"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
      data-testid="backend-starting-overlay"
      role="status"
      aria-live="polite"
    >
      <div class="max-w-md px-8 text-center">
        <div
          class="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mx-auto mb-6"
        />
        <h2 class="text-lg font-semibold mb-3" data-testid="backend-overlay-title">
          {{ isRestarting ? 'Restarting the review engine' : 'Starting CoLRev' }}
        </h2>
        <p v-if="isRestarting" class="text-sm text-muted-foreground leading-relaxed">
          The review engine stopped and is starting again. Your work is saved;
          what is on screen will refresh when it is back.
        </p>
        <p v-else class="text-sm text-muted-foreground leading-relaxed">
          First launch can take up to 30 seconds while the review engine loads.
          This is normal — subsequent launches start faster.
        </p>
        <p
          v-if="showElapsed"
          class="mt-4 text-xs text-muted-foreground"
          data-testid="backend-starting-elapsed"
        >
          {{ elapsed }}s elapsed — still starting&hellip;
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backend-overlay-enter-active,
.backend-overlay-leave-active {
  transition: opacity 200ms ease;
}
.backend-overlay-enter-from,
.backend-overlay-leave-to {
  opacity: 0;
}
</style>
