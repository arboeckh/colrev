<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

export interface DisplayRecord {
  id: string;
  title?: string;
  author?: string;
  year?: string | number;
  journal?: string;
  booktitle?: string;
  abstract?: string;
  _enrichmentStatus?: 'pending' | 'loading' | 'complete' | 'failed';
}

const props = withDefaults(
  defineProps<{
    record: DisplayRecord;
    canPrev?: boolean;
    canNext?: boolean;
    testIdPrefix?: string;
    layout?: 'stacked' | 'side-by-side';
  }>(),
  {
    canPrev: false,
    canNext: false,
    testIdPrefix: 'prescreen',
    layout: 'stacked',
  },
);

const emit = defineEmits<{
  (e: 'prev'): void;
  (e: 'next'): void;
}>();

const scrollEl = ref<HTMLElement | null>(null);
const showFade = ref(false);

function updateFade() {
  const el = scrollEl.value;
  if (!el) {
    showFade.value = false;
    return;
  }
  const overflowing = el.scrollHeight - el.clientHeight > 2;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  showFade.value = overflowing && !atBottom;
}

let ro: ResizeObserver | null = null;

watch(
  () => props.record?.id,
  async () => {
    await nextTick();
    if (scrollEl.value) scrollEl.value.scrollTop = 0;
    updateFade();
  },
);

watch(
  () => props.record?.abstract,
  async () => {
    await nextTick();
    updateFade();
  },
);

onMounted(() => {
  updateFade();
  if (scrollEl.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => updateFade());
    ro.observe(scrollEl.value);
  }
});

onUnmounted(() => {
  ro?.disconnect();
  ro = null;
});

const metaParts = computed(() => {
  const r = props.record;
  const parts: string[] = [];
  const authorYear = r.author
    ? r.year
      ? `${r.author} (${r.year})`
      : r.author
    : r.year
      ? String(r.year)
      : '';
  if (authorYear) parts.push(authorYear);
  const venue = r.journal || r.booktitle;
  if (venue) parts.push(venue);
  return parts;
});
</script>

<template>
  <article
    class="flex-1 flex flex-col min-h-0 rounded-lg w-full mx-auto"
    :class="layout === 'side-by-side' ? 'max-w-5xl' : 'max-w-[65ch]'"
    :data-testid="`${testIdPrefix}-record-card`"
  >
    <!-- Top row: ID · meta · nav -->
    <div class="flex items-center gap-3 px-1 pb-2">
      <span
        class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70 shrink-0"
        :data-testid="`${testIdPrefix}-record-id`"
      >
        {{ record.id }}
      </span>
      <div
        v-if="layout === 'stacked' && metaParts.length"
        class="flex-1 min-w-0 text-xs text-muted-foreground truncate"
      >
        <template v-for="(part, i) in metaParts" :key="i">
          <span v-if="i > 0" class="mx-2 text-muted-foreground/40">·</span>
          <span>{{ part }}</span>
        </template>
      </div>
      <div v-else class="flex-1" />
      <div class="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          class="h-7 w-7"
          :disabled="!canPrev"
          :data-testid="`${testIdPrefix}-btn-previous`"
          @click="emit('prev')"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="h-7 w-7"
          :disabled="!canNext"
          :data-testid="`${testIdPrefix}-btn-next`"
          @click="emit('next')"
        >
          <ChevronRight class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <!-- Stacked layout: title above, abstract below -->
    <template v-if="layout === 'stacked'">
      <h3
        class="px-1 text-[17px] font-semibold leading-snug tracking-tight break-words line-clamp-3"
        :title="record.title || 'Untitled record'"
        :data-testid="`${testIdPrefix}-record-title`"
      >
        {{ record.title || 'Untitled record' }}
      </h3>

      <div class="mx-1 mt-3 mb-4 h-px bg-border/50" />

      <div class="relative flex-1 min-h-0">
        <div
          ref="scrollEl"
          class="absolute inset-0 overflow-y-auto pr-3 pl-1 custom-scroll"
          @scroll="updateFade"
        >
          <div
            v-if="record._enrichmentStatus === 'loading'"
            class="space-y-2"
          >
            <div class="flex items-center gap-2 text-[13px] text-muted-foreground mb-3">
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
              <span>Fetching abstract from external sources...</span>
            </div>
            <div class="space-y-2 animate-pulse">
              <div class="h-3 bg-muted/70 rounded w-full" />
              <div class="h-3 bg-muted/70 rounded w-full" />
              <div class="h-3 bg-muted/70 rounded w-[95%]" />
              <div class="h-3 bg-muted/70 rounded w-full" />
              <div class="h-3 bg-muted/70 rounded w-[88%]" />
              <div class="h-3 bg-muted/70 rounded w-full" />
              <div class="h-3 bg-muted/70 rounded w-[70%]" />
            </div>
          </div>
          <p
            v-else
            class="text-[16px] leading-[1.7] text-foreground whitespace-pre-wrap break-words"
          >
            {{ record.abstract || 'No abstract available' }}
          </p>
        </div>
        <div
          v-show="showFade"
          class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
        />
      </div>
    </template>

    <!-- Side-by-side layout: title left, abstract right -->
    <template v-else>
      <div class="flex-1 min-h-0 flex gap-5 pt-1">
        <div class="w-[36%] min-w-[240px] shrink-0 flex flex-col min-h-0 pl-1 pr-1">
          <div class="flex-1 min-h-0 overflow-y-auto custom-scroll">
            <h3
              class="text-[17px] font-semibold leading-snug tracking-tight break-words"
              :title="record.title || 'Untitled record'"
              :data-testid="`${testIdPrefix}-record-title`"
            >
              {{ record.title || 'Untitled record' }}
            </h3>
            <div
              v-if="metaParts.length"
              class="mt-2 text-sm text-muted-foreground leading-snug break-words"
            >
              <template v-for="(part, i) in metaParts" :key="i">
                <span v-if="i > 0" class="mx-1.5 text-muted-foreground/40">·</span>
                <span>{{ part }}</span>
              </template>
            </div>
          </div>
          <div v-if="$slots.aside" class="shrink-0 pt-4">
            <slot name="aside" />
          </div>
        </div>

        <div class="w-px bg-border/50 shrink-0" />

        <div class="relative flex-1 min-w-0">
          <div
            ref="scrollEl"
            class="absolute inset-0 overflow-y-auto pr-3 pl-1 custom-scroll"
            @scroll="updateFade"
          >
            <div
              v-if="record._enrichmentStatus === 'loading'"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-[13px] text-muted-foreground mb-3">
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
                <span>Fetching abstract from external sources...</span>
              </div>
              <div class="space-y-2 animate-pulse">
                <div class="h-3 bg-muted/70 rounded w-full" />
                <div class="h-3 bg-muted/70 rounded w-full" />
                <div class="h-3 bg-muted/70 rounded w-[95%]" />
                <div class="h-3 bg-muted/70 rounded w-full" />
                <div class="h-3 bg-muted/70 rounded w-[88%]" />
                <div class="h-3 bg-muted/70 rounded w-full" />
                <div class="h-3 bg-muted/70 rounded w-[70%]" />
              </div>
            </div>
            <p
              v-else
              class="text-[16px] leading-[1.7] text-foreground whitespace-pre-wrap break-words"
            >
              {{ record.abstract || 'No abstract available' }}
            </p>
          </div>
          <div
            v-show="showFade"
            class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
          />
        </div>
      </div>
    </template>
  </article>
</template>

<style scoped>
.custom-scroll {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklch, var(--muted-foreground) 30%, transparent) transparent;
}
.custom-scroll::-webkit-scrollbar {
  width: 8px;
}
.custom-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scroll::-webkit-scrollbar-thumb {
  background-color: color-mix(in oklch, var(--muted-foreground) 25%, transparent);
  border-radius: 9999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.custom-scroll::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in oklch, var(--muted-foreground) 45%, transparent);
  background-clip: padding-box;
}
</style>
