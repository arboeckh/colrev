<script setup lang="ts">
/**
 * Explains the reviewer-branch state.
 *
 * Opening a managed review checks the app out onto a `review/*` branch so the
 * two reviewers stay independent. That is the right mechanic, but it was
 * completely invisible: the sidebar simply rewrote itself — steps that had a
 * completed checkmark dropped back to hollow circles and record badges
 * vanished — which reads as lost work rather than as a scoped view.
 */
import { computed } from 'vue';
import { UserCheck } from 'lucide-vue-next';
import { useManagedReviewStore } from '@/stores/managedReview';

const managedReview = useManagedReviewStore();

const kindLabel = computed(() => {
  if (managedReview.activePrescreenTask) return 'prescreen';
  if (managedReview.activeScreenTask) return 'screen';
  return 'review';
});
</script>

<template>
  <div
    v-if="managedReview.isOnReviewerBranch"
    class="bg-eucalyptus-50 border-b border-eucalyptus-300/50 px-4 py-2 flex items-center gap-2"
    data-testid="reviewer-branch-banner"
  >
    <UserCheck class="h-4 w-4 text-eucalyptus-700 shrink-0" />
    <span class="text-sm text-eucalyptus-700">
      You're working through the {{ kindLabel }} on your own copy, so your decisions
      stay independent of the other reviewer. Later steps are hidden until this
      {{ kindLabel }} is reconciled — nothing has been lost.
    </span>
  </div>
</template>
