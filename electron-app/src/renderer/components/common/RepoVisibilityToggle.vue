<script setup lang="ts">
import { Globe, Lock } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  testId?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function triggerClass(selected: boolean) {
  return cn(
    'inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
    selected
      ? 'bg-background text-foreground shadow-sm'
      : 'text-muted-foreground hover:text-foreground',
  );
}
</script>

<template>
  <div
    role="radiogroup"
    aria-label="Repository visibility"
    class="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
    :data-testid="testId"
  >
    <button
      type="button"
      role="radio"
      :aria-checked="modelValue"
      :disabled="disabled"
      :class="triggerClass(modelValue)"
      data-testid="repo-visibility-private"
      @click="emit('update:modelValue', true)"
    >
      <Lock class="h-3.5 w-3.5" />
      Private
    </button>
    <button
      type="button"
      role="radio"
      :aria-checked="!modelValue"
      :disabled="disabled"
      :class="triggerClass(!modelValue)"
      data-testid="repo-visibility-public"
      @click="emit('update:modelValue', false)"
    >
      <Globe class="h-3.5 w-3.5" />
      Public
    </button>
  </div>
</template>
