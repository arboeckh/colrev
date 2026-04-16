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
import { EmptyState } from '@/components/common';
import DecisionButtons from '@/components/prescreen/DecisionButtons.vue';
import RecordCard from '@/components/prescreen/RecordCard.vue';
import ProgressTrack from '@/components/prescreen/ProgressTrack.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useManagedReviewStore } from '@/stores/managedReview';
import { useNotificationsStore } from '@/stores/notifications';
import { usePendingChangesStore } from '@/stores/pendingChanges';
import { useReadOnly } from '@/composables/useReadOnly';
import type {
  GetCurrentManagedReviewTaskResponse,
  GetPrescreenQueueResponse,
  GetRecordsResponse,
  ListManagedReviewTasksResponse,
  ManagedReviewTask,
  PrescreenQueueRecord,
  PrescreenRecordResponse,
  EnrichRecordMetadataResponse,
  BatchEnrichRecordsResponse,
  UpdatePrescreenDecisionsResponse,
} from '@/types/api';

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

const auth = useAuthStore();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();
const managedReview = useManagedReviewStore();
const notifications = useNotificationsStore();
const pending = usePendingChangesStore();
const { isReadOnly } = useReadOnly();

const isSavingToRemote = ref(false);
const hasUnsavedWork = computed(() => git.ahead > 0 || pending.hasPending);

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
      await git.push();
    }
  } finally {
    isSavingToRemote.value = false;
  }
}

const queue = ref<EnrichedRecord[]>([]);
const decisionHistory = ref<EnrichedRecord[]>([]);
const totalCount = ref(0);
const isLoading = ref(false);
const currentIndex = ref(0);
const isDeciding = ref(false);
const managedTask = ref<GetCurrentManagedReviewTaskResponse['task']>(null);
const accessState = ref<'loading' | 'switching' | 'ready' | 'blocked'>('loading');
const activeManagedTask = ref<ManagedReviewTask | null>(null);
const assignedReviewerBranch = ref<string | null>(null);
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

const currentRecord = computed(() => queue.value[currentIndex.value] || null);
const assignedReviewer = computed(() => {
  if (!activeManagedTask.value || !auth.user?.login) return null;
  const login = auth.user.login.toLowerCase();
  return activeManagedTask.value.reviewers.find(
    (reviewer) => reviewer.github_login.toLowerCase() === login,
  ) ?? null;
});
const isManagedAccessBlocked = computed(() => accessState.value === 'blocked');
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

const isCurrentDecided = computed(() => currentRecord.value?._decision !== 'undecided');

const nextUndecidedIndex = computed(() => {
  for (let i = currentIndex.value + 1; i < queue.value.length; i++) {
    if (queue.value[i]._decision === 'undecided') return i;
  }
  return -1;
});

// Completion detection from project status (for when user navigates back after finishing)
const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const isPrescreenComplete = computed(() => {
  // Local flag set immediately when the last decision is made — no refresh needed
  if (allDecisionsMade.value) return true;
  if (!statusCounts.value) return false;
  const { rev_prescreen_included, rev_prescreen_excluded, md_processed } = statusCounts.value;
  return md_processed === 0 && (rev_prescreen_included > 0 || rev_prescreen_excluded > 0);
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
  try {
    const response = await backend.call<GetPrescreenQueueResponse>('get_prescreen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
      task_id: managedTask.value?.id,
    });
    if (response.success) {
      const newRecords: EnrichedRecord[] = response.records.map((record) => ({
        ...record,
        _enrichmentStatus: record.abstract
          ? 'complete'
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
    console.error('Failed to load prescreen queue:', err);
  } finally {
    isLoading.value = false;
  }
}

async function startBackgroundEnrichment() {
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
      const response = await backend.call<BatchEnrichRecordsResponse>('batch_enrich_records', {
        project_id: projects.currentProjectId!,
        record_ids: recordsToEnrich,
      });

      if (signal.aborted) break;

      if (response.success) {
        for (const result of response.records) {
          const queueRecord = queue.value.find((r) => r.id === result.id);
          if (queueRecord && result.record) {
            queueRecord.abstract = result.record.abstract;
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

  record._enrichmentStatus = 'loading';

  try {
    const response = await backend.call<EnrichRecordMetadataResponse>('enrich_record_metadata', {
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
  const nextRecord = queue.value[newIndex + 1];
  if (nextRecord && nextRecord._enrichmentStatus === 'pending') {
    await enrichSingleRecord(nextRecord.id);
  }

  const current = queue.value[newIndex];
  if (current && current._enrichmentStatus === 'pending') {
    await enrichSingleRecord(current.id);
  }
});

async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isDeciding.value) return;
  if (isCurrentDecided.value) return;
  // Debounce: prevent duplicate calls from simultaneous keyboard + click events
  const now = Date.now();
  if (now - lastDecisionTime.value < 500) return;
  lastDecisionTime.value = now;

  isDeciding.value = true;
  try {
    const response = await backend.call<PrescreenRecordResponse>('prescreen_record', {
      project_id: projects.currentProjectId,
      record_id: currentRecord.value.id,
      decision,
      task_id: managedTask.value?.id,
    });

    if (response.success) {
      currentRecord.value._decision = decision === 'include' ? 'included' : 'excluded';
      totalCount.value = response.remaining_count;

      decisionHistory.value.push({ ...currentRecord.value });

      if (nextUndecidedIndex.value !== -1) {
        currentIndex.value = nextUndecidedIndex.value;
      } else if (response.remaining_count > 0) {
        await loadQueue();
      } else {
        queue.value = [];
        await projects.refreshCurrentProject();
        allDecisionsMade.value = true;
        managedReview.refresh();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Decision failed', message);
  } finally {
    isDeciding.value = false;
  }
}

function nextRecord() {
  if (currentIndex.value < queue.value.length - 1) {
    currentIndex.value++;
  }
}

function prevRecord() {
  if (currentIndex.value > 0) {
    currentIndex.value--;
  }
}

function goToRecord(index: number) {
  if (index >= 0 && index < queue.value.length) {
    currentIndex.value = index;
  }
}

function skipToNextUndecided() {
  if (nextUndecidedIndex.value !== -1) {
    currentIndex.value = nextUndecidedIndex.value;
  }
}

// --- Edit mode functions ---

async function enterEditMode() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isEditMode.value = true;
  isLoadingEditRecords.value = true;
  editSearchText.value = '';

  try {
    const response = await backend.call<GetRecordsResponse>('get_records', {
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
    const response = await backend.call<UpdatePrescreenDecisionsResponse>(
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
      await projects.refreshCurrentProject();
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

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (isEditMode.value) return;

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      if (!isCurrentDecided.value && currentRecord.value && isCurrentRecordReady.value) {
        makeDecision('exclude');
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (!isCurrentDecided.value && currentRecord.value && isCurrentRecordReady.value) {
        makeDecision('include');
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      prevRecord();
      break;
    case 'ArrowDown':
      e.preventDefault();
      nextRecord();
      break;
  }
}

async function loadManagedTask() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  try {
    const response = await backend.call<GetCurrentManagedReviewTaskResponse>('get_current_managed_review_task', {
      project_id: projects.currentProjectId,
      kind: 'prescreen',
    });
    managedTask.value = response.task;
  } catch {
    managedTask.value = null;
  }
}

async function ensureManagedTaskAccess(): Promise<boolean> {
  if (!projects.currentProjectId || !backend.isRunning) return false;

  accessState.value = 'loading';
  activeManagedTask.value = null;
  assignedReviewerBranch.value = null;

  await loadManagedTask();
  if (managedTask.value) {
    activeManagedTask.value = managedTask.value;
    accessState.value = 'ready';
    return true;
  }

  let tasksResponse: ListManagedReviewTasksResponse;
  try {
    tasksResponse = await backend.call<ListManagedReviewTasksResponse>('list_managed_review_tasks', {
      project_id: projects.currentProjectId,
      kind: 'prescreen',
    });
  } catch {
    accessState.value = 'ready';
    return true;
  }

  const activeTask = tasksResponse.tasks.find((task) => ['active', 'reconciling'].includes(task.state)) ?? null;
  activeManagedTask.value = activeTask;
  if (!activeTask) {
    accessState.value = 'ready';
    return true;
  }

  const login = auth.user?.login?.toLowerCase();
  const assignedReviewerEntry = login
    ? activeTask.reviewers.find((reviewer) => reviewer.github_login.toLowerCase() === login) ?? null
    : null;

  if (!assignedReviewerEntry) {
    accessState.value = 'blocked';
    return false;
  }

  assignedReviewerBranch.value = assignedReviewerEntry.branch_name;
  if (git.currentBranch !== assignedReviewerEntry.branch_name) {
    accessState.value = 'switching';
    // Fetch remote refs first so the reviewer branch is available locally
    if (git.hasRemote) {
      await git.fetch();
    }
    const switched = await git.switchBranch(assignedReviewerEntry.branch_name);
    if (!switched) {
      accessState.value = 'blocked';
      return false;
    }
  }

  await loadManagedTask();
  activeManagedTask.value = managedTask.value ?? activeTask;
  accessState.value = managedTask.value ? 'ready' : 'blocked';
  return managedTask.value !== null;
}

onMounted(async () => {
  if (!props.embedded) {
    // Refresh status first so completion state is accurate when navigating back
    await projects.refreshCurrentProject();
    await git.refreshStatus();
  }
  const canLoadQueue = await ensureManagedTaskAccess();
  if (canLoadQueue) {
    await loadQueue();
  } else {
    queue.value = [];
    totalCount.value = 0;
  }
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
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

      <div class="flex items-center gap-3 mt-6">
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

    <!-- Empty state (no records available yet) -->
    <EmptyState
      v-else-if="!isLoading && queue.length === 0"
      :icon="Filter"
      title="No records to prescreen"
      description="There are no records ready for prescreening yet. Run search & preprocessing first."
    />

    <!-- Screening interface -->
    <div v-else class="flex-1 flex flex-col min-h-0">
      <!-- Progress Bar -->
      <div class="mb-2">
        <ProgressTrack
          :items="queue.map((r) => ({ id: r.id, decision: r._decision }))"
          :current-index="currentIndex"
          :decided-count="decidedCount"
          :total-count="overallTotal"
          test-id-prefix="prescreen"
          @seek="goToRecord"
        />
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
            :is-submitting="isDeciding"
            :show-skip-to-next="nextUndecidedIndex !== -1"
            test-id-prefix="prescreen"
            @decide="makeDecision"
            @skip-to-next="skipToNextUndecided"
          />
        </template>
      </RecordCard>
    </div>
    </template>
  </div>
</template>
