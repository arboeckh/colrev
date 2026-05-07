<script setup lang="ts">
import { ref } from 'vue';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-vue-next';
import type { ReconciliationPreviewItem } from '@/types/api';

defineProps<{
  items: ReconciliationPreviewItem[];
}>();

const expanded = ref(false);
</script>

<template>
  <div
    class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
    data-testid="reconcile-blocked-banner"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 text-left"
      @click="expanded = !expanded"
    >
      <AlertTriangle class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <div class="flex-1 text-sm">
        <span class="font-medium">
          {{ items.length }} record{{ items.length === 1 ? '' : 's' }} will be overridden
        </span>
        <span class="text-muted-foreground">
          — non-decision metadata changed since the task launched. Reviewer
          decisions will still be applied; latest metadata is kept. Recorded in
          the audit trail.
        </span>
      </div>
      <component
        :is="expanded ? ChevronUp : ChevronDown"
        class="h-4 w-4 text-muted-foreground shrink-0"
      />
    </button>
    <ul
      v-if="expanded"
      class="mt-2 space-y-1 overflow-y-auto pr-1"
      style="max-height: 30vh"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="text-xs"
      >
        <div class="font-medium">{{ item.title || item.id }}</div>
        <ul class="ml-2 space-y-0.5">
          <li
            v-for="reason in item.blocked_reasons"
            :key="reason"
            class="text-amber-700 dark:text-amber-300"
          >
            {{ reason }}
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
