<script setup lang="ts">
import { computed } from 'vue';
import { FolderKanban } from 'lucide-vue-next';

// Every review on this computer counts as in progress: the app has no
// "finished" state for a review, and telling finished ones apart would need
// a `get_status` call per review, which home deliberately does not make.
const props = defineProps<{
  count: number;
}>();

const label = computed(() => (props.count === 1 ? 'review in progress' : 'reviews in progress'));
</script>

<template>
  <section
    class="mb-6 flex items-center gap-5 rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card px-6 py-6"
    data-testid="reviews-hero"
  >
    <span
      class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
      aria-hidden="true"
    >
      <FolderKanban class="h-7 w-7" />
    </span>
    <div class="min-w-0">
      <p class="flex items-baseline gap-2">
        <span class="text-4xl font-bold tabular-nums leading-none" data-testid="reviews-hero-count">{{ count }}</span>
        <span class="text-lg font-medium">{{ label }}</span>
      </p>
      <p class="mt-1.5 text-sm text-muted-foreground">
        Pick up where you left off, or start a new literature review.
      </p>
    </div>
  </section>
</template>
