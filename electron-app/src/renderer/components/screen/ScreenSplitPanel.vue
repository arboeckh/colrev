<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  defaultSplit?: number; // percent for left panel, default 60
}>();

const splitPercent = ref(props.defaultSplit ?? 60);
const isDragging = ref(false);
const containerRef = ref<HTMLElement | null>(null);

function onDividerPointerDown(e: PointerEvent) {
  isDragging.value = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onDividerPointerMove(e: PointerEvent) {
  if (!isDragging.value || !containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const pct = Math.max(30, Math.min(80, (x / rect.width) * 100));
  splitPercent.value = pct;
}

function onDividerPointerUp() {
  isDragging.value = false;
}
</script>

<template>
  <div
    ref="containerRef"
    class="flex h-full gap-0 select-none"
    data-testid="screen-split-panel"
  >
    <!-- Left panel -->
    <div
      class="min-w-0 overflow-hidden"
      :style="{ flexBasis: splitPercent + '%', flexShrink: 0 }"
    >
      <slot name="left" />
    </div>

    <!-- Divider -->
    <div
      class="w-1.5 shrink-0 cursor-col-resize relative group"
      :class="isDragging ? 'bg-primary/30' : 'hover:bg-primary/20'"
      data-testid="screen-split-divider"
      @pointerdown="onDividerPointerDown"
      @pointermove="onDividerPointerMove"
      @pointerup="onDividerPointerUp"
      @lostpointercapture="onDividerPointerUp"
    >
      <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-border group-hover:bg-primary/50 transition-colors" />
    </div>

    <!-- Right panel -->
    <div class="flex-1 min-w-0 overflow-hidden">
      <slot name="right" />
    </div>
  </div>
</template>
