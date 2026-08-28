<script setup lang="ts">
import { computed } from 'vue';
import { Check, X } from 'lucide-vue-next';
import ScreenCriteriaChecklist from '@/components/screen/ScreenCriteriaChecklist.vue';
import ScreenCriteriaDecisionButtons from '@/components/screen/ScreenCriteriaDecisionButtons.vue';
import type { ReconciliationPreviewItem, ScreenCriterionInfo } from '@/types/generated/rpc';
import type { CriterionDecision } from '@/lib/screen-decision';
import { reviewerStatusToDecision } from './reconcile-utils';

const props = defineProps<{
  criteria: Record<string, ScreenCriterionInfo>;
  decisions: Record<string, CriterionDecision>;
  reviewers: ReconciliationPreviewItem['reviewers'];
  confirmedDecision: 'include' | 'exclude' | null;
}>();

const emit = defineEmits<{
  toggle: [name: string, value: CriterionDecision];
  confirm: [decision: 'include' | 'exclude'];
}>();

const reviewerDecisions = computed(() =>
  props.reviewers.map((reviewer) => ({
    role: reviewer.role,
    github_login: reviewer.github_login,
    decision: reviewerStatusToDecision(reviewer.status, 'screen'),
  })),
);
</script>

<template>
  <div class="h-full flex flex-col min-h-0" data-testid="screen-reconcile-criteria-panel">
    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div
        class="flex flex-wrap items-center gap-2"
        data-testid="reconcile-reviewer-decisions"
      >
        <div
          v-for="reviewer in reviewerDecisions"
          :key="reviewer.role"
          class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
          :class="
            reviewer.decision === 'include'
              ? 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400'
              : reviewer.decision === 'exclude'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-muted/50 text-muted-foreground'
          "
          :data-testid="`reconcile-reviewer-decision-${reviewer.role}`"
        >
          <span class="font-medium">@{{ reviewer.github_login }}</span>
          <span class="text-muted-foreground">·</span>
          <Check v-if="reviewer.decision === 'include'" class="h-3 w-3" />
          <X v-else-if="reviewer.decision === 'exclude'" class="h-3 w-3" />
          <span>
            {{
              reviewer.decision === 'include'
                ? 'Include'
                : reviewer.decision === 'exclude'
                  ? 'Exclude'
                  : 'Undecided'
            }}
          </span>
        </div>
      </div>

      <ScreenCriteriaChecklist
        :criteria="criteria"
        :decisions="decisions"
        :reviewers="reviewers"
        test-id-prefix="reconcile-criterion"
        @toggle="(name, value) => emit('toggle', name, value)"
      />
    </div>

    <ScreenCriteriaDecisionButtons
      :criteria="criteria"
      :decisions="decisions"
      :confirmed-decision="confirmedDecision"
      test-id-prefix="reconcile"
      class="px-1"
      @confirm="(decision) => emit('confirm', decision)"
    />
  </div>
</template>
