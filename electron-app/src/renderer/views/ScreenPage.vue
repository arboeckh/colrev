<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { CheckSquare, FileDown } from 'lucide-vue-next';
import { EmptyState, LoadErrorState } from '@/components/common';
import {
  PdfViewerPanel,
  ScreenSplitPanel,
  ScreenRecordPanel,
  ScreenEditMode,
  ScreenComplete,
} from '@/components/screen';
import PdfShareActions from '@/components/shared/PdfShareActions.vue';
import { useProjectsStore } from '@/stores/projects';
import { isReviewStepComplete } from '@/lib/stepStatus';
import { useAuthStore } from '@/stores/auth';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useManagedReviewStore } from '@/stores/managedReview';
import { useNotificationsStore } from '@/stores/notifications';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useProjectDataStore } from '@/stores/projectData';
import { useManagedTaskAccess } from '@/composables/useManagedTaskAccess';
import { useProjectDataChanged } from '@/composables/useProjectDataChanged';
import { useReadOnly } from '@/composables/useReadOnly';
import { usePendingChangesStore } from '@/stores/pendingChanges';
import { canIncludeDecision, canExcludeDecision } from '@/lib/screen-decision';
import type {
  ScreenQueueRecord,
  ScreenCriterionInfo,
} from '@/types/generated/rpc';

type DecisionState = 'undecided' | 'included' | 'excluded';
type ScreenMode = 'screening' | 'edit' | 'complete';

interface ScreenEnrichedRecord extends ScreenQueueRecord {
  _decision: DecisionState;
  _criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'>;
}

const props = withDefaults(defineProps<{
  embedded?: boolean;
}>(), {
  embedded: false,
});

const emit = defineEmits<{
  navigateReconcile: [];
}>();

const auth = useAuthStore();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();
const managedReview = useManagedReviewStore();
const notifications = useNotificationsStore();
const reviewDefStore = useReviewDefinitionStore();
const pending = usePendingChangesStore();
const projectData = useProjectDataStore();
const { isReadOnly } = useReadOnly();

const isPageReady = ref(false);

const queue = ref<ScreenEnrichedRecord[]>([]);
const decisionHistory = ref<ScreenEnrichedRecord[]>([]);
const criteria = ref<Record<string, ScreenCriterionInfo>>({});
const totalCount = ref(0);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const currentIndex = ref(0);
const isDeciding = ref(false);
const mode = ref<ScreenMode>('screening');
const allDecisionsMade = ref(false);
// One implementation of the reviewer-branch invariant, shared with ScreenPage
// and the router guard (WP-07 §6).
const {
  managedTask,
  activeManagedTask,
  assignedReviewerBranch,
  assignedReviewer,
  accessState,
  isManagedAccessBlocked,
  loadManagedTask,
  ensureAccess: ensureManagedTaskAccess,
} = useManagedTaskAccess('screen');

const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const completeIncludedCount = computed(() => statusCounts.value?.rev_included ?? 0);
const completeExcludedCount = computed(() => statusCounts.value?.rev_excluded ?? 0);
const screenSessionDecisions = computed((): Record<string, 'include' | 'exclude'> => {
  const out: Record<string, 'include' | 'exclude'> = {};
  for (const record of decisionHistory.value) {
    if (record._decision === 'included') out[record.id] = 'include';
    else if (record._decision === 'excluded') out[record.id] = 'exclude';
  }
  return out;
});
const pdfPreparedCount = computed(() => statusCounts.value?.pdf_prepared ?? 0);
const currentRecord = computed(() => queue.value[currentIndex.value] || null);
const hasCriteria = computed(() => Object.keys(criteria.value).length > 0);
const decidedCount = computed(() => queue.value.filter((r) => r._decision !== 'undecided').length);
const includedCount = computed(() => queue.value.filter((r) => r._decision === 'included').length);
const excludedCount = computed(() => queue.value.filter((r) => r._decision === 'excluded').length);
const isCurrentDecided = computed(() => currentRecord.value?._decision !== 'undecided');
const nextUndecidedIndex = computed(() => {
  for (let i = currentIndex.value + 1; i < queue.value.length; i++) {
    if (queue.value[i]._decision === 'undecided') return i;
  }
  return -1;
});
const canInclude = computed(() => {
  if (!currentRecord.value) return false;
  return canIncludeDecision(criteria.value, currentRecord.value._criteriaDecisions);
});
const canExclude = computed(() => {
  if (!currentRecord.value) return false;
  return canExcludeDecision(criteria.value, currentRecord.value._criteriaDecisions);
});
const isScreenComplete = computed(() => {
  if (allDecisionsMade.value) return true;
  return isReviewStepComplete(projects.payloadSteps?.screen);
});
const managedAccessTitle = computed(() => {
  if (!activeManagedTask.value) return 'Screening is unavailable';
  if (assignedReviewer.value) return 'Switching to your screening branch failed';
  return 'Managed screen is active';
});
const managedAccessDescription = computed(() => {
  if (!activeManagedTask.value) {
    return 'No managed screening branch is available for the current session.';
  }
  if (assignedReviewer.value) {
    return `This task is assigned to you on ${assignedReviewer.value.branch_name}. Full-text screening happens only on reviewer branches, not on dev.`;
  }
  return `Task ${activeManagedTask.value.id} is currently assigned to ${activeManagedTask.value.reviewers.map((reviewer) => reviewer.github_login).join(' and ')}. Full-text screening decisions should only be made from reviewer branches.`;
});


async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  isLoading.value = true;
  loadError.value = null;
  allDecisionsMade.value = false;
  const guard = projectData.snapshot();
  try {
    const response = await backend.call('get_screen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
      task_id: managedTask.value?.id,
    });
    // Project/branch switch mid-flight: discard the stale response.
    if (!guard.isCurrent()) return;
    if (response.success) {
      criteria.value = response.criteria || {};
      const criteriaNames = Object.keys(criteria.value);
      const newRecords: ScreenEnrichedRecord[] = response.records.map((record) => {
        const criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'> = {};
        for (const name of criteriaNames) {
          criteriaDecisions[name] = record.current_criteria?.[name] as 'in' | 'out' || 'TODO';
        }
        return {
          ...record,
          _decision: 'undecided' as DecisionState,
          _criteriaDecisions: criteriaDecisions,
        };
      });
      const history = decisionHistory.value;
      queue.value = [...history, ...newRecords];
      totalCount.value = response.total_count;
      currentIndex.value = history.length;
    }
  } catch (err) {
    if (guard.isCurrent()) {
      loadError.value = err instanceof Error ? err.message : 'Unknown error';
    }
  } finally {
    isLoading.value = false;
  }
}

async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isDeciding.value) return;
  if (isCurrentDecided.value) return;

  isDeciding.value = true;
  try {
    const criteriaDecisions: Record<string, 'in' | 'out'> = {};
    if (hasCriteria.value) {
      for (const [name, value] of Object.entries(currentRecord.value._criteriaDecisions)) {
        if (value !== 'TODO') criteriaDecisions[name] = value;
      }
    }

    const guard = projectData.snapshot();
    const response = await backend.call('screen_record', {
      project_id: projects.currentProjectId,
      record_id: currentRecord.value.id,
      decision,
      criteria_decisions: Object.keys(criteriaDecisions).length > 0 ? criteriaDecisions : undefined,
      task_id: managedTask.value?.id,
    });

    if (!guard.isCurrent()) return;
    if (response.success) {
      currentRecord.value._decision = decision === 'include' ? 'included' : 'excluded';
      totalCount.value = response.remaining_count;
      decisionHistory.value.push({ ...currentRecord.value });
      if (nextUndecidedIndex.value !== -1) {
        currentIndex.value = nextUndecidedIndex.value;
      } else if (response.remaining_count > 0) {
        await loadQueue();
      } else {
        // Queue exhausted — flush the seam immediately so the completion
        // screen renders fresh counts (the debounced write refresh would
        // land a beat too late).
        queue.value = [];
        await projectData.refreshNow();
        allDecisionsMade.value = true;
      }
    }
  } catch (err) {
    notifications.error('Decision failed', err instanceof Error ? err.message : 'Unknown error');
  } finally {
    isDeciding.value = false;
  }
}

function confirmCriteriaDecision(decision: 'include' | 'exclude') {
  if (isCurrentDecided.value || isDeciding.value || isReadOnly.value) return;
  if (decision === 'include' && !canInclude.value) return;
  if (decision === 'exclude' && !canExclude.value) return;
  makeDecision(decision);
}

function toggleCriterion(name: string, value: 'in' | 'out' | 'TODO') {
  if (!currentRecord.value) return;
  currentRecord.value._criteriaDecisions[name] = value;
}

function goToRecord(index: number) {
  if (index >= 0 && index < queue.value.length) currentIndex.value = index;
}

function skipToNextUndecided() {
  if (nextUndecidedIndex.value !== -1) currentIndex.value = nextUndecidedIndex.value;
}

function enterEditMode() {
  mode.value = 'edit';
}

function exitEditMode() {
  mode.value = isScreenComplete.value ? 'complete' : 'screening';
}

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (mode.value !== 'screening') return;

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (currentIndex.value > 0) currentIndex.value -= 1;
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (currentIndex.value < queue.value.length - 1) currentIndex.value += 1;
      break;
  }
}

async function handlePdfsImported() {
  // A zip import placed new PDFs on disk — queue items that showed
  // "No PDF available" may now have files. Store-level state refreshes via
  // the invalidation seam; the queue is page-owned so reload it here.
  await loadQueue();
}

// Full invalidations (pull, reset, merge, backend restart) replace the
// working tree — discard walkthrough state and rebuild the queue.
useProjectDataChanged(async (event) => {
  if (!event.full) return;
  decisionHistory.value = [];
  const canLoadQueue = await ensureManagedTaskAccess();
  if (canLoadQueue) {
    await loadQueue();
  } else {
    queue.value = [];
    totalCount.value = 0;
  }
});

onMounted(async () => {
  try {
    await reviewDefStore.loadDefinition();
    const canLoadQueue = await ensureManagedTaskAccess();
    if (canLoadQueue) {
      await loadQueue();
    } else {
      queue.value = [];
      totalCount.value = 0;
    }
  } finally {
    await git.refreshStatus();
    isPageReady.value = true;
  }
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

</script>

<template>
  <div class="h-full flex flex-col" data-testid="screen-page">
    <div
      v-if="!embedded"
      class="flex items-center justify-end gap-2 px-4 pt-2"
    >
      <PdfShareActions variant="compact" @imported="handlePdfsImported" />
    </div>
    <div
      v-if="accessState === 'switching'"
      class="mx-6 mt-6 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
    >
      <div class="font-medium">Opening your assigned screening branch</div>
      <div class="text-muted-foreground">
        Full-text screening happens on reviewer branches. The app is switching you behind the scenes.
      </div>
    </div>
    <EmptyState
      v-if="isManagedAccessBlocked"
      :icon="CheckSquare"
      :title="managedAccessTitle"
      :description="managedAccessDescription"
    />
    <div
      v-else-if="!isPageReady"
      class="flex-1 flex items-center justify-center"
      data-testid="screen-loading"
    >
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <template v-else>

    <div v-if="mode === 'edit'" class="px-4 py-3">
      <ScreenEditMode
        :managed-task="managedTask"
        :session-decisions="screenSessionDecisions"
        @close="exitEditMode"
      />
    </div>

    <ScreenComplete
      v-else-if="mode === 'complete' || (!isLoading && queue.length === 0 && isScreenComplete)"
      class="px-4 py-3"
      :included-count="completeIncludedCount"
      :excluded-count="completeExcludedCount"
      :read-only="isReadOnly"
      :show-reconcile-cta="embedded"
      :reconcile-ready="isPageReady"
      @edit-decisions="enterEditMode"
      @navigate-reconcile="emit('navigateReconcile')"
    />

    <LoadErrorState
      v-else-if="!isLoading && loadError"
      title="Failed to load screening queue"
      :message="loadError"
      test-id="screen-load-error"
      @retry="loadQueue"
    />

    <div
      v-else-if="!isLoading && queue.length === 0 && !isScreenComplete && pdfPreparedCount === 0"
      class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8"
    >
      <FileDown class="h-10 w-10 text-muted-foreground" />
      <div>
        <h3 class="text-lg font-medium">No PDFs ready to screen</h3>
        <p class="text-sm text-muted-foreground mt-1">
          Finish PDF retrieval and preparation, then use Screen Launch to create paired reviewer branches.
        </p>
      </div>
    </div>

    <div v-else-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <EmptyState
      v-else-if="!hasCriteria"
      :icon="CheckSquare"
      title="No screening criteria defined"
      description="Add screening criteria on the Screen Launch page before starting. Criteria can only be defined on the dev branch and are frozen once a managed task is active."
    />

    <EmptyState
      v-else-if="!isLoading && queue.length === 0"
      :icon="CheckSquare"
      title="No records to screen"
      description="There are no full-text records ready for the current screening queue."
    />

    <ScreenSplitPanel
      v-else-if="currentRecord"
      class="flex-1 min-h-0"
      data-testid="screen-record-card"
    >
      <template #left>
        <PdfViewerPanel
          :pdf-path="currentRecord.pdf_path ?? undefined"
          @imported="handlePdfsImported"
        />
      </template>
      <template #right>
        <ScreenRecordPanel
          :key="currentRecord.id"
          :record="currentRecord"
          :criteria="criteria"
          :criteria-decisions="currentRecord._criteriaDecisions"
          :has-criteria="hasCriteria"
          :decided-count="decidedCount"
          :included-count="includedCount"
          :excluded-count="excludedCount"
          :total-count="totalCount"
          :is-deciding="isDeciding"
          :is-current-decided="isCurrentDecided"
          :next-undecided-index="nextUndecidedIndex"
          :mode="mode"
          :queue-records="queue"
          :current-index="currentIndex"
          :read-only="isReadOnly"
          @toggle-criterion="toggleCriterion"
          @confirm-decision="confirmCriteriaDecision"
          @skip-to-next-undecided="skipToNextUndecided"
          @enter-edit-mode="enterEditMode"
          @navigate="goToRecord"
        />
      </template>
    </ScreenSplitPanel>
    </template>
  </div>
</template>
