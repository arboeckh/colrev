<script setup lang="ts">
import { ref, computed } from 'vue';

type DecisionState = 'undecided' | 'included' | 'excluded';

const props = defineProps<{
  records: Array<{ id: string; _decision: DecisionState }>;
  currentIndex: number;
}>();

const emit = defineEmits<{
  navigate: [index: number];
}>();

const trackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

const SEGMENT_MAX_PX = 28;

const thumbPercent = computed(() => {
  const n = props.records.length;
  if (n <= 1) return 50;
  return ((props.currentIndex + 0.5) / n) * 100;
});

const trackWidthStyle = computed(() => {
  const n = props.records.length;
  if (n === 0) return '0px';
  const maxPx = n * SEGMENT_MAX_PX + (n - 1);
  return `min(100%, ${maxPx}px)`;
});

const decidedCount = computed(
  () => props.records.filter((r) => r._decision !== 'undecided').length,
);

function indexFromPointerX(clientX: number): number {
  if (!trackRef.value || props.records.length === 0) return 0;
  const rect = trackRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const ratio = x / rect.width;
  return Math.min(Math.floor(ratio * props.records.length), props.records.length - 1);
}

function onTrackPointerDown(e: PointerEvent) {
  emit('navigate', indexFromPointerX(e.clientX));
}

function onThumbPointerDown(e: PointerEvent) {
  e.stopPropagation();
  isDragging.value = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onThumbPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  emit('navigate', indexFromPointerX(e.clientX));
}

function onThumbPointerUp() {
  isDragging.value = false;
}
</script>

<template>
  <div class="h-[32px] shrink-0" data-testid="screen-progress-bar">
    <div
      ref="trackRef"
      class="relative h-5 select-none touch-none cursor-pointer"
      :style="{ width: trackWidthStyle }"
      @pointerdown="onTrackPointerDown"
    >
      <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-muted" />

      <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 flex rounded-full overflow-hidden">
        <div
          v-for="(record, index) in records"
          :key="record.id"
          class="flex-1 min-w-0 border-r border-background/60 last:border-r-0"
          :class="[
            record._decision === 'included'
              ? 'bg-green-600'
              : record._decision === 'excluded'
                ? 'bg-destructive'
                : 'bg-muted-foreground/25',
          ]"
          :data-testid="`screen-progress-cell-${index}`"
        />
      </div>

      <div
        class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-[14px] h-[14px] rounded-full bg-foreground border-2 border-background shadow-md"
        :class="isDragging ? 'cursor-grabbing scale-110' : 'cursor-grab transition-[left] duration-150'"
        :style="{ left: thumbPercent + '%' }"
        data-testid="screen-progress-thumb"
        @pointerdown="onThumbPointerDown"
        @pointermove="onThumbPointerMove"
        @pointerup="onThumbPointerUp"
        @lostpointercapture="onThumbPointerUp"
      />
    </div>

    <div class="flex items-center justify-between mt-0.5 text-xs text-muted-foreground">
      <span data-testid="screen-record-counter">
        Record {{ currentIndex + 1 }} of {{ records.length }}
      </span>
      <span data-testid="screen-progress-text">
        {{ decidedCount }} decided / {{ records.length }} loaded
      </span>
    </div>
  </div>
</template>
