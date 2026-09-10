<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  Filter,
  Check,
  X,
  Loader2,
  CircleCheck,
  Pencil,
  Search,
  ArrowRight,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  EmptyState,
  LoadErrorState,
  QueueFilmstrip,
  QueueJumpDialog,
  QueueMap,
} from '@/components/common';
import DecisionButtons from '@/components/prescreen/DecisionButtons.vue';
import RecordCard from '@/components/prescreen/RecordCard.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectsStore } from '@/stores/projects';
import { isReviewStepComplete } from '@/lib/stepStatus';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useSyncStore } from '@/stores/sync';
import { useManagedReviewStore } from '@/stores/managedReview';
import { useNotificationsStore } from '@/stores/notifications';
import { usePendingChangesStore } from '@/stores/pendingChanges';
import { useManagedTaskAccess } from '@/composables/useManagedTaskAccess';
import { useProjectDataChanged } from '@/composables/useProjectDataChanged';
import { useReadOnly } from '@/composables/useReadOnly';
import { useReconcileGate } from '@/composables/useReconcileGate';
import { useWalkthroughNavigation } from '@/composables/useWalkthroughNavigation';
import { useProjectDataStore } from '@/stores/projectData';
import type {
  PrescreenQueueRecord,
} from '@/types/generated/rpc';

// Enrichment status tracking
type EnrichmentStatus = 'pending' | 'loading' | 'complete' | 'failed';
type DecisionState = 'undecided' | 'included' | 'excluded';

interface EnrichedRecord extends PrescreenQueueRecord {
  _enrichmentStatus: EnrichmentStatus;
  _decision: DecisionState;
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
const sync = useSyncStore();
const managedReview = useManagedReviewStore();
const notifications = useNotificationsStore();
const pending = usePendingChangesStore();
const projectData = useProjectDataStore();
const { isReadOnly } = useReadOnly();

const isSavingToRemote = ref(false);
const isPageReady = ref(false);
const hasUnsavedWork = computed(() => isPageReady.value && (git.ahead > 0 || pending.hasPending));
const { canNavigateToReconcile } = useReconcileGate({ ready: isPageReady });

async function saveToRemote() {
  if (isSavingToRemote.value) return;
  isSavingToRemote.value = true;
  try {
    if (pending.hasPending) {
      const committed = await pending.commit('Save changes');
      if (!committed) return;
      await git.refreshStatus();
    }
    if (git.hasRemote && git.ahead > 0) {
      await sync.pushNow();
    }
  } finally {
    isSavingToRemote.value = false;
  }
}

const queue = ref<EnrichedRecord[]>([]);
const decisionHistory = ref<EnrichedRecord[]>([]);
const totalCount = ref(0);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
// True only while the *last* decision of a queue is being flushed, i.e. the
// one moment the user has to wait for the backend (the completion screen
// reports server-side counts). Every other decision is optimistic.
const isFinishing = ref(false);
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
} = useManagedTaskAccess('prescreen');
const allDecisionsMade = ref(false);

// Decision debounce to prevent duplicate notifications
const lastDecisionTime = ref(0);

// Number of records to prefetch per batch in background
const PREFETCH_BATCH_SIZE = 10;

// Abort controller for cancelling ongoing background enrichment
let enrichmentAbortController: AbortController | null = null;

// --- Edit mode state ---
interface EditRecord {
  id: string;
  title: string;
  author: string;
  year: string;
  originalDecision: 'include' | 'exclude';
  newDecision: 'include' | 'exclude';
}

const isEditMode = ref(false);
const editRecords = ref<EditRecord[]>([]);
const editSearchText = ref('');
const isLoadingEditRecords = ref(false);
const isSavingEdits = ref(false);

const isJumpOpen = ref(false);

// The queue holds only what is loaded, so the palette searches that. Records
// still on the server are reached by working forward, as they always were.
const jumpItems = computed(() =>
  queue.value.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    year: r.year,
    decision: r._decision,
  })),
);

function onJumpShortcut(e: KeyboardEvent) {
  if (e.key !== 'k' || !(e.metaKey || e.ctrlKey)) return;
  if (isEditMode.value || queue.value.length === 0) return;
  e.preventDefault();
  isJumpOpen.value = !isJumpOpen.value;
}

const filteredEditRecords = computed(() => {
  if (!editSearchText.value) return editRecords.value;
  const q = editSearchText.value.toLowerCase();
  return editRecords.value.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      r.author.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q),
  );
});

const editChangesCount = computed(
  () => editRecords.value.filter((r) => r.newDecision !== r.originalDecision).length,
);

const {
  currentIndex,
  currentItem: currentRecord,
  nextUndecidedIndex,
  goTo: goToRecord,
  next: nextRecord,
  prev: prevRecord,
  skipToNextUndecided,
} = useWalkthroughNavigation<EnrichedRecord>({
  items: queue,
  isUndecided: (r) => r._decision === 'undecided',
  shouldHandleKey: () => !isEditMode.value,
  onArrowLeft: () => {
    if (!isCurrentDecided.value && currentRecord.value && isCurrentRecordReady.value) {
      makeDecision('exclude');
    }
  },
  onArrowRight: () => {
    if (!isCurrentDecided.value && currentRecord.value && isCurrentRecordReady.value) {
      makeDecision('include');
    }
  },
});
const managedAccessTitle = computed(() => {
  if (!activeManagedTask.value) return 'Prescreen is unavailable';
  if (assignedReviewer.value) return 'Switching to your review assignment failed';
  return 'Managed prescreen is active';
});
const managedAccessDescription = computed(() => {
  if (!activeManagedTask.value) {
    return 'No managed prescreen branch is available for the current session.';
  }
  if (assignedReviewer.value) {
    return `This task is assigned to you on ${assignedReviewer.value.branch_name}. Prescreen work happens only on reviewer branches, not on dev.`;
  }
  return `Task ${activeManagedTask.value.id} is currently assigned to ${activeManagedTask.value.reviewers.map((reviewer) => reviewer.github_login).join(' and ')}. Prescreen decisions should only be made from reviewer branches.`;
});

// Decision tracking
const decidedCount = computed(() => queue.value.filter((r) => r._decision !== 'undecided').length);

const overallTotal = computed(() => decidedCount.value + totalCount.value);

const includedCount = computed(() => queue.value.filter((r) => r._decision === 'included').length);

const excludedCount = computed(() => queue.value.filter((r) => r._decision === 'excluded').length);

const isCurrentDecided = computed(() => currentRecord.value !== null && currentRecord.value._decision !== 'undecided');

// In managed-review mode, abstracts were pre-fetched on dev before the task
// was launched, so the reviewer branch should never re-fetch. Re-fetching
// would write non-task metadata (abstract/journal/etc.) to the reviewer
// branch and block reconciliation.
const skipEnrichment = computed(() => props.embedded);

// Completion detection from the shared status derivation (for when user
// navigates back after finishing)
const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const isPrescreenComplete = computed(() => {
  // Local flag set immediately when the last decision is made — no refresh needed
  if (allDecisionsMade.value) return true;
  return isReviewStepComplete(projects.payloadSteps?.prescreen);
});

// Check if current record is ready to display (has abstract or enrichment complete/failed)
const isCurrentRecordReady = computed(() => {
  const record = currentRecord.value;
  if (!record) return false;
  return (
    record.abstract ||
    record._enrichmentStatus === 'complete' ||
    record._enrichmentStatus === 'failed' ||
    !record.can_enrich
  );
});

// Check if next record is ready
const isNextRecordReady = computed(() => {
  const nextRecord = queue.value[currentIndex.value + 1];
  if (!nextRecord) return true;
  return (
    nextRecord.abstract ||
    nextRecord._enrichmentStatus === 'complete' ||
    nextRecord._enrichmentStatus === 'failed' ||
    !nextRecord.can_enrich
  );
});

// --- Data loading ---

async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  loadError.value = null;
  const guard = projectData.snapshot();
  try {
    const response = await backend.call('get_prescreen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
      task_id: managedTask.value?.id,
    });
    // Project/branch switch mid-flight: this response belongs to the old
    // context — never paint it into the new view.
    if (!guard.isCurrent()) return;
    if (response.success) {
      const newRecords: EnrichedRecord[] = response.records.map((record) => ({
        ...record,
        _enrichmentStatus: record.abstract
          ? 'complete'
          : skipEnrichment.value
            ? ('failed' as EnrichmentStatus)
            : record.can_enrich
              ? 'pending'
              : ('complete' as EnrichmentStatus),
        _decision: 'undecided' as DecisionState,
      }));

      // Prepend history from previous loads so user can navigate back
      const history = decisionHistory.value;
      queue.value = [...history, ...newRecords];
      totalCount.value = response.total_count;
      currentIndex.value = history.length; // Jump to first new record

      // Start background enrichment for first batch
      startBackgroundEnrichment();
    }
  } catch (err) {
    if (guard.isCurrent()) {
      loadError.value = err instanceof Error ? err.message : 'Unknown error';
    }
  } finally {
    isLoading.value = false;
  }
}

async function startBackgroundEnrichment() {
  if (skipEnrichment.value) return;
  // Cancel any previous enrichment loop
  if (enrichmentAbortController) {
    enrichmentAbortController.abort();
  }
  enrichmentAbortController = new AbortController();
  const signal = enrichmentAbortController.signal;

  while (!signal.aborted) {
    const recordsToEnrich = queue.value
      .filter((r) => r._enrichmentStatus === 'pending')
      .slice(0, PREFETCH_BATCH_SIZE)
      .map((r) => r.id);

    if (recordsToEnrich.length === 0) break;

    recordsToEnrich.forEach((id) => {
      const record = queue.value.find((r) => r.id === id);
      if (record) record._enrichmentStatus = 'loading';
    });

    try {
      const response = await backend.call('batch_enrich_records', {
        project_id: projects.currentProjectId!,
        record_ids: recordsToEnrich,
      });

      if (signal.aborted) break;

      if (response.success) {
        for (const result of response.records) {
          const queueRecord = queue.value.find((r) => r.id === result.id);
          const enriched = result.record;
          if (queueRecord && enriched) {
            queueRecord.abstract = enriched.abstract;
            queueRecord.can_enrich = false;
            queueRecord._enrichmentStatus = result.success ? 'complete' : 'failed';
          } else if (queueRecord) {
            queueRecord._enrichmentStatus = 'failed';
          }
        }
      }
    } catch (err) {
      if (signal.aborted) break;
      console.error('Background enrichment batch failed:', err);
      recordsToEnrich.forEach((id) => {
        const record = queue.value.find((r) => r.id === id);
        if (record && record._enrichmentStatus === 'loading') {
          record._enrichmentStatus = 'failed';
        }
      });
      break; // Stop loop on error to avoid hammering a failing API
    }
  }
}

async function enrichSingleRecord(recordId: string) {
  const record = queue.value.find((r) => r.id === recordId);
  if (!record || record._enrichmentStatus !== 'pending') return;
  if (skipEnrichment.value) {
    record._enrichmentStatus = 'failed';
    return;
  }

  record._enrichmentStatus = 'loading';

  try {
    const response = await backend.call('enrich_record_metadata', {
      project_id: projects.currentProjectId!,
      record_id: recordId,
    });

    if (response.success && response.record) {
      record.abstract = response.record.abstract;
      record.can_enrich = false;
      record._enrichmentStatus = 'complete';
    } else {
      record._enrichmentStatus = 'failed';
    }
  } catch (err) {
    console.error(`Failed to enrich record ${recordId}:`, err);
    record._enrichmentStatus = 'failed';
  }
}

// Watch for index changes to prefetch next record
watch(currentIndex, async (newIndex) => {
  // The makeDecision debounce only guards same-record double-fires
  // (simultaneous click + keypress); reset when the active record changes.
  lastDecisionTime.value = 0;

  const nextRecord = queue.value[newIndex + 1];
  if (nextRecord && nextRecord._enrichmentStatus === 'pending') {
    await enrichSingleRecord(nextRecord.id);
  }

  const current = queue.value[newIndex];
  if (current && current._enrichmentStatus === 'pending') {
    await enrichSingleRecord(current.id);
  }
});

// --- Decision persistence ---------------------------------------------------
//
// Advancing to the next record does not wait for the backend. The RPC pipe is
// strictly serial (one Python request at a time, behind the main-process git
// mutex), and a decision drags a refresh tail behind it — so awaiting the
// round trip put 1-3s between the click and the next abstract even on an
// eight-record queue. The decision is applied to the local queue and the
// walkthrough advances immediately; the write is flushed on a background
// chain that preserves click order.
//
// The user reads the next abstract while that happens, which is the budget
// this trades against. Two things still wait for the backend: the last
// decision of a queue (the completion screen shows server-side counts) and
// any failure, which rolls the record back to undecided.

/** Serializes the background writes so decisions reach the backend in order. */
let decisionChain: Promise<void> = Promise.resolve();
/** Remaining count from the most recent successful `prescreen_record`. */
let lastRemainingCount: number | null = null;
/** Writes queued or in flight. The server's `remaining_count` describes the
 * tree as of *that* write, so adopting it while later decisions are still
 * queued would bounce the "remaining" badge back up; the optimistic count is
 * the accurate one until the chain drains. */
let pendingWrites = 0;

/** Resolves true when the decision reached the backend, false when it was
 * rolled back. Never rejects — the chain must survive a failed write. */
function flushDecision(
  record: EnrichedRecord,
  decision: 'include' | 'exclude',
  guard: { isCurrent: () => boolean },
): Promise<boolean> {
  const projectId = projects.currentProjectId!;
  const taskId = managedTask.value?.id;
  pendingWrites += 1;
  const run = decisionChain.then(async () => {
    try {
      // The project or branch moved on while this write was queued: the record
      // it names belongs to a tree that is no longer on screen.
      if (!guard.isCurrent()) return false;
      const response = await backend.call('prescreen_record', {
        project_id: projectId,
        record_id: record.id,
        decision,
        task_id: taskId,
      });
      if (response.success) {
        lastRemainingCount = response.remaining_count;
        if (guard.isCurrent() && pendingWrites === 1) {
          totalCount.value = response.remaining_count;
        }
        return true;
      }
      revertDecision(record, guard);
      return false;
    } catch (err) {
      revertDecision(record, guard);
      notifications.error(
        'Decision failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
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

/** Put an optimistically-applied decision back to undecided after a failure. */
function revertDecision(record: EnrichedRecord, guard: { isCurrent: () => boolean }) {
  if (!guard.isCurrent()) return;
  const queued = queue.value.find((r) => r.id === record.id);
  if (queued) queued._decision = 'undecided';
  const historyIndex = decisionHistory.value.findIndex((r) => r.id === record.id);
  if (historyIndex !== -1) decisionHistory.value.splice(historyIndex, 1);
  totalCount.value += 1;
  allDecisionsMade.value = false;
}

async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isFinishing.value) return;
  if (isCurrentDecided.value) return;
  // Debounce: prevent duplicate calls from simultaneous keyboard + click events
  const now = Date.now();
  if (now - lastDecisionTime.value < 500) return;
  lastDecisionTime.value = now;

  const record = currentRecord.value;
  const guard = projectData.snapshot();

  // Optimistic: the UI moves now, the write catches up.
  record._decision = decision === 'include' ? 'included' : 'excluded';
  decisionHistory.value.push({ ...record });
  totalCount.value = Math.max(0, totalCount.value - 1);

  const flushed = flushDecision(record, decision, guard);

  if (nextUndecidedIndex.value !== -1) {
    currentIndex.value = nextUndecidedIndex.value;
    return;
  }

  // Last record in the queue: from here the screen depends on backend facts
  // (is there another page of records? what are the final counts?), so this
  // is the one decision the user waits on.
  isFinishing.value = true;
  try {
    // The write failed and rolled back — stay on the record.
    if (!(await flushed)) return;
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
    isFinishing.value = false;
  }
}

// --- Edit mode functions ---

async function enterEditMode() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isEditMode.value = true;
  isLoadingEditRecords.value = true;
  editSearchText.value = '';

  try {
    const response = await backend.call('get_records', {
      project_id: projects.currentProjectId,
      filters: { status: ['rev_prescreen_included', 'rev_prescreen_excluded'] },
      pagination: { offset: 0, limit: 500 },
      fields: ['ID', 'title', 'author', 'year', 'colrev_status'],
    });

    if (response.success) {
      const editableRecords = managedTask.value
        ? response.records.filter((r: any) => managedTask.value?.record_ids.includes(r.ID))
        : response.records;

      editRecords.value = editableRecords.map((r: any) => {
        const isIncluded = r.colrev_status === 'rev_prescreen_included';
        return {
          id: r.ID,
          title: r.title || '',
          author: r.author || '',
          year: r.year || '',
          originalDecision: isIncluded ? 'include' : 'exclude',
          newDecision: isIncluded ? 'include' : 'exclude',
        } as EditRecord;
      });
    }
  } catch (err) {
    console.error('Failed to load records for edit mode:', err);
    notifications.error('Failed to load records', err instanceof Error ? err.message : 'Unknown error');
    isEditMode.value = false;
  } finally {
    isLoadingEditRecords.value = false;
  }
}

function toggleDecision(recordId: string) {
  const record = editRecords.value.find((r) => r.id === recordId);
  if (!record) return;
  record.newDecision = record.newDecision === 'include' ? 'exclude' : 'include';
}

async function saveEdits() {
  if (!projects.currentProjectId || isSavingEdits.value) return;

  const changed = editRecords.value.filter((r) => r.newDecision !== r.originalDecision);
  if (changed.length === 0) return;

  isSavingEdits.value = true;
  try {
    const response = await backend.call(
      'update_prescreen_decisions',
      {
        project_id: projects.currentProjectId,
        changes: changed.map((r) => ({
          record_id: r.id,
          decision: r.newDecision,
        })),
      },
    );

    if (response.success) {
      notifications.success(
        'Decisions updated',
        `${response.changes_count} record(s) updated`,
      );
      isEditMode.value = false;
      editRecords.value = [];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Save failed', message);
  } finally {
    isSavingEdits.value = false;
  }
}

function cancelEdits() {
  isEditMode.value = false;
  editRecords.value = [];
  editSearchText.value = '';
}


/**
 * Arrange branch access and load the queue.
 *
 * `isArrangingAccess` exists because `ensureManagedTaskAccess` can *cause* a
 * full invalidation: checking out the reviewer branch replaces the working
 * tree, which fires `project-data-changed` with `full: true`, whose handler
 * is this same function. Without the guard, entering prescreen ran the whole
 * sequence twice — access probe, branch checkout, queue load — on a serial
 * pipe, for no new information.
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
// working tree — discard walkthrough state and rebuild the queue. Regular
// write events are ignored: the in-progress queue is self-managed and store
// counts refresh through the seam.
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
  allDecisionsMade.value = false;
  await arrangeAccessAndLoad();
});

onMounted(async () => {
  window.addEventListener('keydown', onJumpShortcut);
  try {
    await arrangeAccessAndLoad();
  } finally {
    await git.refreshStatus();
    isPageReady.value = true;
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onJumpShortcut);
  if (enrichmentAbortController) {
    enrichmentAbortController.abort();
  }
});

</script>

<template>
  <div class="p-6 h-full flex flex-col" data-testid="prescreen-page">
    <div
      v-if="accessState === 'switching'"
      class="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
    >
      <div class="flex items-center gap-2">
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        <span class="text-muted-foreground">Setting up your review queue...</span>
      </div>
    </div>
    <EmptyState
      v-if="isManagedAccessBlocked"
      :icon="Filter"
      :title="managedAccessTitle"
      :description="managedAccessDescription"
    />
    <div
      v-else-if="!isPageReady"
      class="flex-1 flex items-center justify-center"
      data-testid="prescreen-loading"
    >
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
    <template v-else>
    <!-- Zone 1: Header + Stats -->
    <div class="flex items-center justify-between mb-3">
      <div v-if="!embedded" class="flex items-center gap-2">
        <Filter class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-xl font-semibold" data-testid="prescreen-title">Prescreen</h2>
      </div>
      <div v-else />

      <div v-if="queue.length > 0" class="flex items-center gap-3">
        <Badge variant="secondary" class="px-2.5 py-0.5" data-testid="prescreen-included-count">
          <Check class="h-3 w-3 mr-1" />
          {{ includedCount }}
        </Badge>
        <Badge variant="outline" class="px-2.5 py-0.5" data-testid="prescreen-excluded-count">
          <X class="h-3 w-3 mr-1" />
          {{ excludedCount }}
        </Badge>
        <Badge variant="secondary" class="px-2.5 py-0.5" data-testid="prescreen-remaining-count">
          {{ totalCount }} remaining
        </Badge>
      </div>
    </div>

    <Separator class="mb-3" />

    <!-- Edit mode -->
    <div
      v-if="isEditMode"
      class="flex-1 flex flex-col min-h-0"
      data-testid="prescreen-edit-mode"
    >
      <!-- Edit mode header -->
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-medium">Edit Prescreen Decisions</h3>
          <Badge v-if="editChangesCount > 0" variant="secondary" class="px-2 py-0.5">
            {{ editChangesCount }} change{{ editChangesCount !== 1 ? 's' : '' }}
          </Badge>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            data-testid="prescreen-edit-cancel-btn"
            @click="cancelEdits"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="prescreen-edit-save-btn"
            :disabled="editChangesCount === 0 || isSavingEdits || isReadOnly"
            @click="saveEdits"
          >
            <Loader2 v-if="isSavingEdits" class="h-4 w-4 mr-1.5 animate-spin" />
            Save {{ editChangesCount }} change{{ editChangesCount !== 1 ? 's' : '' }}
          </Button>
        </div>
      </div>

      <!-- Search input -->
      <div class="relative mb-3">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          v-model="editSearchText"
          placeholder="Filter by title, author, or ID..."
          class="pl-9"
          data-testid="prescreen-edit-search"
        />
      </div>

      <!-- Loading state -->
      <div v-if="isLoadingEditRecords" class="flex-1 flex items-center justify-center">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <!-- Records table -->
      <ScrollArea v-else class="flex-1">
        <Table class="table-fixed w-full">
          <TableHeader>
            <TableRow>
              <TableHead class="w-[45%]">Title</TableHead>
              <TableHead class="w-[25%]">Authors</TableHead>
              <TableHead class="w-[50px]">Year</TableHead>
              <TableHead class="w-[110px] text-right">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="record in filteredEditRecords"
              :key="record.id"
              :class="{ 'bg-muted/50': record.newDecision !== record.originalDecision }"
              :data-testid="`prescreen-edit-row-${record.id}`"
            >
              <TableCell class="overflow-hidden">
                <div class="font-medium text-sm leading-tight truncate">{{ record.title }}</div>
                <div class="text-xs text-muted-foreground font-mono mt-0.5 truncate">{{ record.id }}</div>
              </TableCell>
              <TableCell class="text-sm overflow-hidden">
                <span class="block truncate">{{ record.author }}</span>
              </TableCell>
              <TableCell class="text-sm">{{ record.year }}</TableCell>
              <TableCell class="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  :class="
                    record.newDecision === 'include'
                      ? 'border-green-600/50 text-green-500 hover:bg-green-600/10'
                      : 'border-destructive/50 text-red-400 hover:bg-destructive/10'
                  "
                  :data-testid="`prescreen-edit-toggle-${record.id}`"
                  @click="toggleDecision(record.id)"
                >
                  <Check v-if="record.newDecision === 'include'" class="h-3.5 w-3.5 mr-1" />
                  <X v-else class="h-3.5 w-3.5 mr-1" />
                  {{ record.newDecision === 'include' ? 'Included' : 'Excluded' }}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ScrollArea>
    </div>

    <!-- Completion state -->
    <div
      v-else-if="!isLoading && queue.length === 0 && isPrescreenComplete"
      class="flex-1 flex flex-col items-center justify-center text-center"
      data-testid="prescreen-complete"
    >
      <div class="rounded-full bg-green-600/15 p-4 mb-4">
        <CircleCheck class="h-8 w-8 text-green-500" />
      </div>
      <h3 class="text-lg font-medium mb-1">Prescreening complete</h3>
      <p class="text-sm text-muted-foreground mb-6">
        All records have been reviewed.
      </p>

      <div class="flex items-center gap-6">
        <div class="flex flex-col items-center gap-1">
          <span
            class="text-2xl font-semibold text-green-500"
            data-testid="prescreen-complete-included"
          >
            {{ statusCounts?.rev_prescreen_included ?? 0 }}
          </span>
          <span class="text-xs text-muted-foreground flex items-center gap-1">
            <Check class="h-3 w-3" /> Included
          </span>
        </div>
        <Separator orientation="vertical" class="h-10" />
        <div class="flex flex-col items-center gap-1">
          <span
            class="text-2xl font-semibold text-red-400"
            data-testid="prescreen-complete-excluded"
          >
            {{ statusCounts?.rev_prescreen_excluded ?? 0 }}
          </span>
          <span class="text-xs text-muted-foreground flex items-center gap-1">
            <X class="h-3 w-3" /> Excluded
          </span>
        </div>
        <Separator orientation="vertical" class="h-10" />
        <div class="flex flex-col items-center gap-1">
          <span class="text-2xl font-semibold" data-testid="prescreen-complete-total">
            {{
              (statusCounts?.rev_prescreen_included ?? 0) +
              (statusCounts?.rev_prescreen_excluded ?? 0)
            }}
          </span>
          <span class="text-xs text-muted-foreground">Total reviewed</span>
        </div>
      </div>

      <p
        v-if="git.hasRemote && hasUnsavedWork"
        class="text-xs text-amber-500 mt-5"
        data-testid="prescreen-unsaved-hint"
      >
        Your decisions are saved on this device. Push them to the remote so
        collaborators can see your work.
      </p>

      <div class="flex flex-col items-center gap-3 mt-6">
        <Button
          v-if="embedded && canNavigateToReconcile"
          size="lg"
          class="min-w-56"
          data-testid="prescreen-continue-reconcile-btn"
          @click="emit('navigateReconcile')"
        >
          Continue to Reconciliation
          <ArrowRight class="h-4 w-4 ml-1.5" />
        </Button>
        <div class="flex items-center gap-3">
          <Button
            v-if="git.hasRemote && hasUnsavedWork"
            size="sm"
            :disabled="isSavingToRemote"
            data-testid="prescreen-save-to-remote"
            @click="saveToRemote"
          >
            {{ isSavingToRemote ? 'Saving...' : 'Save to remote' }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="prescreen-edit-decisions-btn"
            :disabled="isReadOnly"
            @click="enterEditMode"
          >
            <Pencil class="h-4 w-4 mr-1.5" />
            Edit Decisions
          </Button>
        </div>
      </div>
    </div>

    <!-- Load failure: retry UI, distinguishable from an empty queue -->
    <LoadErrorState
      v-else-if="!isLoading && loadError"
      title="Failed to load prescreen queue"
      :message="loadError"
      test-id="prescreen-load-error"
      @retry="loadQueue"
    />

    <!-- Empty state (no records available yet) -->
    <EmptyState
      v-else-if="!isLoading && queue.length === 0"
      :icon="Filter"
      title="No records to prescreen"
      description="There are no records ready for prescreening yet. Run search & preprocessing first."
    />

    <!-- Screening interface -->
    <div v-else class="flex-1 flex flex-col min-h-0">
      <!-- Queue map: bars are binned, so the node count is bounded by width -->
      <div class="mb-2 flex items-center gap-3">
        <QueueMap
          class="flex-1 min-w-0"
          :items="queue.map((r) => ({ id: r.id, decision: r._decision }))"
          :current-index="currentIndex"
          :decided-count="decidedCount"
          :total-count="overallTotal"
          test-id-prefix="prescreen"
          @seek="goToRecord"
        />
        <Button
          variant="outline"
          size="sm"
          class="shrink-0 self-start"
          data-testid="prescreen-jump-btn"
          @click="isJumpOpen = true"
        >
          <Search class="h-3.5 w-3.5" />
          Jump to record
          <span class="ml-1 text-[11px] text-muted-foreground font-normal">&#8984;K</span>
        </Button>
      </div>

      <!-- Record Card with side-by-side title + decision and abstract -->
      <RecordCard
        v-if="currentRecord"
        :record="currentRecord"
        :can-prev="currentIndex > 0"
        :can-next="currentIndex < queue.length - 1"
        layout="side-by-side"
        test-id-prefix="prescreen"
        @prev="prevRecord"
        @next="nextRecord"
      >
        <template #aside>
          <DecisionButtons
            :decision="currentRecord._decision"
            :disabled="!isCurrentRecordReady || isReadOnly"
            :is-submitting="isFinishing"
            :show-skip-to-next="nextUndecidedIndex !== -1"
            test-id-prefix="prescreen"
            @decide="makeDecision"
            @skip-to-next="skipToNextUndecided"
          />
        </template>
      </RecordCard>

      <QueueFilmstrip
        class="mt-3"
        :items="queue.map((r) => ({ id: r.id, title: r.title, year: r.year, decision: r._decision }))"
        :current-index="currentIndex"
        test-id-prefix="prescreen"
        @seek="goToRecord"
      />
    </div>

    <QueueJumpDialog
      v-model:open="isJumpOpen"
      :items="jumpItems"
      :current-index="currentIndex"
      test-id-prefix="prescreen"
      @jump="goToRecord"
    />
    </template>
  </div>
</template>
