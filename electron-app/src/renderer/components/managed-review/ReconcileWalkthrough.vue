<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectsStore } from '@/stores/projects';
import { useWalkthroughNavigation } from '@/composables/useWalkthroughNavigation';
import ProgressTrack from '@/components/prescreen/ProgressTrack.vue';
import RecordCard, { type DisplayRecord } from '@/components/prescreen/RecordCard.vue';
import ReconcileDecisionButtons from './ReconcileDecisionButtons.vue';
import ReconcileApplyBar from './ReconcileApplyBar.vue';
import BlockedRecordsBanner from './BlockedRecordsBanner.vue';
import { selectedReviewerFor, type ReconcileKind, type ReviewerRole } from './reconcile-utils';
import type {
  ApplyReconciliationResponse,
  GetRecordsResponse,
  ReconciliationPreviewItem,
  ReconciliationPreviewResponse,
} from '@/types/api';

const props = defineProps<{
  taskId: string;
  kind: ReconcileKind;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'applied', result: ApplyReconciliationResponse): void;
}>();

const auth = useAuthStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const projects = useProjectsStore();

type StagedDecision = {
  decision: 'include' | 'exclude';
  selected_reviewer: ReviewerRole;
};

const isLoading = ref(false);
const isApplying = ref(false);
const preview = ref<ReconciliationPreviewResponse | null>(null);
const recordDetails = ref<Record<string, DisplayRecord>>({});
const stagedDecisions = ref<Record<string, StagedDecision>>({});

const blockedItems = computed<ReconciliationPreviewItem[]>(() =>
  preview.value ? preview.value.items.filter((item) => item.status === 'blocked') : [],
);

const pendingItems = computed<ReconciliationPreviewItem[]>(() =>
  preview.value ? preview.value.items.filter((item) => item.status === 'pending') : [],
);

function reviewersDisagree(item: ReconciliationPreviewItem): boolean {
  if (item.reviewers.length < 2) return false;
  const [a, b] = item.reviewers;
  return a.status !== b.status || a.criteria_string !== b.criteria_string;
}

const NON_TASK_METADATA_PREFIX = 'Non-task metadata changed';

const overridableBlockedItems = computed<ReconciliationPreviewItem[]>(() =>
  blockedItems.value.filter((item) =>
    item.blocked_reasons.length > 0
    && item.blocked_reasons.every((r) => r.startsWith(NON_TASK_METADATA_PREFIX)),
  ),
);

const hardBlockedItems = computed<ReconciliationPreviewItem[]>(() =>
  blockedItems.value.filter((item) =>
    item.blocked_reasons.some((r) => !r.startsWith(NON_TASK_METADATA_PREFIX)),
  ),
);

// Blocked records where reviewers disagreed: after override they become
// conflicts and need a resolution choice from the user.
const overridableConflictItems = computed<ReconciliationPreviewItem[]>(() =>
  overridableBlockedItems.value.filter((item) => reviewersDisagree(item)),
);

const realConflictItems = computed<ReconciliationPreviewItem[]>(() =>
  preview.value ? preview.value.items.filter((item) => item.status === 'conflict') : [],
);

const conflictItems = computed<ReconciliationPreviewItem[]>(() => [
  ...realConflictItems.value,
  ...overridableConflictItems.value,
]);

const { currentIndex, currentItem, nextUndecidedIndex, goTo, skipToNextUndecided } =
  useWalkthroughNavigation<ReconciliationPreviewItem>({
    items: conflictItems,
    isUndecided: (item) => !stagedDecisions.value[item.id],
    wrapAround: true,
    onArrowLeft: () => {
      if (currentStagedDecision.value === 'undecided') onDecide('exclude');
    },
    onArrowRight: () => {
      if (currentStagedDecision.value === 'undecided') onDecide('include');
    },
  });

const currentRecord = computed<DisplayRecord | null>(() => {
  if (!currentItem.value) return null;
  const detail = recordDetails.value[currentItem.value.id];
  if (detail) return detail;
  // Mirrors the review UI: abstracts are prefetched at launch; reconcile
  // never re-fetches. If the prefetch missed a record, just show what we have.
  return {
    id: currentItem.value.id,
    title: currentItem.value.title,
    author: currentItem.value.author,
    year: currentItem.value.year,
    _enrichmentStatus: 'failed',
  };
});

const stagedCount = computed(() => Object.keys(stagedDecisions.value).length);
const allDecided = computed(
  () => conflictItems.value.length > 0 && stagedCount.value === conflictItems.value.length,
);

const currentStagedDecision = computed(() => {
  if (!currentItem.value) return 'undecided' as const;
  const staged = stagedDecisions.value[currentItem.value.id];
  if (!staged) return 'undecided' as const;
  return staged.decision === 'include' ? 'included' : 'excluded';
});

const progressItems = computed(() =>
  conflictItems.value.map((item) => {
    const staged = stagedDecisions.value[item.id];
    return {
      id: item.id,
      decision: staged
        ? ((staged.decision === 'include' ? 'included' : 'excluded') as
            | 'included'
            | 'excluded')
        : ('undecided' as const),
    };
  }),
);

async function loadPreview() {
  if (!projects.currentProjectId) return;
  isLoading.value = true;
  try {
    const response = await backend.call<ReconciliationPreviewResponse>(
      'get_reconciliation_preview',
      {
        project_id: projects.currentProjectId,
        task_id: props.taskId,
      },
    );
    preview.value = response;
    stagedDecisions.value = {};
    currentIndex.value = 0;
    if (conflictItems.value.length > 0) {
      await loadRecordDetails(conflictItems.value.map((item) => item.id));
    }
  } catch (err) {
    notifications.error(
      'Preview failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isLoading.value = false;
  }
}

async function loadRecordDetails(ids: string[]) {
  if (!projects.currentProjectId || ids.length === 0) return;
  try {
    const response = await backend.call<GetRecordsResponse>('get_records', {
      project_id: projects.currentProjectId,
      filters: {},
      pagination: { offset: 0, limit: 1000 },
      fields: ['ID', 'title', 'author', 'year', 'journal', 'booktitle', 'abstract'],
    });
    const wanted = new Set(ids);
    const details: Record<string, DisplayRecord> = {};
    for (const record of response.records) {
      const rid = (record as any).ID ?? (record as any).id;
      if (!rid || !wanted.has(rid)) continue;
      details[rid] = {
        id: rid,
        title: (record as any).title,
        author: (record as any).author,
        year: (record as any).year,
        journal: (record as any).journal,
        booktitle: (record as any).booktitle,
        abstract: (record as any).abstract,
        _enrichmentStatus: (record as any).abstract ? 'complete' : 'failed',
      };
    }
    recordDetails.value = details;
  } catch (err) {
    notifications.error(
      'Failed to load records',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
}

function onDecide(decision: 'include' | 'exclude') {
  const item = currentItem.value;
  if (!item) return;
  const reviewer = selectedReviewerFor(item, decision, props.kind);
  if (!reviewer) {
    notifications.error(
      'Cannot reconcile',
      "Neither reviewer chose that decision; this shouldn't happen on a conflict item.",
    );
    return;
  }
  stagedDecisions.value = {
    ...stagedDecisions.value,
    [item.id]: { decision, selected_reviewer: reviewer },
  };
  const next = nextUndecidedIndex.value;
  if (next !== -1) {
    currentIndex.value = next;
  }
}

async function applyReconciliation(opts: { overrideBlocks?: boolean } = {}) {
  if (!projects.currentProjectId || !preview.value) return;
  const overrideBlocks = !!opts.overrideBlocks;
  if (!overrideBlocks && blockedItems.value.length > 0) {
    notifications.error(
      'Cannot apply',
      'Blocked records must be overridden first.',
    );
    return;
  }
  if (pendingItems.value.length > 0) {
    notifications.error(
      'Cannot apply',
      `${pendingItems.value.length} record(s) still pending reviewer decisions.`,
    );
    return;
  }
  if (conflictItems.value.length > 0 && !allDecided.value) {
    notifications.error(
      'Cannot apply',
      `Resolve all ${conflictItems.value.length} conflict(s) before applying. ${stagedCount.value} resolved.`,
    );
    return;
  }

  isApplying.value = true;
  try {
    const resolutions = Object.entries(stagedDecisions.value).map(
      ([record_id, staged]) => ({
        record_id,
        selected_reviewer: staged.selected_reviewer,
      }),
    );
    const response = await backend.call<ApplyReconciliationResponse>(
      'apply_reconciliation',
      {
        project_id: projects.currentProjectId,
        task_id: props.taskId,
        resolutions,
        resolved_by: auth.user?.login ?? 'local-user',
        override_blocks: overrideBlocks,
      },
    );
    notifications.success(
      'Reconciliation applied',
      `${response.resolved_count} record(s) · ${response.commit_sha.slice(0, 8)}`,
    );
    emit('applied', response);
  } catch (err) {
    notifications.error(
      'Reconciliation failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isApplying.value = false;
  }
}

function onApplyClicked() {
  void applyReconciliation({ overrideBlocks: overridableBlockedItems.value.length > 0 });
}

watch(
  () => props.taskId,
  () => loadPreview(),
  { immediate: true },
);
</script>

<template>
  <div class="h-full flex flex-col min-h-0" data-testid="reconcile-walkthrough">
    <!-- Loading -->
    <div
      v-if="isLoading && !preview"
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground"
    >
      <Loader2 class="h-4 w-4 animate-spin mr-2" />
      Loading reconciliation preview...
    </div>

    <!-- Hard-blocked guard: records missing on a branch, can't be overridden -->
    <div
      v-else-if="hardBlockedItems.length > 0"
      class="flex-1 flex flex-col items-center max-w-xl mx-auto text-center gap-4 py-6 min-h-0"
      data-testid="reconcile-hard-blocked"
    >
      <div class="rounded-full bg-amber-500/15 p-3">
        <AlertTriangle class="h-6 w-6 text-amber-600 dark:text-amber-400" />
      </div>
      <div class="space-y-1">
        <h3 class="text-lg font-medium">Records missing on a branch</h3>
        <p class="text-sm text-muted-foreground">
          Some records are missing on dev or a reviewer branch and can't be
          overridden. Restore them via git before reconciling.
        </p>
      </div>
      <ul
        class="w-full space-y-2 text-left overflow-y-auto pr-1"
        style="max-height: 50vh"
      >
        <li
          v-for="item in hardBlockedItems"
          :key="item.id"
          class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
        >
          <div class="text-sm font-medium">{{ item.title || item.id }}</div>
          <ul class="mt-1 space-y-1">
            <li
              v-for="reason in item.blocked_reasons"
              :key="reason"
              class="text-xs text-amber-700 dark:text-amber-300"
            >
              {{ reason }}
            </li>
          </ul>
        </li>
      </ul>
      <Button variant="ghost" size="sm" @click="emit('close')">
        Cancel
      </Button>
    </div>

    <!-- Pending guard -->
    <div
      v-else-if="pendingItems.length > 0"
      class="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto text-center gap-4"
      data-testid="reconcile-pending"
    >
      <div class="rounded-full bg-muted p-3">
        <Loader2 class="h-6 w-6 text-muted-foreground" />
      </div>
      <div class="space-y-1">
        <h3 class="text-lg font-medium">Waiting on reviewers</h3>
        <p class="text-sm text-muted-foreground">
          Both reviewers must finish all records before reconciliation can begin.
          {{ pendingItems.length }} record{{ pendingItems.length === 1 ? '' : 's' }} still pending.
        </p>
      </div>
    </div>

    <!-- No conflicts: can apply directly -->
    <div
      v-else-if="preview && conflictItems.length === 0"
      class="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto text-center gap-4"
      data-testid="reconcile-no-conflicts"
    >
      <div class="rounded-full bg-green-600/15 p-3">
        <CheckCircle2 class="h-6 w-6 text-green-600 dark:text-green-500" />
      </div>
      <div class="space-y-1">
        <h3 class="text-lg font-medium">No conflicts to resolve</h3>
        <p class="text-sm text-muted-foreground">
          Both reviewers agreed on every record. Apply reconciliation to finalize
          {{ preview.summary.auto_resolved_count }} auto-resolved decision{{ preview.summary.auto_resolved_count === 1 ? '' : 's' }}.
        </p>
      </div>
      <BlockedRecordsBanner
        v-if="overridableBlockedItems.length > 0"
        :items="overridableBlockedItems"
        class="w-full"
      />
      <ReconcileApplyBar
        :decided-count="0"
        :total-conflicts="0"
        :can-apply="true"
        :is-applying="isApplying"
        :override-block-count="overridableBlockedItems.length"
        class="w-full"
        @apply="onApplyClicked"
        @cancel="emit('close')"
      />
    </div>

    <!-- Walkthrough -->
    <template v-else-if="currentItem">
      <div class="flex-1 flex flex-col min-h-0 gap-3">
        <BlockedRecordsBanner
          v-if="overridableBlockedItems.length > 0"
          :items="overridableBlockedItems"
        />

        <ProgressTrack
          :items="progressItems"
          :current-index="currentIndex"
          :decided-count="stagedCount"
          :total-count="conflictItems.length"
          test-id-prefix="reconcile"
          @seek="goTo"
        />

        <div class="flex-1 min-h-0 flex flex-col">
          <RecordCard
            v-if="currentRecord"
            :record="currentRecord"
            :can-prev="currentIndex > 0"
            :can-next="currentIndex < conflictItems.length - 1"
            layout="side-by-side"
            test-id-prefix="reconcile"
            @prev="goTo(currentIndex - 1)"
            @next="goTo(currentIndex + 1)"
          />
        </div>

        <ReconcileDecisionButtons
          :decision="currentStagedDecision"
          :reviewers="currentItem.reviewers"
          :kind="kind"
          :is-submitting="false"
          :show-skip-to-next="nextUndecidedIndex !== -1"
          test-id-prefix="reconcile"
          @decide="onDecide"
          @skip-to-next="skipToNextUndecided"
        />
      </div>

      <ReconcileApplyBar
        class="mt-4"
        :decided-count="stagedCount"
        :total-conflicts="conflictItems.length"
        :can-apply="allDecided"
        :is-applying="isApplying"
        :override-block-count="overridableBlockedItems.length"
        @apply="onApplyClicked"
        @cancel="emit('close')"
      />
    </template>
  </div>
</template>
