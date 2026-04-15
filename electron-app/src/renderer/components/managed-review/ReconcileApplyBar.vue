<script setup lang="ts">
import { Loader2, ArrowLeft } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

defineProps<{
  decidedCount: number;
  totalConflicts: number;
  canApply: boolean;
  isApplying: boolean;
}>();

const emit = defineEmits<{
  (e: 'apply'): void;
  (e: 'cancel'): void;
}>();
</script>

<template>
  <div
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

    <Button
      :disabled="!canApply || isApplying"
      data-testid="reconcile-apply-btn"
      @click="emit('apply')"
    >
      <Loader2 v-if="isApplying" class="h-4 w-4 animate-spin" />
      {{ isApplying ? 'Applying...' : 'Apply Reconciliation' }}
    </Button>
  </div>
</template>
