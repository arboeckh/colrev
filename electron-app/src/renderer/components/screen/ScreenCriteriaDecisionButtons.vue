<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, Check, Loader2, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  canExcludeDecision,
  canIncludeDecision,
  type CriterionDecision,
} from '@/lib/screen-decision';
import type { ScreenCriterionInfo } from '@/types/generated/rpc';

const props = withDefaults(
  defineProps<{
    criteria: Record<string, ScreenCriterionInfo>;
    decisions: Record<string, CriterionDecision>;
    confirmedDecision?: 'include' | 'exclude' | null;
    isSubmitting?: boolean;
    disabled?: boolean;
    showNextButton?: boolean;
    testIdPrefix?: string;
  }>(),
  {
    confirmedDecision: null,
    isSubmitting: false,
    disabled: false,
    showNextButton: false,
    testIdPrefix: 'screen',
  },
);

const emit = defineEmits<{
  confirm: [decision: 'include' | 'exclude'];
  skipToNext: [];
}>();

const canInclude = computed(() => canIncludeDecision(props.criteria, props.decisions));
const canExclude = computed(() => canExcludeDecision(props.criteria, props.decisions));
const isConfirmed = computed(
  () =>
    props.confirmedDecision === 'include' || props.confirmedDecision === 'exclude',
);
</script>

<template>
  <div
    class="border-t border-border px-3 py-3 shrink-0 space-y-2"
    :data-testid="`${testIdPrefix}-decision-bar`"
  >
    <div
      v-if="isConfirmed"
      class="flex items-center justify-center gap-2"
    >
      <div
        class="flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium flex-1"
        :class="
          confirmedDecision === 'include'
            ? 'border-green-600/30 bg-green-600/15 text-green-700 dark:text-green-500'
            : 'border-destructive/30 bg-destructive/15 text-destructive'
        "
        :data-testid="`${testIdPrefix}-confirmed-indicator`"
      >
        <Check v-if="confirmedDecision === 'include'" class="h-4 w-4" />
        <X v-else class="h-4 w-4" />
        {{ confirmedDecision === 'include' ? 'Included' : 'Excluded' }}
      </div>

      <Button
        v-if="showNextButton"
        variant="outline"
        size="sm"
        :data-testid="`${testIdPrefix}-btn-skip-to-undecided`"
        @click="emit('skipToNext')"
      >
        <ArrowRight class="h-4 w-4 mr-1" />
        Next
      </Button>
    </div>

    <div
      v-else
      class="flex items-center justify-center gap-3"
    >
      <Button
        variant="outline"
        size="lg"
        class="flex-1 h-11 text-base border-l-[3px] border-l-destructive hover:bg-destructive/5 hover:border-l-destructive"
        :data-testid="`${testIdPrefix}-btn-exclude`"
        :disabled="disabled || isSubmitting || !canExclude"
        @click="emit('confirm', 'exclude')"
      >
        <Loader2 v-if="isSubmitting" class="h-5 w-5 animate-spin" />
        <X v-else class="h-5 w-5 text-destructive" />
        <span>Exclude</span>
      </Button>

      <Button
        variant="outline"
        size="lg"
        class="flex-1 h-11 text-base border-l-[3px] border-l-green-600 hover:bg-green-600/5 hover:border-l-green-600"
        :data-testid="`${testIdPrefix}-btn-include`"
        :disabled="disabled || isSubmitting || !canInclude"
        @click="emit('confirm', 'include')"
      >
        <Loader2 v-if="isSubmitting" class="h-5 w-5 animate-spin" />
        <Check v-else class="h-5 w-5 text-green-600" />
        <span>Include</span>
      </Button>
    </div>
  </div>
</template>
