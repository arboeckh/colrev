<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { CheckSquare, FileDown } from 'lucide-vue-next';
import { EmptyState } from '@/components/common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  PdfViewerPanel,
  ScreenSplitPanel,
  ScreenRecordPanel,
  ScreenEditMode,
  ScreenComplete,
  CriteriaManagementDialog,
  PdfsSection,
} from '@/components/screen';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useReadOnly } from '@/composables/useReadOnly';
import type {
  GetScreenQueueResponse,
  ScreenQueueRecord,
  ScreenRecordResponse,
  ScreenCriterionDefinition,
} from '@/types/api';

// --- Types ---
type DecisionState = 'undecided' | 'included' | 'excluded';
type ScreenMode = 'screening' | 'edit' | 'complete';

interface ScreenEnrichedRecord extends ScreenQueueRecord {
  _decision: DecisionState;
  _criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'>;
}

// --- Stores ---
const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const reviewDefStore = useReviewDefinitionStore();
const { isReadOnly } = useReadOnly();

// --- Top-level tab state ---
const activeTopTab = ref<'pdfs' | 'screen'>('pdfs');

// Auto-select tab based on PDF work remaining
const pdfPendingCount = computed(() => {
  const counts = projects.currentStatus?.currently;
  if (!counts) return 0;
  return (counts.rev_prescreen_included ?? 0) +
    (counts.pdf_needs_manual_retrieval ?? 0) +
    (counts.pdf_imported ?? 0) +
    (counts.pdf_needs_manual_preparation ?? 0);
});

const pdfPreparedCount = computed(() => {
  return projects.currentStatus?.currently?.pdf_prepared ?? 0;
});

// --- State ---
const queue = ref<ScreenEnrichedRecord[]>([]);
const decisionHistory = ref<ScreenEnrichedRecord[]>([]);
const criteria = ref<Record<string, ScreenCriterionDefinition>>({});
const totalCount = ref(0);
const isLoading = ref(false);
const currentIndex = ref(0);
const isDeciding = ref(false);
const mode = ref<ScreenMode>('screening');
const showCriteriaDialog = ref(false);

// --- Computed ---
const currentRecord = computed(() => queue.value[currentIndex.value] || null);

const hasCriteria = computed(() => Object.keys(criteria.value).length > 0);

const decidedCount = computed(
  () => queue.value.filter((r) => r._decision !== 'undecided').length,
);
const includedCount = computed(
  () => queue.value.filter((r) => r._decision === 'included').length,
);
const excludedCount = computed(
  () => queue.value.filter((r) => r._decision === 'excluded').length,
);

const isCurrentDecided = computed(() => currentRecord.value?._decision !== 'undecided');

const nextUndecidedIndex = computed(() => {
  for (let i = currentIndex.value + 1; i < queue.value.length; i++) {
    if (queue.value[i]._decision === 'undecided') return i;
  }
  return -1;
});

const derivedDecision = computed((): 'include' | 'exclude' | null => {
  if (!currentRecord.value || !hasCriteria.value) return null;
  const decisions = currentRecord.value._criteriaDecisions;

  if (Object.values(decisions).some((v) => v === 'out')) return 'exclude';

  const inclusionNames = Object.keys(criteria.value).filter(
    (name) => criteria.value[name]?.criterion_type !== 'exclusion_criterion',
  );
  if (inclusionNames.length > 0 && inclusionNames.every((name) => decisions[name] === 'in')) {
    return 'include';
  }

  return null;
});

const canSubmitCriteria = computed(() => derivedDecision.value !== null);

// Completion detection from project status
const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const isScreenComplete = computed(() => {
  if (!statusCounts.value) return false;
  const { rev_included, rev_excluded, pdf_prepared } = statusCounts.value;
  return pdf_prepared === 0 && (rev_included > 0 || rev_excluded > 0);
});

// --- Data loading ---
async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  try {
    const response = await backend.call<GetScreenQueueResponse>('get_screen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
    });
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
    console.error('Failed to load screen queue:', err);
  } finally {
    isLoading.value = false;
  }
}

// --- Decision handling ---
async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isDeciding.value) return;
  if (isCurrentDecided.value) return;

  isDeciding.value = true;
  try {
    const criteriaDecisions: Record<string, 'in' | 'out'> = {};
    if (hasCriteria.value) {
      for (const [name, value] of Object.entries(currentRecord.value._criteriaDecisions)) {
        if (value !== 'TODO') {
          criteriaDecisions[name] = value;
        }
      }
    }

    const response = await backend.call<ScreenRecordResponse>('screen_record', {
      project_id: projects.currentProjectId,
      record_id: currentRecord.value.id,
      decision,
      criteria_decisions: Object.keys(criteriaDecisions).length > 0 ? criteriaDecisions : undefined,
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

function submitCriteriaDecision() {
  if (!canSubmitCriteria.value || !derivedDecision.value) return;
  makeDecision(derivedDecision.value);
}

function toggleCriterion(name: string, value: 'in' | 'out' | 'TODO') {
  if (!currentRecord.value) return;
  currentRecord.value._criteriaDecisions[name] = value;
}

// --- Navigation ---
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

// --- Mode switching ---
function enterEditMode() {
  mode.value = 'edit';
}

function exitEditMode() {
  mode.value = isScreenComplete.value ? 'complete' : 'screening';
}

async function handleCriteriaChanged() {
  await loadQueue();
}

// --- Keyboard shortcuts ---
function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (mode.value !== 'screening' || activeTopTab.value !== 'screen') return;

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (currentIndex.value > 0) currentIndex.value--;
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (currentIndex.value < queue.value.length - 1) currentIndex.value++;
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (!hasCriteria.value && !isCurrentDecided.value && currentRecord.value) {
        makeDecision('exclude');
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (!hasCriteria.value && !isCurrentDecided.value && currentRecord.value) {
        makeDecision('include');
      }
      break;
  }
}

// --- Lifecycle ---
onMounted(async () => {
  await projects.refreshCurrentProject();
  await reviewDefStore.loadDefinition();
  await loadQueue();
  window.addEventListener('keydown', handleKeydown);

  // Auto-select tab: show Screen if no PDF work pending and there are prepared PDFs
  if (pdfPendingCount.value === 0 && pdfPreparedCount.value > 0) {
    activeTopTab.value = 'screen';
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="h-full flex flex-col" data-testid="screen-page">
    <Tabs v-model="activeTopTab" class="h-full flex flex-col">
      <div class="border-b px-4 pt-2">
        <TabsList>
          <TabsTrigger value="pdfs" data-testid="screen-tab-pdfs">
            <FileDown class="h-4 w-4 mr-1.5" />
            PDFs
            <Badge
              v-if="pdfPendingCount > 0"
              variant="secondary"
              class="ml-1.5 h-5 min-w-5 px-1.5 text-xs"
            >
              {{ pdfPendingCount }}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="screen" data-testid="screen-tab-screen">
            <CheckSquare class="h-4 w-4 mr-1.5" />
            Screen
            <Badge
              v-if="pdfPreparedCount > 0"
              variant="secondary"
              class="ml-1.5 h-5 min-w-5 px-1.5 text-xs"
            >
              {{ pdfPreparedCount }}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="pdfs" class="flex-1 min-h-0 mt-0">
        <PdfsSection
          v-if="projects.currentProjectId"
          :project-id="projects.currentProjectId"
        />
      </TabsContent>

      <TabsContent value="screen" class="flex-1 min-h-0 mt-0 flex flex-col">
        <!-- Edit mode -->
        <ScreenEditMode
          v-if="mode === 'edit'"
          class="px-4 py-2"
          @close="exitEditMode"
        />

        <!-- Completion state -->
        <ScreenComplete
          v-else-if="(mode === 'complete' || (!isLoading && queue.length === 0 && isScreenComplete))"
          class="px-4 py-2"
          :included-count="statusCounts?.rev_included ?? 0"
          :excluded-count="statusCounts?.rev_excluded ?? 0"
          :read-only="isReadOnly"
          @edit-decisions="enterEditMode"
        />

        <!-- Empty state (no records available yet) -->
        <EmptyState
          v-else-if="!isLoading && queue.length === 0"
          :icon="CheckSquare"
          title="No records to screen"
          description="There are no records ready for full-text screening yet. Complete PDF preparation first."
        />

        <!-- Screening interface: split panel takes full height -->
        <ScreenSplitPanel
          v-else-if="currentRecord"
          class="flex-1 min-h-0"
          data-testid="screen-record-card"
        >
          <template #left>
            <PdfViewerPanel :pdf-path="currentRecord.pdf_path" />
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
              :derived-decision="derivedDecision"
              :can-submit-criteria="canSubmitCriteria"
              :next-undecided-index="nextUndecidedIndex"
              :mode="mode"
              :queue-records="queue"
              :current-index="currentIndex"
              :read-only="isReadOnly"
              @toggle-criterion="toggleCriterion"
              @make-decision="makeDecision"
              @submit-criteria-decision="submitCriteriaDecision"
              @skip-to-next-undecided="skipToNextUndecided"
              @enter-edit-mode="enterEditMode"
              @show-criteria-dialog="showCriteriaDialog = true"
              @navigate="goToRecord"
            />
          </template>
        </ScreenSplitPanel>

        <!-- Criteria management dialog -->
        <CriteriaManagementDialog
          v-model:open="showCriteriaDialog"
          @criteria-changed="handleCriteriaChanged"
        />
      </TabsContent>
    </Tabs>
  </div>
</template>
