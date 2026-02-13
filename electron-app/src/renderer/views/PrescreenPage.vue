<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  Filter,
  Check,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  CircleCheck,
  Pencil,
  Search,
} from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';
import type {
  GetPrescreenQueueResponse,
  GetRecordsResponse,
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

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const { isReadOnly } = useReadOnly();

const queue = ref<EnrichedRecord[]>([]);
const decisionHistory = ref<EnrichedRecord[]>([]);
const totalCount = ref(0);
const isLoading = ref(false);
const currentIndex = ref(0);
const isDeciding = ref(false);

// Progress bar drag state
const trackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

// Number of records to prefetch in background
const PREFETCH_BATCH_SIZE = 10;

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

// Decision tracking
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

// Completion detection from project status (for when user navigates back after finishing)
const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const overallCounts = computed(() => projects.currentStatus?.overall ?? null);
const isPrescreenComplete = computed(() => {
  if (!statusCounts.value) return false;
  const { rev_prescreen_included, rev_prescreen_excluded, md_processed } = statusCounts.value;
  return md_processed === 0 && (rev_prescreen_included > 0 || rev_prescreen_excluded > 0);
});

// Progress bar: thumb position as percentage
const thumbPercent = computed(() => {
  const n = queue.value.length;
  if (n <= 1) return 50;
  // Position at the center of the segment
  return ((currentIndex.value + 0.5) / n) * 100;
});

// Track width: full width, or capped when few items so segments aren't absurdly wide
const SEGMENT_MAX_PX = 28;
const trackWidthStyle = computed(() => {
  const n = queue.value.length;
  if (n === 0) return '0px';
  // Each segment up to max + 1px gap between them
  const maxPx = n * SEGMENT_MAX_PX + (n - 1);
  return `min(100%, ${maxPx}px)`;
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

// --- Drag logic ---

function indexFromPointerX(clientX: number): number {
  if (!trackRef.value || queue.value.length === 0) return 0;
  const rect = trackRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const ratio = x / rect.width;
  return Math.min(Math.floor(ratio * queue.value.length), queue.value.length - 1);
}

function onTrackPointerDown(e: PointerEvent) {
  // Click on track = jump to that index
  const index = indexFromPointerX(e.clientX);
  goToRecord(index);
}

function onThumbPointerDown(e: PointerEvent) {
  e.stopPropagation(); // Don't trigger track click
  isDragging.value = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onThumbPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  const index = indexFromPointerX(e.clientX);
  goToRecord(index);
}

function onThumbPointerUp() {
  isDragging.value = false;
}

// --- Data loading ---

async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  try {
    const response = await backend.call<GetPrescreenQueueResponse>('get_prescreen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
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
  const recordsToEnrich = queue.value
    .filter((r) => r._decision === 'undecided' && r._enrichmentStatus === 'pending')
    .slice(0, PREFETCH_BATCH_SIZE)
    .map((r) => r.id);

  if (recordsToEnrich.length === 0) return;

  recordsToEnrich.forEach((id) => {
    const record = queue.value.find((r) => r.id === id);
    if (record) record._enrichmentStatus = 'loading';
  });

  try {
    const response = await backend.call<BatchEnrichRecordsResponse>('batch_enrich_records', {
      project_id: projects.currentProjectId!,
      record_ids: recordsToEnrich,
      skip_commit: true,
    });

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
    console.error('Background enrichment failed:', err);
    recordsToEnrich.forEach((id) => {
      const record = queue.value.find((r) => r.id === id);
      if (record) record._enrichmentStatus = 'failed';
    });
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
      skip_commit: true,
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

  isDeciding.value = true;
  try {
    const response = await backend.call<PrescreenRecordResponse>('prescreen_record', {
      project_id: projects.currentProjectId,
      record_id: currentRecord.value.id,
      decision,
    });

    if (response.success) {
      currentRecord.value._decision = decision === 'include' ? 'included' : 'excluded';
      totalCount.value = response.remaining_count;

      decisionHistory.value.push({ ...currentRecord.value });

      notifications.success(
        decision === 'include' ? 'Included' : 'Excluded',
        `${response.remaining_count} records remaining`,
      );

      if (nextUndecidedIndex.value !== -1) {
        currentIndex.value = nextUndecidedIndex.value;
      } else if (response.remaining_count > 0) {
        await loadQueue();
      } else {
        // All done — clear queue and refresh status for completion screen
        queue.value = [];
        await projects.refreshCurrentProject();
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
      editRecords.value = response.records.map((r: any) => {
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

onMounted(async () => {
  // Refresh status first so completion state is accurate when navigating back
  await projects.refreshCurrentProject();
  await loadQueue();
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="p-6 h-full flex flex-col" data-testid="prescreen-page">
    <!-- Zone 1: Header + Stats -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Filter class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-xl font-semibold" data-testid="prescreen-title">Prescreen</h2>
      </div>

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
            {{ overallCounts?.rev_prescreen_included ?? statusCounts?.rev_prescreen_included ?? 0 }}
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
            {{ overallCounts?.rev_prescreen_excluded ?? statusCounts?.rev_prescreen_excluded ?? 0 }}
          </span>
          <span class="text-xs text-muted-foreground flex items-center gap-1">
            <X class="h-3 w-3" /> Excluded
          </span>
        </div>
        <Separator orientation="vertical" class="h-10" />
        <div class="flex flex-col items-center gap-1">
          <span class="text-2xl font-semibold" data-testid="prescreen-complete-total">
            {{
              (overallCounts?.rev_prescreen_included ?? statusCounts?.rev_prescreen_included ?? 0) +
              (overallCounts?.rev_prescreen_excluded ?? statusCounts?.rev_prescreen_excluded ?? 0)
            }}
          </span>
          <span class="text-xs text-muted-foreground">Total reviewed</span>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        class="mt-6"
        data-testid="prescreen-edit-decisions-btn"
        :disabled="isReadOnly"
        @click="enterEditMode"
      >
        <Pencil class="h-4 w-4 mr-1.5" />
        Edit Decisions
      </Button>
    </div>

    <!-- Empty state (no records available yet) -->
    <EmptyState
      v-else-if="!isLoading && queue.length === 0"
      :icon="Filter"
      title="No records to prescreen"
      description="There are no records ready for prescreening yet. Run preprocessing first."
    />

    <!-- Screening interface -->
    <div v-else class="flex-1 flex flex-col min-h-0">
      <!-- Zone 2: Decision Buttons — fixed height prevents jitter -->
      <div
        class="flex items-center justify-center gap-4 h-[56px] shrink-0 mb-2"
        data-testid="prescreen-decision-bar"
      >
        <!-- Undecided: show Include/Exclude buttons -->
        <template v-if="currentRecord && !isCurrentDecided">
          <Button
            variant="destructive"
            size="lg"
            class="min-w-[140px] h-11 text-base"
            data-testid="prescreen-btn-exclude"
            :disabled="!currentRecord || isDeciding || !isCurrentRecordReady || isReadOnly"
            @click="makeDecision('exclude')"
          >
            <Loader2 v-if="isDeciding" class="h-5 w-5 mr-2 animate-spin" />
            <X v-else class="h-5 w-5 mr-2" />
            Exclude
            <kbd class="ml-2 text-xs opacity-60 bg-white/20 px-1.5 py-0.5 rounded">&larr;</kbd>
          </Button>

          <Button
            size="lg"
            class="min-w-[140px] h-11 text-base bg-green-600 hover:bg-green-700 text-white"
            data-testid="prescreen-btn-include"
            :disabled="!currentRecord || isDeciding || !isCurrentRecordReady || isReadOnly"
            @click="makeDecision('include')"
          >
            <Loader2 v-if="isDeciding" class="h-5 w-5 mr-2 animate-spin" />
            <Check v-else class="h-5 w-5 mr-2" />
            Include
            <kbd class="ml-2 text-xs opacity-60 bg-white/20 px-1.5 py-0.5 rounded">&rarr;</kbd>
          </Button>
        </template>

        <!-- Decided: show decision indicator -->
        <template v-else-if="currentRecord && isCurrentDecided">
          <div
            class="flex items-center gap-2 px-4 py-2 rounded-lg"
            :class="
              currentRecord._decision === 'included'
                ? 'bg-green-600/15 text-green-500 border border-green-600/30'
                : 'bg-destructive/15 text-red-400 border border-destructive/30'
            "
            data-testid="prescreen-decision-indicator"
          >
            <Check v-if="currentRecord._decision === 'included'" class="h-5 w-5" />
            <X v-else class="h-5 w-5" />
            <span class="font-medium text-sm">
              {{ currentRecord._decision === 'included' ? 'Included' : 'Excluded' }}
            </span>
          </div>

          <Button
            v-if="nextUndecidedIndex !== -1"
            variant="outline"
            size="lg"
            data-testid="prescreen-btn-skip-to-undecided"
            @click="skipToNextUndecided"
          >
            <ArrowRight class="h-4 w-4 mr-2" />
            Next undecided
          </Button>
        </template>
      </div>

      <!-- Zone 3: Progress Bar — fixed height prevents jitter -->
      <div class="h-[48px] shrink-0 mb-2" data-testid="prescreen-progress-bar">
        <!-- Draggable track -->
        <div
          ref="trackRef"
          class="relative h-6 select-none touch-none cursor-pointer"
          :style="{ width: trackWidthStyle }"
          @pointerdown="onTrackPointerDown"
        >
          <!-- Track background (full width, muted) -->
          <div
            class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-muted"
          />

          <!-- Colored segments overlay -->
          <div
            class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 flex rounded-full overflow-hidden"
          >
            <div
              v-for="(record, index) in queue"
              :key="record.id"
              class="flex-1 min-w-0 border-r border-background/60 last:border-r-0"
              :class="[
                record._decision === 'included'
                  ? 'bg-green-600'
                  : record._decision === 'excluded'
                    ? 'bg-destructive'
                    : 'bg-muted-foreground/25',
              ]"
              :data-testid="`prescreen-progress-cell-${index}`"
            />
          </div>

          <!-- Draggable thumb -->
          <div
            class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-[18px] h-[18px] rounded-full bg-foreground border-2 border-background shadow-md"
            :class="isDragging ? 'cursor-grabbing scale-110' : 'cursor-grab transition-[left] duration-150'"
            :style="{ left: thumbPercent + '%' }"
            data-testid="prescreen-progress-thumb"
            @pointerdown="onThumbPointerDown"
            @pointermove="onThumbPointerMove"
            @pointerup="onThumbPointerUp"
            @lostpointercapture="onThumbPointerUp"
          />
        </div>

        <!-- Position text -->
        <div class="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
          <span data-testid="prescreen-record-counter">
            Record {{ currentIndex + 1 }} of {{ queue.length }}
          </span>
          <span data-testid="prescreen-progress-text">
            {{ decidedCount }} decided / {{ queue.length }} loaded
          </span>
        </div>
      </div>

      <!-- Zone 4: Record Card -->
      <Card
        v-if="currentRecord"
        class="flex-1 flex flex-col min-h-0"
        :class="{
          'border-green-600/40': currentRecord._decision === 'included',
          'border-destructive/40': currentRecord._decision === 'excluded',
        }"
        data-testid="prescreen-record-card"
      >
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <Badge variant="outline" class="font-mono" data-testid="prescreen-record-id">
              {{ currentRecord.id }}
            </Badge>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                :disabled="currentIndex === 0"
                data-testid="prescreen-btn-previous"
                @click="prevRecord"
              >
                <ChevronLeft class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                :disabled="currentIndex >= queue.length - 1"
                data-testid="prescreen-btn-next"
                @click="nextRecord"
              >
                <ChevronRight class="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardTitle class="text-lg leading-tight" data-testid="prescreen-record-title">
            {{ currentRecord.title }}
          </CardTitle>
          <CardDescription>
            {{ currentRecord.author }} ({{ currentRecord.year }})
            <span v-if="currentRecord.journal" class="block">{{ currentRecord.journal }}</span>
            <span v-else-if="currentRecord.booktitle" class="block">{{
              currentRecord.booktitle
            }}</span>
          </CardDescription>
        </CardHeader>

        <CardContent class="flex-1 min-h-0 flex flex-col">
          <h4 class="text-sm font-medium mb-2">Abstract</h4>
          <ScrollArea class="flex-1 pr-4">
            <div
              v-if="currentRecord._enrichmentStatus === 'loading'"
              class="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 class="h-4 w-4 animate-spin" />
              <span>Loading abstract...</span>
            </div>
            <p v-else class="text-sm text-muted-foreground whitespace-pre-wrap">
              {{ currentRecord.abstract || 'No abstract available' }}
            </p>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
