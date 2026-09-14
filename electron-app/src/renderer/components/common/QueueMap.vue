<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

export type QueueDecision = 'undecided' | 'included' | 'excluded';

export interface QueueMapItem {
  id: string;
  decision: QueueDecision;
}

/**
 * How the map lays records out, picked from queue length against track width:
 * - `discrete`: few records. Each is a fixed-size tile, left-aligned, so a
 *   queue of one doesn't stretch a single bar across the whole track.
 * - `fill`: one bar per record, stretched to fill the track.
 * - `binned`: too many records for a readable bar each, so several share one.
 */
export type QueueMapMode = 'discrete' | 'fill' | 'binned';

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
const BINNED_GAP_PX = 1;
// A record never gets a bar wider than this; below it the tiles stop filling
// the track and sit left-aligned instead.
const MAX_BAR_PX = 20;
const DISCRETE_GAP_PX = 4;
// In fill mode, bars at least this wide get a wider gap so they read as
// separate records rather than a striped block.
const WIDE_FILL_BAR_PX = 12;

const trackRef = ref<HTMLElement | null>(null);
const barsRef = ref<HTMLElement | null>(null);
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

function rowWidth(count: number, bar: number, gap: number) {
  return count * bar + Math.max(0, count - 1) * gap;
}

const mode = computed<QueueMapMode>(() => {
  const n = props.items.length;
  const width = trackWidth.value;
  // Before the first measurement, fall back to one bar per record so a short
  // queue paints something sensible on the very first frame.
  if (width <= 0) return 'fill';
  if (rowWidth(n, MAX_BAR_PX, DISCRETE_GAP_PX) <= width) return 'discrete';
  if (rowWidth(n, MIN_BAR_PX, BINNED_GAP_PX) <= width) return 'fill';
  return 'binned';
});

const gapPx = computed(() => {
  if (mode.value === 'discrete') return DISCRETE_GAP_PX;
  if (mode.value === 'fill' && rowWidth(props.items.length, WIDE_FILL_BAR_PX, 2) <= trackWidth.value) {
    return 2;
  }
  return BINNED_GAP_PX;
});

const binCount = computed(() => {
  const n = props.items.length;
  if (n === 0) return 0;
  if (mode.value !== 'binned') return n;
  const maxBars = Math.max(
    1,
    Math.floor((trackWidth.value + BINNED_GAP_PX) / (MIN_BAR_PX + BINNED_GAP_PX)),
  );
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

const barsStyle = computed(() => {
  const style: Record<string, string> = { gap: `${gapPx.value}px` };
  if (mode.value === 'discrete') {
    style.width = `${rowWidth(binCount.value, MAX_BAR_PX, DISCRETE_GAP_PX)}px`;
  }
  return style;
});

const windowStyle = computed(() => {
  const count = binCount.value;
  if (count === 0) return { left: '0px', width: '0px' };
  // Bars are equal flex items separated by a fixed gap, so bar i starts at
  // i * (row + gap) / count and is (row + gap) / count - gap wide. The window
  // overhangs its bar by 2px either side so its border frames the bar rather
  // than covering it.
  const gap = gapPx.value;
  const i = currentBinIndex.value;
  return {
    left: `calc((100% + ${gap}px) * ${i / count} - 2px)`,
    width: `calc((100% + ${gap}px) / ${count} - ${gap}px + 4px)`,
  };
});

function binFill(bin: Bin, part: 'included' | 'excluded' | 'undecided') {
  const total = bin.end - bin.start;
  if (total <= 0) return '0%';
  return `${(bin[part] / total) * 100}%`;
}

function binTitle(bin: Bin) {
  if (bin.end - bin.start === 1) {
    return `Record ${bin.start + 1} · ${props.items[bin.start].decision}`;
  }
  return `Records ${bin.start + 1}–${bin.end}`;
}

function indexFromPointerX(clientX: number): number {
  // Map against the bar row, not the whole track: in discrete mode the row is
  // narrower than the track, and anything past its end means the last record.
  const el = barsRef.value ?? trackRef.value;
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
      :data-mode="mode"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @lostpointercapture="onPointerUp"
    >
      <div v-if="mode === 'binned'" class="absolute inset-0 rounded-sm bg-muted/60" />

      <div
        ref="barsRef"
        class="absolute inset-y-0 left-0 flex items-end"
        :class="mode === 'discrete' ? '' : 'right-0'"
        :style="barsStyle"
      >
        <div
          v-for="(bin, index) in bins"
          :key="bin.start"
          class="flex-1 min-w-0 h-full flex flex-col justify-end"
          :class="{
            'rounded-[3px] overflow-hidden': mode === 'discrete',
            'rounded-[2px] overflow-hidden': mode === 'fill',
          }"
          :title="mode === 'binned' ? undefined : binTitle(bin)"
          :data-testid="`${testIdPrefix}-queue-map-bin-${index}`"
        >
          <div
            class="w-full"
            :class="mode === 'binned' ? 'bg-muted-foreground/20' : 'bg-muted-foreground/25'"
            :style="{ height: binFill(bin, 'undecided') }"
          />
          <div class="w-full bg-destructive" :style="{ height: binFill(bin, 'excluded') }" />
          <div class="w-full bg-green-600" :style="{ height: binFill(bin, 'included') }" />
        </div>

        <div
          v-if="bins.length > 0"
          class="absolute -inset-y-0.5 rounded-[4px] border-2 border-foreground/70 bg-foreground/5 pointer-events-none"
          :class="isDragging ? '' : 'transition-[left] duration-150'"
          :style="windowStyle"
          :data-bar-index="currentBinIndex"
          :data-bar-count="binCount"
          :data-testid="`${testIdPrefix}-queue-map-window`"
        />
      </div>
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
