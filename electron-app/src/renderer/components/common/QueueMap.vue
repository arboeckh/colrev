<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

export type QueueDecision = 'undecided' | 'included' | 'excluded';

export interface QueueMapItem {
  id: string;
  decision: QueueDecision;
}

interface Bin {
  start: number;
  end: number; // exclusive
  included: number;
  excluded: number;
  undecided: number;
}

const props = withDefaults(
  defineProps<{
    items: QueueMapItem[];
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

// A bar narrower than this reads as noise, so the map bins records together
// rather than shrinking further. This is the whole point of the component:
// the DOM node count is bounded by width, not by queue length.
const MIN_BAR_PX = 6;
const BAR_GAP_PX = 1;

const trackRef = ref<HTMLElement | null>(null);
const trackWidth = ref(0);
const isDragging = ref(false);

let ro: ResizeObserver | null = null;

onMounted(() => {
  const el = trackRef.value;
  if (!el) return;
  trackWidth.value = el.clientWidth;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      trackWidth.value = el.clientWidth;
    });
    ro.observe(el);
  }
});

onUnmounted(() => {
  ro?.disconnect();
  ro = null;
});

const binCount = computed(() => {
  const n = props.items.length;
  if (n === 0) return 0;
  // Before the first measurement, fall back to one bar per record so a short
  // queue paints correctly on the very first frame.
  const width = trackWidth.value;
  if (width <= 0) return n;
  const maxBars = Math.max(1, Math.floor((width + BAR_GAP_PX) / (MIN_BAR_PX + BAR_GAP_PX)));
  return Math.min(n, maxBars);
});

const bins = computed<Bin[]>(() => {
  const n = props.items.length;
  const count = binCount.value;
  if (n === 0 || count === 0) return [];

  const result: Bin[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * n) / count);
    const end = Math.floor(((i + 1) * n) / count);
    const bin: Bin = { start, end, included: 0, excluded: 0, undecided: 0 };
    for (let j = start; j < end; j++) {
      const decision = props.items[j].decision;
      if (decision === 'included') bin.included += 1;
      else if (decision === 'excluded') bin.excluded += 1;
      else bin.undecided += 1;
    }
    result.push(bin);
  }
  return result;
});

const recordsPerBar = computed(() => {
  const count = binCount.value;
  if (count === 0) return 0;
  return Math.round(props.items.length / count);
});

// The bin holding the current record, so the viewport window lands on it even
// when many records share a bar.
const currentBinIndex = computed(() => {
  const n = props.items.length;
  const count = binCount.value;
  if (n === 0 || count === 0) return 0;
  const index = Math.min(Math.max(props.currentIndex, 0), n - 1);
  return Math.min(Math.floor((index * count) / n), count - 1);
});

const windowStyle = computed(() => {
  const count = binCount.value;
  if (count === 0) return { left: '0%', width: '0%' };
  const share = 100 / count;
  return {
    left: `${currentBinIndex.value * share}%`,
    width: `${share}%`,
  };
});

function binFill(bin: Bin, part: 'included' | 'excluded' | 'undecided') {
  const total = bin.end - bin.start;
  if (total <= 0) return '0%';
  return `${(bin[part] / total) * 100}%`;
}

function indexFromPointerX(clientX: number): number {
  const el = trackRef.value;
  const n = props.items.length;
  if (!el || n === 0) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const ratio = x / rect.width;
  return Math.min(Math.floor(ratio * n), n - 1);
}

function seekToPointer(clientX: number) {
  const index = indexFromPointerX(clientX);
  if (index >= 0 && index < props.items.length) {
    emit('seek', index);
  }
}

function onPointerDown(e: PointerEvent) {
  if (props.items.length === 0) return;
  isDragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  seekToPointer(e.clientX);
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  seekToPointer(e.clientX);
}

function onPointerUp() {
  isDragging.value = false;
}
</script>

<template>
  <div class="h-[48px] shrink-0" :data-testid="`${testIdPrefix}-progress-bar`">
    <div
      ref="trackRef"
      class="relative h-6 select-none touch-none"
      :class="isDragging ? 'cursor-grabbing' : 'cursor-pointer'"
      :data-testid="`${testIdPrefix}-queue-map`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @lostpointercapture="onPointerUp"
    >
      <div class="absolute inset-0 rounded-sm bg-muted/60" />

      <div class="absolute inset-0 flex items-end" :style="{ gap: `${BAR_GAP_PX}px` }">
        <div
          v-for="(bin, index) in bins"
          :key="bin.start"
          class="flex-1 min-w-0 h-full flex flex-col justify-end"
          :data-testid="`${testIdPrefix}-queue-map-bin-${index}`"
        >
          <div class="w-full bg-muted-foreground/20" :style="{ height: binFill(bin, 'undecided') }" />
          <div class="w-full bg-destructive" :style="{ height: binFill(bin, 'excluded') }" />
          <div class="w-full bg-green-600" :style="{ height: binFill(bin, 'included') }" />
        </div>
      </div>

      <div
        v-if="bins.length > 0"
        class="absolute -inset-y-0.5 rounded-sm border-2 border-foreground/70 bg-foreground/5 pointer-events-none"
        :class="isDragging ? '' : 'transition-[left] duration-150'"
        :style="windowStyle"
        :data-testid="`${testIdPrefix}-queue-map-window`"
      />
    </div>

    <div
      v-if="showCounter"
      class="flex items-center justify-between mt-1.5 text-xs text-muted-foreground"
    >
      <span :data-testid="`${testIdPrefix}-record-counter`">
        Record {{ currentIndex + 1 }} of {{ items.length }}
      </span>
      <span class="flex items-center gap-2">
        <span
          v-if="recordsPerBar > 1"
          :data-testid="`${testIdPrefix}-queue-map-scale`"
        >
          1 bar &asymp; {{ recordsPerBar }} records
        </span>
        <span :data-testid="`${testIdPrefix}-progress-text`">
          {{ decidedCount }} decided / {{ totalCount }} total
        </span>
      </span>
    </div>
  </div>
</template>
