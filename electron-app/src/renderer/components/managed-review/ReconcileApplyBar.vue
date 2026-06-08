<script setup lang="ts">
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

const props = withDefaults(
  defineProps<{
    decidedCount: number;
    totalConflicts: number;
    canApply: boolean;
    isApplying: boolean;
    overrideBlockCount?: number;
    variant?: 'standalone' | 'inline';
  }>(),
  {
    overrideBlockCount: 0,
    variant: 'standalone',
  },
);

const applyLabel = () => {
  if (props.isApplying) return 'Applying...';
  const blocks = props.overrideBlockCount ?? 0;
  if (blocks > 0) {
    return `Override ${blocks} block${blocks === 1 ? '' : 's'} & apply`;
  }
  return 'Apply Reconciliation';
};

const emit = defineEmits<{
  (e: 'apply'): void;
  (e: 'cancel'): void;
}>();
</script>

<template>
  <!-- Inline: sits below include/exclude in the criteria panel -->
  <div
    v-if="variant === 'inline' && canApply"
    class="border-t border-border px-4 py-3 shrink-0 flex items-center justify-between gap-4"
    data-testid="reconcile-apply-bar"
  >
    <div class="flex items-center gap-2 text-sm font-medium min-w-0">
      <CheckCircle2 class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span class="truncate">
        {{ totalConflicts > 0 ? 'All conflicts resolved' : 'Ready to finalize' }}
      </span>
    </div>
    <Button
      size="sm"
      class="shrink-0 font-semibold"
      :disabled="isApplying"
      :variant="(overrideBlockCount ?? 0) > 0 ? 'destructive' : 'default'"
      data-testid="reconcile-apply-btn"
      @click="emit('apply')"
    >
      <Loader2 v-if="isApplying" class="h-4 w-4 animate-spin" />
      {{ applyLabel() }}
    </Button>
  </div>

  <div
    v-else-if="variant === 'inline' && !canApply"
    class="border-t border-border px-4 py-2.5 shrink-0 text-center text-xs text-muted-foreground"
    data-testid="reconcile-apply-bar"
  >
    <span data-testid="reconcile-decided-count">
      {{ decidedCount }} of {{ totalConflicts }} conflicts resolved
    </span>
  </div>

  <!-- Standalone: prominent horizontal apply bar -->
  <div
    v-else-if="canApply"
    class="rounded-lg border border-border px-5 py-4 flex items-center justify-between gap-6 shrink-0"
    data-testid="reconcile-apply-bar"
  >
    <div class="flex items-center gap-3 min-w-0">
      <CheckCircle2 class="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div class="min-w-0">
        <div class="text-base font-semibold">
          {{ totalConflicts > 0 ? 'All conflicts resolved' : 'Ready to finalize' }}
        </div>
        <p class="text-sm text-muted-foreground truncate">
          Apply reconciliation to commit the final decisions to the dev branch.
        </p>
      </div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <Button
        variant="ghost"
        size="sm"
        :disabled="isApplying"
        @click="emit('cancel')"
      >
        <ArrowLeft class="h-4 w-4" />
        Back
      </Button>
      <Button
        size="lg"
        class="min-w-44 font-semibold"
        :disabled="isApplying"
        :variant="(overrideBlockCount ?? 0) > 0 ? 'destructive' : 'default'"
        data-testid="reconcile-apply-btn"
        @click="emit('apply')"
      >
        <Loader2 v-if="isApplying" class="h-5 w-5 animate-spin" />
        {{ applyLabel() }}
      </Button>
    </div>
  </div>

  <div
    v-else
    class="flex items-center justify-between gap-4 border-t border-border pt-4"
    data-testid="reconcile-apply-bar"
  >
    <div class="flex items-center gap-3">
      <Button
        variant="ghost"
        size="sm"
        :disabled="isApplying"
        @click="emit('cancel')"
      >
        <ArrowLeft class="h-4 w-4" />
        Back
      </Button>
      <span class="text-sm text-muted-foreground" data-testid="reconcile-decided-count">
        {{ decidedCount }} of {{ totalConflicts }} conflicts resolved
      </span>
    </div>
    <span class="text-xs text-muted-foreground">
      Resolve all conflicts to apply
    </span>
  </div>
</template>
