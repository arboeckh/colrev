<script setup lang="ts">
import { Check, X, Loader2, ArrowRight } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

type DecisionState = 'undecided' | 'included' | 'excluded';

withDefaults(
  defineProps<{
    decision: DecisionState;
    disabled?: boolean;
    isSubmitting?: boolean;
    showKeyboardHints?: boolean;
    showSkipToNext?: boolean;
    testIdPrefix?: string;
  }>(),
  {
    disabled: false,
    isSubmitting: false,
    showKeyboardHints: true,
    showSkipToNext: false,
    testIdPrefix: 'prescreen',
  },
);

const emit = defineEmits<{
  (e: 'decide', decision: 'include' | 'exclude'): void;
  (e: 'skip-to-next'): void;
}>();
</script>

<template>
  <div
    class="flex items-center justify-center gap-4 h-[56px] shrink-0"
    :data-testid="`${testIdPrefix}-decision-bar`"
  >
    <template v-if="decision === 'undecided'">
      <Button
        variant="outline"
        size="lg"
        class="min-w-[150px] h-11 text-base border-l-[3px] border-l-destructive hover:bg-destructive/5 hover:border-l-destructive"
        :data-testid="`${testIdPrefix}-btn-exclude`"
        :disabled="disabled || isSubmitting"
        @click="emit('decide', 'exclude')"
      >
        <Loader2 v-if="isSubmitting" class="h-5 w-5 animate-spin" />
        <X v-else class="h-5 w-5 text-destructive" />
        <span>Exclude</span>
        <span
          v-if="showKeyboardHints"
          class="ml-1 text-[11px] text-muted-foreground font-normal"
        >&larr;</span>
      </Button>

      <Button
        variant="outline"
        size="lg"
        class="min-w-[150px] h-11 text-base border-l-[3px] border-l-green-600 hover:bg-green-600/5 hover:border-l-green-600"
        :data-testid="`${testIdPrefix}-btn-include`"
        :disabled="disabled || isSubmitting"
        @click="emit('decide', 'include')"
      >
        <Loader2 v-if="isSubmitting" class="h-5 w-5 animate-spin" />
        <Check v-else class="h-5 w-5 text-green-600" />
        <span>Include</span>
        <span
          v-if="showKeyboardHints"
          class="ml-1 text-[11px] text-muted-foreground font-normal"
        >&rarr;</span>
      </Button>
    </template>

    <template v-else>
      <div
        class="flex items-center gap-2 px-4 py-2 rounded-md border"
        :class="
          decision === 'included'
            ? 'bg-green-600/10 text-green-600 border-green-600/30 dark:text-green-500'
            : 'bg-destructive/10 text-destructive border-destructive/30'
        "
        :data-testid="`${testIdPrefix}-decision-indicator`"
      >
        <Check v-if="decision === 'included'" class="h-4 w-4" />
        <X v-else class="h-4 w-4" />
        <span class="font-medium text-sm">
          {{ decision === 'included' ? 'Included' : 'Excluded' }}
        </span>
      </div>

      <Button
        v-if="showSkipToNext"
        variant="outline"
        size="lg"
        :data-testid="`${testIdPrefix}-btn-skip-to-undecided`"
        @click="emit('skip-to-next')"
      >
        <ArrowRight class="h-4 w-4" />
        Next undecided
      </Button>
    </template>
  </div>
</template>
