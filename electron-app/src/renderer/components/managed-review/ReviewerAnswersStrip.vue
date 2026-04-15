<script setup lang="ts">
import { Check, X, Circle } from 'lucide-vue-next';
import type { ReconciliationPreviewItem } from '@/types/api';
import { reviewerStatusToDecision, type ReconcileKind } from './reconcile-utils';

defineProps<{
  reviewers: ReconciliationPreviewItem['reviewers'];
  kind: ReconcileKind;
}>();

function decisionLabel(status: string, kind: ReconcileKind): 'Include' | 'Exclude' | 'Pending' {
  const d = reviewerStatusToDecision(status, kind);
  if (d === 'include') return 'Include';
  if (d === 'exclude') return 'Exclude';
  return 'Pending';
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3" data-testid="reviewer-answers-strip">
    <div
      v-for="reviewer in reviewers"
      :key="reviewer.role"
      class="rounded-md border border-border bg-card px-4 py-3"
      :data-testid="`reviewer-answer-${reviewer.role}`"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground uppercase tracking-wide font-medium">
            {{ reviewer.role === 'reviewer_a' ? 'Reviewer A' : 'Reviewer B' }}
          </div>
          <div class="text-sm font-medium truncate">{{ reviewer.github_login }}</div>
        </div>
        <div
          class="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-md border text-xs font-medium"
          :class="
            decisionLabel(reviewer.status, kind) === 'Include'
              ? 'border-green-600/40 text-green-600 dark:text-green-500 bg-green-600/5'
              : decisionLabel(reviewer.status, kind) === 'Exclude'
                ? 'border-destructive/40 text-destructive bg-destructive/5'
                : 'border-border text-muted-foreground bg-muted/40'
          "
        >
          <Check
            v-if="decisionLabel(reviewer.status, kind) === 'Include'"
            class="h-3 w-3"
          />
          <X
            v-else-if="decisionLabel(reviewer.status, kind) === 'Exclude'"
            class="h-3 w-3"
          />
          <Circle v-else class="h-3 w-3" />
          {{ decisionLabel(reviewer.status, kind) }}
        </div>
      </div>

      <div
        v-if="kind === 'screen' && reviewer.criteria_string"
        class="mt-2 pt-2 border-t border-border text-xs text-muted-foreground font-mono break-words"
      >
        {{ reviewer.criteria_string }}
      </div>
    </div>
  </div>
</template>
