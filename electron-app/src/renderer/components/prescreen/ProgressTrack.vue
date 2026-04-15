<script setup lang="ts">
import { computed, ref } from 'vue';

export interface ProgressItem {
  id: string;
  decision: 'undecided' | 'included' | 'excluded';
}

const props = withDefaults(
  defineProps<{
    items: ProgressItem[];
    currentIndex: number;
    testIdPrefix?: string;
    showCounter?: boolean;
    decidedCount?: number;
    totalCount?: number;
  }>(),
  {
    testIdPrefix: 'prescreen',
    showCounter: true,
    decidedCount: 0,
    totalCount: 0,
  },
);

const emit = defineEmits<{
  (e: 'seek', index: number): void;
}>();

const trackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

const SEGMENT_MAX_PX = 28;

const trackWidthStyle = computed(() => {
  const n = props.items.length;
  if (n === 0) return '0px';
  const maxPx = n * SEGMENT_MAX_PX + (n - 1);
  return `min(100%, ${maxPx}px)`;
});

const thumbPercent = computed(() => {
  const n = props.items.length;
  if (n <= 1) return 50;
  return ((props.currentIndex + 0.5) / n) * 100;
});

function indexFromPointerX(clientX: number): number {
  if (!trackRef.value || props.items.length === 0) return 0;
  const rect = trackRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const ratio = x / rect.width;
  return Math.min(Math.floor(ratio * props.items.length), props.items.length - 1);
}

function seekTo(index: number) {
  if (index >= 0 && index < props.items.length) {
    emit('seek', index);
  }
}

function onTrackPointerDown(e: PointerEvent) {
  const index = indexFromPointerX(e.clientX);
  seekTo(index);
}

function onThumbPointerDown(e: PointerEvent) {
  e.stopPropagation();
  isDragging.value = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onThumbPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  const index = indexFromPointerX(e.clientX);
  seekTo(index);
}

function onThumbPointerUp() {
  isDragging.value = false;
}
</script>

<template>
  <div class="h-[48px] shrink-0" :data-testid="`${testIdPrefix}-progress-bar`">
    <div
      ref="trackRef"
      class="relative h-6 select-none touch-none cursor-pointer"
      :style="{ width: trackWidthStyle }"
      @pointerdown="onTrackPointerDown"
    >
      <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-muted" />

      <div
        class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 flex rounded-full overflow-hidden"
      >
        <div
          v-for="(item, index) in items"
          :key="item.id"
          class="flex-1 min-w-0 border-r border-background/60 last:border-r-0"
          :class="[
            item.decision === 'included'
              ? 'bg-green-600'
              : item.decision === 'excluded'
                ? 'bg-destructive'
                : 'bg-muted-foreground/25',
          ]"
          :data-testid="`${testIdPrefix}-progress-cell-${index}`"
        />
      </div>

      <div
        class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-[18px] h-[18px] rounded-full bg-foreground border-2 border-background shadow-md"
        :class="isDragging ? 'cursor-grabbing scale-110' : 'cursor-grab transition-[left] duration-150'"
        :style="{ left: thumbPercent + '%' }"
        :data-testid="`${testIdPrefix}-progress-thumb`"
        @pointerdown="onThumbPointerDown"
        @pointermove="onThumbPointerMove"
        @pointerup="onThumbPointerUp"
        @lostpointercapture="onThumbPointerUp"
      />
    </div>

    <div
      v-if="showCounter"
      class="flex items-center justify-between mt-1.5 text-xs text-muted-foreground"
    >
      <span :data-testid="`${testIdPrefix}-record-counter`">
        Record {{ currentIndex + 1 }} of {{ items.length }}
      </span>
      <span :data-testid="`${testIdPrefix}-progress-text`">
        {{ decidedCount }} decided / {{ totalCount }} total
      </span>
    </div>
  </div>
</template>
