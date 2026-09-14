<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Check, CheckSquare, FileDown, Pencil } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadErrorState, QueueJumpDialog } from '@/components/common';
import {
  PdfViewerPanel,
  ScreenSplitPanel,
  ScreenRecordPanel,
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
import {
  canIncludeDecision,
  canExcludeDecision,
  formatCriteriaString,
  type CriterionDecision,
} from '@/lib/screen-decision';
import type {
  ScreenQueueRecord,
  ScreenCriterionInfo,
} from '@/types/generated/rpc';

type DecisionState = 'undecided' | 'included' | 'excluded';
type ScreenMode = 'screening' | 'edit' | 'complete';

interface ScreenEnrichedRecord extends ScreenQueueRecord {
  _decision: DecisionState;
  _criteriaDecisions: Record<string, CriterionDecision>;
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
const pdfPreparedCount = computed(() => statusCounts.value?.pdf_prepared ?? 0);
// Editing decisions is the review walkthrough again: the records that already
// carry a decision are loaded into their own queue and shown in the same split
// panel, with the decision buttons live on decided records.
const editQueue = ref<ScreenEnrichedRecord[]>([]);
const isLoadingEditQueue = ref(false);
/** What each edit-queue record holds on disk, by id — to tell a real change
 * from a re-confirmation, and to roll back a failed write. */
const savedEdits = new Map<string, { decision: DecisionState; criteria: Record<string, CriterionDecision> }>();
/** Where the review walkthrough stood, to return there after editing. */
let reviewIndexBeforeEdit = 0;
/** The queue the walkthrough is showing: the review queue or, while editing,
 * the decided records. */
const activeQueue = computed(() => (mode.value === 'edit' ? editQueue.value : queue.value));

const currentRecord = computed(() => activeQueue.value[currentIndex.value] || null);
const hasCriteria = computed(() => Object.keys(criteria.value).length > 0);
const decidedCount = computed(() => activeQueue.value.filter((r) => r._decision !== 'undecided').length);
const includedCount = computed(() => activeQueue.value.filter((r) => r._decision === 'included').length);
const excludedCount = computed(() => activeQueue.value.filter((r) => r._decision === 'excluded').length);
const isCurrentDecided = computed(() => currentRecord.value?._decision !== 'undecided');
const nextUndecidedIndex = computed(() => {
  for (let i = currentIndex.value + 1; i < activeQueue.value.length; i++) {
    if (activeQueue.value[i]._decision === 'undecided') return i;
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


function criteriaDecisionsOf(record: ScreenQueueRecord): Record<string, CriterionDecision> {
  const decisions: Record<string, CriterionDecision> = {};
  for (const [name, criterion] of Object.entries(criteria.value)) {
    const value = (record.current_criteria?.[name] as 'in' | 'out') || 'TODO';
    // An inclusion is stored with every criterion "in", exclusion criteria
    // too; on the checklist an exclusion criterion that does not apply is
    // simply unmarked.
    decisions[name] =
      value === 'in' && criterion.criterion_type === 'exclusion_criterion' ? 'TODO' : value;
  }
  return decisions;
}

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
      const newRecords: ScreenEnrichedRecord[] = response.records.map((record) => ({
        ...record,
        _decision: 'undecided' as DecisionState,
        _criteriaDecisions: criteriaDecisionsOf(record),
      }));
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

// Decisions are optimistic — see the note above `makeDecision` in
// PrescreenPage.vue. Navigation must not wait on the serial RPC pipe; the
// write is flushed on a background chain that preserves click order, and
// only the final decision of a queue (which decides what the screen shows
// next) is awaited.

/** Serializes the background writes so decisions reach the backend in order. */
let decisionChain: Promise<void> = Promise.resolve();
/** Remaining count from the most recent successful `screen_record`. */
let lastRemainingCount: number | null = null;
/** Writes queued or in flight. The server's `remaining_count` describes the
 * tree as of *that* write, so adopting it while later decisions are still
 * queued would bounce the "remaining" badge back up; the optimistic count is
 * the accurate one until the chain drains. */
let pendingWrites = 0;

function revertDecision(recordId: string, guard: { isCurrent: () => boolean }) {
  if (!guard.isCurrent()) return;
  const queued = queue.value.find((r) => r.id === recordId);
  if (queued) queued._decision = 'undecided';
  const historyIndex = decisionHistory.value.findIndex((r) => r.id === recordId);
  if (historyIndex !== -1) decisionHistory.value.splice(historyIndex, 1);
  totalCount.value += 1;
  allDecisionsMade.value = false;
}

/** Resolves true when the decision reached the backend, false when it was
 * rolled back. Never rejects — the chain must survive a failed write. */
function flushDecision(
  recordId: string,
  decision: 'include' | 'exclude',
  criteriaDecisions: Record<string, 'in' | 'out'>,
  guard: { isCurrent: () => boolean },
): Promise<boolean> {
  const projectId = projects.currentProjectId!;
  const taskId = managedTask.value?.id;
  pendingWrites += 1;
  const run = decisionChain.then(async () => {
    try {
      if (!guard.isCurrent()) return false;
      const response = await backend.call('screen_record', {
        project_id: projectId,
        record_id: recordId,
        decision,
        criteria_decisions:
          Object.keys(criteriaDecisions).length > 0 ? criteriaDecisions : undefined,
        task_id: taskId,
      });
      if (response.success) {
        lastRemainingCount = response.remaining_count;
        if (guard.isCurrent() && pendingWrites === 1) {
          totalCount.value = response.remaining_count;
        }
        return true;
      }
      revertDecision(recordId, guard);
      return false;
    } catch (err) {
      revertDecision(recordId, guard);
      notifications.error('Decision failed', err instanceof Error ? err.message : 'Unknown error');
      return false;
    } finally {
      pendingWrites -= 1;
    }
  });
  decisionChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isDeciding.value) return;
  if (isCurrentDecided.value) return;

  const record = currentRecord.value;
  const criteriaDecisions: Record<string, 'in' | 'out'> = {};
  if (hasCriteria.value) {
    for (const [name, value] of Object.entries(record._criteriaDecisions)) {
      if (value !== 'TODO') criteriaDecisions[name] = value;
    }
  }

  const guard = projectData.snapshot();

  record._decision = decision === 'include' ? 'included' : 'excluded';
  decisionHistory.value.push({ ...record });
  totalCount.value = Math.max(0, totalCount.value - 1);

  const flushed = flushDecision(record.id, decision, criteriaDecisions, guard);

  if (nextUndecidedIndex.value !== -1) {
    currentIndex.value = nextUndecidedIndex.value;
    return;
  }

  // Last record in the queue: what the screen shows next depends on backend
  // facts, so this is the one decision the user waits on.
  isDeciding.value = true;
  try {
    if (!(await flushed)) return; // rolled back — stay on the record
    if (!guard.isCurrent()) return;
    if ((lastRemainingCount ?? 0) > 0) {
      await loadQueue();
    } else {
      // Queue exhausted — flush the seam immediately so the completion
      // screen renders fresh counts (the debounced write refresh would
      // land a beat too late).
      queue.value = [];
      await projectData.refreshNow();
      allDecisionsMade.value = true;
    }
  } finally {
    isDeciding.value = false;
  }
}

function confirmCriteriaDecision(decision: 'include' | 'exclude') {
  if (isDeciding.value || isReadOnly.value) return;
  if (decision === 'include' && !canInclude.value) return;
  if (decision === 'exclude' && !canExclude.value) return;
  if (mode.value === 'edit') reviseDecision(decision);
  else if (!isCurrentDecided.value) makeDecision(decision);
}

// --- Edit mode ---

// Every decided record, not a page of them: the queue map is bounded by
// width, not by queue length.
const EDIT_QUEUE_LIMIT = 100_000;

async function enterEditMode() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  reviewIndexBeforeEdit = currentIndex.value;
  mode.value = 'edit';
  editQueue.value = [];
  currentIndex.value = 0;
  await loadEditQueue();
}

async function loadEditQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  isLoadingEditQueue.value = true;
  const guard = projectData.snapshot();
  try {
    const response = await backend.call('get_screen_queue', {
      project_id: projects.currentProjectId,
      limit: EDIT_QUEUE_LIMIT,
      task_id: managedTask.value?.id,
      decided: true,
    });
    if (!guard.isCurrent() || mode.value !== 'edit') return;
    criteria.value = response.criteria || {};
    savedEdits.clear();
    editQueue.value = response.records.map((record) => {
      const decision: DecisionState = record.decision === 'include' ? 'included' : 'excluded';
      const criteriaDecisions = criteriaDecisionsOf(record);
      savedEdits.set(record.id, { decision, criteria: { ...criteriaDecisions } });
      return { ...record, _decision: decision, _criteriaDecisions: criteriaDecisions };
    });
    currentIndex.value = 0;
  } catch (err) {
    notifications.error(
      'Failed to load decisions',
      err instanceof Error ? err.message : 'Unknown error',
    );
    if (guard.isCurrent()) await exitEditMode();
  } finally {
    isLoadingEditQueue.value = false;
  }
}

/** Change the decision (or an exclusion's criteria) on the current record and
 * move on, as reviewing does. Optimistic, on the same ordered write chain as
 * first decisions. */
function reviseDecision(decision: 'include' | 'exclude') {
  const record = currentRecord.value;
  const saved = record && savedEdits.get(record.id);
  if (!record || !saved) return;

  const target: DecisionState = decision === 'include' ? 'included' : 'excluded';
  const criteriaChanged =
    decision === 'exclude' &&
    formatCriteriaString(record._criteriaDecisions) !== formatCriteriaString(saved.criteria);
  if (saved.decision !== target || criteriaChanged) {
    const criteriaDecisions: Record<string, 'in' | 'out'> = {};
    for (const [name, value] of Object.entries(record._criteriaDecisions)) {
      if (value !== 'TODO') criteriaDecisions[name] = value;
    }
    // Mirror what the inclusion stores (see criteriaDecisionsOf).
    if (decision === 'include') {
      for (const [name, criterion] of Object.entries(criteria.value)) {
        record._criteriaDecisions[name] =
          criterion.criterion_type === 'exclusion_criterion' ? 'TODO' : 'in';
      }
    }
    record._decision = target;
    savedEdits.set(record.id, { decision: target, criteria: { ...record._criteriaDecisions } });
    flushRevision(record, decision, criteriaDecisions, saved, projectData.snapshot());
  }
  if (currentIndex.value < activeQueue.value.length - 1) currentIndex.value += 1;
}

function flushRevision(
  record: ScreenEnrichedRecord,
  decision: 'include' | 'exclude',
  criteriaDecisions: Record<string, 'in' | 'out'>,
  previous: { decision: DecisionState; criteria: Record<string, CriterionDecision> },
  guard: { isCurrent: () => boolean },
) {
  const projectId = projects.currentProjectId!;
  const applied = savedEdits.get(record.id);
  const rollBack = (message: string) => {
    if (guard.isCurrent() && savedEdits.get(record.id) === applied) {
      record._decision = previous.decision;
      record._criteriaDecisions = { ...previous.criteria };
      savedEdits.set(record.id, previous);
    }
    notifications.error('Decision change failed', message);
  };
  const run = decisionChain.then(async () => {
    if (!guard.isCurrent()) return;
    try {
      const response = await backend.call('update_screen_decisions', {
        project_id: projectId,
        changes: [{ record_id: record.id, decision, criteria_decisions: criteriaDecisions }],
      });
      const skipped = response.skipped.find((s) => s.record_id === record.id);
      if (skipped) rollBack(`${record.id}: ${skipped.reason}`);
    } catch (err) {
      rollBack(err instanceof Error ? err.message : 'Unknown error');
    }
  });
  decisionChain = run.then(
    () => undefined,
    () => undefined,
  );
}

async function exitEditMode() {
  // Carry revised decisions back into the review walkthrough's own copies.
  const revised = new Map(editQueue.value.map((r) => [r.id, r]));
  for (const r of [...queue.value, ...decisionHistory.value]) {
    const edited = revised.get(r.id);
    if (!edited) continue;
    r._decision = edited._decision;
    r._criteriaDecisions = { ...edited._criteriaDecisions };
  }
  editQueue.value = [];
  savedEdits.clear();
  currentIndex.value = Math.min(reviewIndexBeforeEdit, Math.max(0, queue.value.length - 1));
  mode.value = isScreenComplete.value ? 'complete' : 'screening';
  // The completion screen reads server-side counts: refresh once the
  // revisions have landed.
  await decisionChain;
  await projectData.refreshNow();
}

function toggleCriterion(name: string, value: 'in' | 'out' | 'TODO') {
  if (!currentRecord.value) return;
  currentRecord.value._criteriaDecisions[name] = value;
}

function goToRecord(index: number) {
  if (index >= 0 && index < activeQueue.value.length) currentIndex.value = index;
}

function skipToNextUndecided() {
  if (nextUndecidedIndex.value !== -1) currentIndex.value = nextUndecidedIndex.value;
}

const isJumpOpen = ref(false);

const jumpItems = computed(() =>
  activeQueue.value.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    year: r.year,
    decision: r._decision,
  })),
);

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (mode.value === 'complete') return;

  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
    if (activeQueue.value.length === 0) return;
    e.preventDefault();
    isJumpOpen.value = !isJumpOpen.value;
    return;
  }

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (currentIndex.value > 0) currentIndex.value -= 1;
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (currentIndex.value < activeQueue.value.length - 1) currentIndex.value += 1;
      break;
  }
}

async function handlePdfsImported() {
  // A zip import placed new PDFs on disk — queue items that showed
  // "No PDF available" may now have files. Store-level state refreshes via
  // the invalidation seam; the queue is page-owned so reload it here.
  await loadQueue();
}

/**
 * Arrange branch access and load the queue.
 *
 * `isArrangingAccess` guards against doing it twice: checking out the
 * reviewer branch replaces the working tree, which fires
 * `project-data-changed` with `full: true` — whose handler is this same
 * function. See the matching note in PrescreenPage.vue.
 */
let isArrangingAccess = false;

async function arrangeAccessAndLoad(): Promise<void> {
  if (isArrangingAccess) return;
  isArrangingAccess = true;
  try {
    const canLoadQueue = await ensureManagedTaskAccess();
    if (canLoadQueue) {
      await loadQueue();
    } else {
      queue.value = [];
      totalCount.value = 0;
    }
  } finally {
    isArrangingAccess = false;
  }
}

// Full invalidations (pull, reset, merge, backend restart) replace the
// working tree — discard walkthrough state and rebuild the queue.
useProjectDataChanged(async (event) => {
  if (!event.full) return;
  // A branch switch invalidates through this same seam. When someone else is
  // driving it — the workflow stepper heading for reconcile, the router guard
  // leaving a reviewer branch — re-running the access check here would switch
  // straight back and fight them for the branch.
  if (git.isSwitchingBranch) return;
  // …and when *we* are driving it, the pass already underway will load the
  // queue; re-entering here would do the whole sequence a second time.
  if (isArrangingAccess) return;
  decisionHistory.value = [];
  editQueue.value = [];
  savedEdits.clear();
  if (mode.value === 'edit') mode.value = 'screening';
  await arrangeAccessAndLoad();
});

onMounted(async () => {
  try {
    await reviewDefStore.loadDefinition();
    await arrangeAccessAndLoad();
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

    <!-- Edit mode: loading / nothing decided yet. With records it is the
         split panel below. -->
    <div
      v-if="mode === 'edit' && isLoadingEditQueue"
      class="flex-1 flex items-center justify-center"
      data-testid="screen-edit-loading"
    >
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <EmptyState
      v-else-if="mode === 'edit' && editQueue.length === 0"
      :icon="Pencil"
      title="No decisions to edit"
      description="Records you include or exclude in screening appear here."
    >
      <template #action>
        <Button size="sm" data-testid="screen-edit-done-btn" @click="exitEditMode">
          <Check class="h-4 w-4 mr-1.5" />
          Done
        </Button>
      </template>
    </EmptyState>

    <ScreenComplete
      v-else-if="mode === 'complete' || (mode !== 'edit' && !isLoading && queue.length === 0 && isScreenComplete)"
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
      v-else-if="mode !== 'edit' && !isLoading && loadError"
      title="Failed to load screening queue"
      :message="loadError"
      test-id="screen-load-error"
      @retry="loadQueue"
    />

    <div
      v-else-if="mode !== 'edit' && !isLoading && queue.length === 0 && !isScreenComplete && pdfPreparedCount === 0"
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

    <div v-else-if="mode !== 'edit' && isLoading" class="flex-1 flex items-center justify-center">
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <EmptyState
      v-else-if="!hasCriteria"
      :icon="CheckSquare"
      title="No screening criteria defined"
      description="Add screening criteria on the Screen Launch page before starting. Criteria can only be defined on the dev branch and are frozen once a managed task is active."
    />

    <EmptyState
      v-else-if="mode !== 'edit' && !isLoading && queue.length === 0"
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
          :queue-records="activeQueue"
          :current-index="currentIndex"
          :read-only="isReadOnly"
          @toggle-criterion="toggleCriterion"
          @confirm-decision="confirmCriteriaDecision"
          @skip-to-next-undecided="skipToNextUndecided"
          @enter-edit-mode="enterEditMode"
          @exit-edit-mode="exitEditMode"
          @navigate="goToRecord"
        />
      </template>
    </ScreenSplitPanel>

    <QueueJumpDialog
      v-model:open="isJumpOpen"
      :items="jumpItems"
      :current-index="currentIndex"
      test-id-prefix="screen"
      @jump="goToRecord"
    />
    </template>
  </div>
</template>
