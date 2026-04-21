<script setup lang="ts">
import { computed } from 'vue';
import { Check, X } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ReconciliationPreviewItem, ScreenCriterionDefinition } from '@/types/api';
import type { CriterionDecision } from '@/lib/screen-decision';
import { reviewerStatusToDecision } from './reconcile-utils';

const props = defineProps<{
  criteria: Record<string, ScreenCriterionDefinition>;
  decisions: Record<string, CriterionDecision>;
  reviewers: ReconciliationPreviewItem['reviewers'];
  derivedDecision: 'include' | 'exclude' | null;
  confirmedDecision: 'include' | 'exclude' | null;
}>();

const emit = defineEmits<{
  toggle: [name: string, value: CriterionDecision];
  confirm: [decision: 'include' | 'exclude'];
}>();

const inclusionCriteria = computed(() =>
  Object.entries(props.criteria).filter(([, c]) => c.criterion_type !== 'exclusion_criterion'),
);

const exclusionCriteria = computed(() =>
  Object.entries(props.criteria).filter(([, c]) => c.criterion_type === 'exclusion_criterion'),
);

function handleToggle(name: string) {
  const current = props.decisions[name] || 'TODO';
  const criterion = props.criteria[name];
  const isExclusion = criterion?.criterion_type === 'exclusion_criterion';
  if (current === 'TODO') {
    emit('toggle', name, isExclusion ? 'out' : 'in');
  } else {
    emit('toggle', name, 'TODO');
  }
}

function reviewersWhoSelected(name: string, expectedValue: 'in' | 'out') {
  return props.reviewers.filter(
    (reviewer) => reviewer.criteria?.[name] === expectedValue,
  );
}

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

      <div v-if="inclusionCriteria.length > 0">
        <h5 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Inclusion
        </h5>
        <div class="space-y-1.5">
          <div
            v-for="[name, criterion] in inclusionCriteria"
            :key="name"
            class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors"
            :class="
              decisions[name] === 'in'
                ? 'bg-green-600/15 border border-green-600/30'
                : 'bg-muted/50 border border-transparent hover:bg-muted'
            "
            :data-testid="`reconcile-criterion-${name}`"
            :title="criterion.explanation || undefined"
            @click="handleToggle(name)"
          >
            <span class="text-sm font-medium flex-1 truncate">{{ name }}</span>

            <span
              v-for="reviewer in reviewersWhoSelected(name, 'in')"
              :key="reviewer.role"
              class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/60 text-muted-foreground font-normal"
              :data-testid="`reconcile-criterion-${name}-reviewer-${reviewer.role}`"
            >
              @{{ reviewer.github_login }}
            </span>

            <Badge
              v-if="decisions[name] === 'in'"
              variant="default"
              class="text-xs bg-green-600 shrink-0"
            >Met</Badge>
          </div>
        </div>
      </div>

      <div v-if="exclusionCriteria.length > 0">
        <h5 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Exclusion
        </h5>
        <div class="space-y-1.5">
          <div
            v-for="[name, criterion] in exclusionCriteria"
            :key="name"
            class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors"
            :class="
              decisions[name] === 'out'
                ? 'bg-destructive/15 border border-destructive/30'
                : 'bg-muted/50 border border-transparent hover:bg-muted'
            "
            :data-testid="`reconcile-criterion-${name}`"
            :title="criterion.explanation || undefined"
            @click="handleToggle(name)"
          >
            <span class="text-sm font-medium flex-1 truncate">{{ name }}</span>

            <span
              v-for="reviewer in reviewersWhoSelected(name, 'out')"
              :key="reviewer.role"
              class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/60 text-muted-foreground font-normal"
              :data-testid="`reconcile-criterion-${name}-reviewer-${reviewer.role}`"
            >
              @{{ reviewer.github_login }}
            </span>

            <Badge
              v-if="decisions[name] === 'out'"
              variant="destructive"
              class="text-xs shrink-0"
            >Applies</Badge>
          </div>
        </div>
      </div>
    </div>

    <div
      class="border-t border-border px-4 py-3 shrink-0"
      data-testid="reconcile-decision-bar"
    >
      <div
        v-if="confirmedDecision && confirmedDecision === derivedDecision"
        class="flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
        :class="
          confirmedDecision === 'include'
            ? 'border-green-600/30 bg-green-600/15 text-green-700 dark:text-green-500'
            : 'border-destructive/30 bg-destructive/15 text-destructive'
        "
        data-testid="reconcile-confirmed-indicator"
      >
        <Check v-if="confirmedDecision === 'include'" class="h-4 w-4" />
        <X v-else class="h-4 w-4" />
        {{ confirmedDecision === 'include' ? 'Included' : 'Excluded' }}
      </div>
      <Button
        v-else-if="derivedDecision === 'include'"
        class="w-full bg-green-600 hover:bg-green-600/90 text-white"
        data-testid="reconcile-btn-include"
        @click="emit('confirm', 'include')"
      >
        <Check class="h-4 w-4" />
        Include
      </Button>
      <Button
        v-else-if="derivedDecision === 'exclude'"
        variant="destructive"
        class="w-full"
        data-testid="reconcile-btn-exclude"
        @click="emit('confirm', 'exclude')"
      >
        <X class="h-4 w-4" />
        Exclude
      </Button>
      <div
        v-else
        class="text-center text-xs text-muted-foreground"
      >
        Select criteria to determine the decision
      </div>
    </div>
  </div>
</template>
