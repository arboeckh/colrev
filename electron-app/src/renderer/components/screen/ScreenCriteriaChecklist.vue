<script setup lang="ts">
import { computed } from 'vue';
import { Check, Circle, X } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import type { ReconciliationPreviewItem, ScreenCriterionInfo } from '@/types/generated/rpc';

const props = withDefaults(
  defineProps<{
    criteria: Record<string, ScreenCriterionInfo>;
    decisions: Record<string, 'in' | 'out' | 'TODO'>;
    reviewers?: ReconciliationPreviewItem['reviewers'];
    testIdPrefix?: string;
  }>(),
  {
    testIdPrefix: 'criterion-check',
  },
);

const emit = defineEmits<{
  toggle: [name: string, value: 'in' | 'out' | 'TODO'];
}>();

const inclusionCriteria = computed(() =>
  Object.entries(props.criteria).filter(([, c]) => c.criterion_type !== 'exclusion_criterion')
);

const exclusionCriteria = computed(() =>
  Object.entries(props.criteria).filter(([, c]) => c.criterion_type === 'exclusion_criterion')
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

function criterionState(name: string): 'in' | 'out' | 'TODO' {
  return props.decisions[name] || 'TODO';
}

function reviewersWhoSelected(name: string, expectedValue: 'in' | 'out') {
  if (!props.reviewers) return [];
  return props.reviewers.filter(
    (reviewer) => reviewer.criteria?.[name] === expectedValue,
  );
}
</script>

<template>
  <div class="space-y-4" data-testid="screen-criteria-checklist">
    <p class="text-xs text-muted-foreground leading-relaxed">
      Click each criterion to mark whether it applies to this record.
    </p>

    <!-- Inclusion criteria -->
    <div v-if="inclusionCriteria.length > 0">
      <h5 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
        Inclusion
      </h5>
      <p class="text-[11px] text-muted-foreground/80 mb-2">
        Mark when this record meets the criterion.
      </p>
      <div class="space-y-1.5">
        <div
          v-for="[name, criterion] in inclusionCriteria"
          :key="name"
          role="button"
          tabindex="0"
          class="group flex gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors border"
          :class="
            criterionState(name) === 'in'
              ? 'bg-green-600/15 border-green-600/30'
              : 'bg-muted/50 border-transparent hover:bg-muted hover:border-border/60'
          "
          :data-testid="`${testIdPrefix}-${name}`"
          @click="handleToggle(name)"
          @keydown.enter.space.prevent="handleToggle(name)"
        >
          <div class="mt-0.5 shrink-0">
            <div
              v-if="criterionState(name) === 'in'"
              class="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-white"
            >
              <Check class="h-2.5 w-2.5" />
            </div>
            <Circle
              v-else
              class="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors"
            />
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-start gap-2 flex-wrap">
              <span class="text-sm font-medium flex-1 min-w-0">{{ name }}</span>
              <span
                v-for="reviewer in reviewersWhoSelected(name, 'in')"
                :key="reviewer.role"
                class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/60 text-muted-foreground font-normal"
                :data-testid="`${testIdPrefix}-${name}-reviewer-${reviewer.role}`"
              >
                @{{ reviewer.github_login }}
              </span>
              <Badge
                v-if="criterionState(name) === 'in'"
                variant="default"
                class="text-xs bg-green-600 shrink-0"
              >
                Met
              </Badge>
              <span
                v-else
                class="text-[11px] text-muted-foreground shrink-0 pt-0.5"
              >
                Mark met
              </span>
            </div>
            <p
              v-if="criterion.explanation"
              class="text-xs text-muted-foreground mt-0.5 leading-snug"
            >
              {{ criterion.explanation }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Exclusion criteria -->
    <div v-if="exclusionCriteria.length > 0">
      <h5 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
        Exclusion
      </h5>
      <p class="text-[11px] text-muted-foreground/80 mb-2">
        Mark when this record should be excluded for this reason.
      </p>
      <div class="space-y-1.5">
        <div
          v-for="[name, criterion] in exclusionCriteria"
          :key="name"
          role="button"
          tabindex="0"
          class="group flex gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors border"
          :class="
            criterionState(name) === 'out'
              ? 'bg-destructive/15 border-destructive/30'
              : 'bg-muted/50 border-transparent hover:bg-muted hover:border-border/60'
          "
          :data-testid="`${testIdPrefix}-${name}`"
          @click="handleToggle(name)"
          @keydown.enter.space.prevent="handleToggle(name)"
        >
          <div class="mt-0.5 shrink-0">
            <div
              v-if="criterionState(name) === 'out'"
              class="flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white"
            >
              <X class="h-2.5 w-2.5" />
            </div>
            <Circle
              v-else
              class="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors"
            />
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-start gap-2 flex-wrap">
              <span class="text-sm font-medium flex-1 min-w-0">{{ name }}</span>
              <span
                v-for="reviewer in reviewersWhoSelected(name, 'out')"
                :key="reviewer.role"
                class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/60 text-muted-foreground font-normal"
                :data-testid="`${testIdPrefix}-${name}-reviewer-${reviewer.role}`"
              >
                @{{ reviewer.github_login }}
              </span>
              <Badge
                v-if="criterionState(name) === 'out'"
                variant="destructive"
                class="text-xs shrink-0"
              >
                Applies
              </Badge>
              <span
                v-else
                class="text-[11px] text-muted-foreground shrink-0 pt-0.5"
              >
                Mark applies
              </span>
            </div>
            <p
              v-if="criterion.explanation"
              class="text-xs text-muted-foreground mt-0.5 leading-snug"
            >
              {{ criterion.explanation }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
