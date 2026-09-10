<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Search } from 'lucide-vue-next';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface QueueJumpItem {
  id: string;
  title?: string;
  author?: string;
  year?: string | number;
  decision: 'undecided' | 'included' | 'excluded';
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    items: QueueJumpItem[];
    currentIndex: number;
    testIdPrefix?: string;
  }>(),
  {
    testIdPrefix: 'prescreen',
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'jump', index: number): void;
}>();

const MAX_RESULTS = 50;

const query = ref('');
const highlighted = ref(0);
const inputRef = ref<InstanceType<typeof Input> | null>(null);
const listRef = ref<HTMLElement | null>(null);

interface Result {
  index: number;
  item: QueueJumpItem;
}

const results = computed<Result[]>(() => {
  const q = query.value.trim().toLowerCase();
  const matches: Result[] = [];
  for (let index = 0; index < props.items.length; index++) {
    const item = props.items[index];
    if (q) {
      const haystack = `${item.title ?? ''} ${item.author ?? ''} ${item.year ?? ''} ${item.id}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    matches.push({ index, item });
    if (matches.length >= MAX_RESULTS) break;
  }
  return matches;
});

const hiddenCount = computed(() => {
  const q = query.value.trim();
  if (!q) return Math.max(0, props.items.length - results.value.length);
  // With a query the loop stops at MAX_RESULTS, so the true remainder is
  // unknown — report it as "more" rather than a wrong number.
  return results.value.length >= MAX_RESULTS ? -1 : 0;
});

// Opening on the current record is the common case ("where am I?"), so the
// list starts there rather than at the top of the queue.
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    query.value = '';
    await nextTick();
    const position = results.value.findIndex((r) => r.index === props.currentIndex);
    highlighted.value = position === -1 ? 0 : position;
    inputRef.value?.$el?.focus?.();
    scrollHighlightedIntoView();
  },
);

watch(query, () => {
  highlighted.value = 0;
});

function scrollHighlightedIntoView() {
  nextTick(() => {
    const el = listRef.value?.querySelector<HTMLElement>('[data-highlighted="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  });
}

function move(delta: number) {
  const count = results.value.length;
  if (count === 0) return;
  highlighted.value = (highlighted.value + delta + count) % count;
  scrollHighlightedIntoView();
}

function choose(position: number) {
  const result = results.value[position];
  if (!result) return;
  emit('jump', result.index);
  emit('update:open', false);
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      move(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      move(-1);
      break;
    case 'Enter':
      e.preventDefault();
      choose(highlighted.value);
      break;
  }
}

function onOpenChange(value: boolean) {
  emit('update:open', value);
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      class="sm:max-w-[560px] p-0 gap-0"
      :data-testid="`${testIdPrefix}-jump-dialog`"
      @keydown="onKeydown"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>Jump to record</DialogTitle>
        <DialogDescription>
          Search the loaded queue by title, author, year or record ID.
        </DialogDescription>
      </DialogHeader>

      <div class="flex items-center gap-2 border-b px-3">
        <Search class="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          ref="inputRef"
          v-model="query"
          placeholder="Jump to a record by title, author, year or ID..."
          class="h-11 border-0 shadow-none focus-visible:ring-0 px-0"
          :data-testid="`${testIdPrefix}-jump-input`"
        />
      </div>

      <div
        v-if="results.length === 0"
        class="px-4 py-8 text-center text-sm text-muted-foreground"
        :data-testid="`${testIdPrefix}-jump-empty`"
      >
        No loaded record matches &ldquo;{{ query }}&rdquo;.
      </div>

      <div v-else ref="listRef" class="max-h-[320px] overflow-y-auto py-1">
        <button
          v-for="(result, position) in results"
          :key="result.item.id"
          type="button"
          class="w-full text-left px-3 py-2 flex items-start gap-3 transition-colors"
          :class="position === highlighted ? 'bg-accent' : 'hover:bg-muted/60'"
          :data-highlighted="position === highlighted ? 'true' : 'false'"
          :data-testid="`${testIdPrefix}-jump-result-${result.index}`"
          @click="choose(position)"
          @mousemove="highlighted = position"
        >
          <span
            class="mt-0.5 h-2 w-2 rounded-full shrink-0"
            :class="
              result.item.decision === 'included'
                ? 'bg-green-600'
                : result.item.decision === 'excluded'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground/30'
            "
          />
          <span class="min-w-0 flex-1">
            <span class="block text-sm leading-tight truncate">
              {{ result.item.title || result.item.id }}
            </span>
            <span class="block text-xs text-muted-foreground truncate mt-0.5">
              {{ [result.item.author, result.item.year].filter(Boolean).join(' · ') || result.item.id }}
            </span>
          </span>
          <span class="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">
            #{{ result.index + 1 }}
          </span>
        </button>
      </div>

      <div class="border-t px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>&uarr; &darr; to move &middot; &crarr; to jump &middot; esc to close</span>
        <span v-if="hiddenCount === -1">More records match — keep typing</span>
        <span v-else-if="hiddenCount > 0">Searches the {{ items.length }} loaded records</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
