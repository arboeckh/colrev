<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

export interface QueueFilmstripItem {
  id: string;
  title?: string;
  year?: string | number;
  decision: 'undecided' | 'included' | 'excluded';
}

const props = withDefaults(
  defineProps<{
    items: QueueFilmstripItem[];
    currentIndex: number;
    /** How many records ahead to show, the current one included. */
    lookahead?: number;
    /** How far the skip button jumps forward. */
    skipBy?: number;
    testIdPrefix?: string;
  }>(),
  {
    lookahead: 8,
    skipBy: 25,
    testIdPrefix: 'prescreen',
  },
);

const emit = defineEmits<{
  (e: 'seek', index: number): void;
}>();

const collapsed = ref(false);

const visible = computed(() => {
  const start = Math.max(0, props.currentIndex);
  return props.items
    .slice(start, start + props.lookahead)
    .map((item, offset) => ({ item, index: start + offset }));
});

const canSkip = computed(() => props.currentIndex + props.skipBy < props.items.length);

function skipAhead() {
  emit('seek', Math.min(props.currentIndex + props.skipBy, props.items.length - 1));
}
</script>

<template>
  <div v-if="items.length > 0" class="shrink-0" :data-testid="`${testIdPrefix}-filmstrip`">
    <div class="flex items-center gap-3 mb-2">
      <span class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Up next
      </span>
      <div class="flex-1 h-px bg-border" />
      <Button
        v-if="canSkip && !collapsed"
        variant="outline"
        size="sm"
        class="h-6 px-2 text-xs"
        :data-testid="`${testIdPrefix}-filmstrip-skip`"
        @click="skipAhead"
      >
        Skip {{ skipBy }}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 px-2 text-xs"
        :data-testid="`${testIdPrefix}-filmstrip-toggle`"
        @click="collapsed = !collapsed"
      >
        <component :is="collapsed ? ChevronUp : ChevronDown" class="h-3.5 w-3.5" />
        {{ collapsed ? 'Show' : 'Hide' }}
      </Button>
    </div>

    <div v-if="!collapsed" class="flex gap-2 overflow-hidden">
      <button
        v-for="entry in visible"
        :key="entry.item.id"
        type="button"
        class="w-[132px] h-[84px] shrink-0 rounded-md border bg-card p-2 flex flex-col gap-1 text-left overflow-hidden transition-colors"
        :class="
          entry.index === currentIndex
            ? 'border-green-600 bg-green-600/5'
            : 'hover:bg-muted/60'
        "
        :data-testid="`${testIdPrefix}-filmstrip-card-${entry.index}`"
        @click="emit('seek', entry.index)"
      >
        <span class="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums">
          <span
            class="h-1.5 w-1.5 rounded-full shrink-0"
            :class="
              entry.item.decision === 'included'
                ? 'bg-green-600'
                : entry.item.decision === 'excluded'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground/30'
            "
          />
          <span class="truncate">{{ entry.item.year || '—' }} &middot; #{{ entry.index + 1 }}</span>
        </span>
        <span
          class="text-[11px] leading-[1.34] overflow-hidden"
          :class="entry.index === currentIndex ? 'font-medium' : 'text-muted-foreground'"
          style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow-wrap: anywhere;"
        >
          {{ entry.item.title || entry.item.id }}
        </span>
      </button>
    </div>
  </div>
</template>
