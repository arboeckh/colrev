<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { CheckSquare, FileDown, AlertCircle, RefreshCw, Check } from 'lucide-vue-next';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
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
type WorkflowStep = 1 | 2 | 3 | 4;

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

// --- Step state ---
const activeStep = ref<WorkflowStep>(1);

// --- Status counts ---
const statusCounts = computed(() => projects.currentStatus?.currently ?? null);

const revPrescreenIncludedCount = computed(() => statusCounts.value?.rev_prescreen_included ?? 0);
const needsPdfCount = computed(() => statusCounts.value?.pdf_needs_manual_retrieval ?? 0);
const pdfImportedCount = computed(() => statusCounts.value?.pdf_imported ?? 0);
const pdfPreparedCount = computed(() => statusCounts.value?.pdf_prepared ?? 0);
const pdfNeedsPrepCount = computed(() => statusCounts.value?.pdf_needs_manual_preparation ?? 0);
const pdfNotAvailableCount = computed(() => statusCounts.value?.pdf_not_available ?? 0);

// Step 1 active: records waiting for PDF retrieval
const step1Pending = computed(() => revPrescreenIncludedCount.value + needsPdfCount.value);
const step1Done = computed(
  () => step1Pending.value === 0 &&
    (pdfImportedCount.value + pdfPreparedCount.value + pdfNeedsPrepCount.value + pdfNotAvailableCount.value) > 0
);

// Step 2 active: records waiting for PDF prep
const step2Pending = computed(() => pdfImportedCount.value + pdfNeedsPrepCount.value);
const step2Done = computed(
  () => step2Pending.value === 0 && step1Done.value
);

// Step 3 (Review): no pending, some prepared or not-available
const step3Done = computed(() => pdfPreparedCount.value > 0 && step2Done.value);

// Step 4 (Screen): accessible when there are prepared PDFs waiting, or screening has already started
const screenedCount = computed(() =>
  (statusCounts.value?.rev_included ?? 0) + (statusCounts.value?.rev_excluded ?? 0),
);
const step4Unlocked = computed(() => pdfPreparedCount.value > 0 || screenedCount.value > 0);

// Whether a step is accessible (user can click it)
function isStepAccessible(step: WorkflowStep): boolean {
  if (step === 1) return true;
  if (step === 2) return step1Done.value || pdfImportedCount.value > 0 || pdfNeedsPrepCount.value > 0 || pdfPreparedCount.value > 0;
  if (step === 3) return step2Done.value || pdfNotAvailableCount.value > 0 || pdfPreparedCount.value > 0;
  if (step === 4) return step4Unlocked.value;
  return false;
}

function stepStatus(step: WorkflowStep): 'complete' | 'active' | 'pending' {
  if (step === 1) return step1Done.value ? 'complete' : 'active';
  if (step === 2) {
    if (step2Done.value) return 'complete';
    if (step1Done.value) return 'active';
    return 'pending';
  }
  if (step === 3) {
    if (step3Done.value) return 'complete';
    if (step2Done.value) return 'active';
    return 'pending';
  }
  // step 4
  if ((statusCounts.value?.rev_included ?? 0) + (statusCounts.value?.rev_excluded ?? 0) > 0 && pdfPreparedCount.value === 0) return 'complete';
  if (step4Unlocked.value) return 'active';
  return 'pending';
}

function goToStep(step: WorkflowStep) {
  if (!isStepAccessible(step)) return;
  activeStep.value = step;
  if (step === 4) loadQueue();
}

// Auto-advance to the right step on load / status change
function resolveInitialStep(): WorkflowStep {
  if (step1Pending.value > 0) return 1;
  if (step2Pending.value > 0) return 2;
  if (step4Unlocked.value && !step2Pending.value) return 4;
  if (step1Done.value) return 2;
  return 1;
}

// --- Screen state ---
const queue = ref<ScreenEnrichedRecord[]>([]);
const decisionHistory = ref<ScreenEnrichedRecord[]>([]);
const criteria = ref<Record<string, ScreenCriterionDefinition>>({});
const totalCount = ref(0);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const currentIndex = ref(0);
const isDeciding = ref(false);
const mode = ref<ScreenMode>('screening');
const showCriteriaDialog = ref(false);

// --- Computed ---
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
const derivedDecision = computed((): 'include' | 'exclude' | null => {
  if (!currentRecord.value || !hasCriteria.value) return null;
  const decisions = currentRecord.value._criteriaDecisions;
  if (Object.values(decisions).some((v) => v === 'out')) return 'exclude';
  const inclusionNames = Object.keys(criteria.value).filter(
    (name) => criteria.value[name]?.criterion_type !== 'exclusion_criterion',
  );
  if (inclusionNames.length > 0 && inclusionNames.every((name) => decisions[name] === 'in')) return 'include';
  return null;
});
const canSubmitCriteria = computed(() => derivedDecision.value !== null);
const isScreenComplete = computed(() => {
  if (!statusCounts.value) return false;
  const { rev_included, rev_excluded, pdf_prepared } = statusCounts.value;
  return pdf_prepared === 0 && (rev_included > 0 || rev_excluded > 0);
});

// --- Data loading ---
async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  isLoading.value = true;
  loadError.value = null;
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
        return { ...record, _decision: 'undecided' as DecisionState, _criteriaDecisions: criteriaDecisions };
      });
      const history = decisionHistory.value;
      queue.value = [...history, ...newRecords];
      totalCount.value = response.total_count;
      currentIndex.value = history.length;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    loadError.value = message;
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
        if (value !== 'TODO') criteriaDecisions[name] = value;
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
      notifications.success(decision === 'include' ? 'Included' : 'Excluded', `${response.remaining_count} records remaining`);
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

function goToRecord(index: number) {
  if (index >= 0 && index < queue.value.length) currentIndex.value = index;
}

function skipToNextUndecided() {
  if (nextUndecidedIndex.value !== -1) currentIndex.value = nextUndecidedIndex.value;
}

function enterEditMode() { mode.value = 'edit'; }
function exitEditMode() { mode.value = isScreenComplete.value ? 'complete' : 'screening'; }
async function handleCriteriaChanged() { await loadQueue(); }

// --- Keyboard shortcuts ---
function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (mode.value !== 'screening' || activeStep.value !== 4) return;
  switch (e.key) {
    case 'ArrowUp': e.preventDefault(); if (currentIndex.value > 0) currentIndex.value--; break;
    case 'ArrowDown': e.preventDefault(); if (currentIndex.value < queue.value.length - 1) currentIndex.value++; break;
    case 'ArrowLeft': e.preventDefault(); if (!hasCriteria.value && !isCurrentDecided.value && currentRecord.value) makeDecision('exclude'); break;
    case 'ArrowRight': e.preventDefault(); if (!hasCriteria.value && !isCurrentDecided.value && currentRecord.value) makeDecision('include'); break;
  }
}

// Auto-advance to step 4 when PDFs become ready
watch(step4Unlocked, (val) => {
  if (val && activeStep.value === 3) {
    activeStep.value = 4;
    loadQueue();
  }
});

// Reload queue when arriving at step 4
watch(activeStep, (step) => {
  if (step === 4) loadQueue();
});

// --- Lifecycle ---
onMounted(async () => {
  await projects.refreshCurrentProject();
  await reviewDefStore.loadDefinition();
  window.addEventListener('keydown', handleKeydown);
  activeStep.value = resolveInitialStep();
  if (activeStep.value === 4) await loadQueue();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="h-full flex flex-col" data-testid="screen-page">

    <!-- ── Horizontal 4-step process bar ──────────────────────────── -->
    <div class="border-b bg-background px-6 py-4 shrink-0">
      <div class="flex items-center">

        <template v-for="step in ([1, 2, 3, 4] as WorkflowStep[])" :key="step">
          <!-- Step button -->
          <button
            class="flex items-center gap-2.5 shrink-0 group"
            :class="[
              isStepAccessible(step) ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
            ]"
            :disabled="!isStepAccessible(step)"
            :data-testid="`workflow-step-${step}`"
            @click="goToStep(step)"
          >
            <!-- Circle with notification badge -->
            <div class="relative">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors"
                :class="[
                  stepStatus(step) === 'complete'
                    ? 'bg-emerald-500 text-white'
                    : activeStep === step
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                      : 'bg-muted text-muted-foreground group-hover:bg-muted/80',
                ]"
              >
                <Check v-if="stepStatus(step) === 'complete'" class="h-3.5 w-3.5" />
                <span v-else>{{ step }}</span>
              </div>
              <!-- Pending count overlaid on circle -->
              <span
                v-if="(step === 1 && step1Pending > 0) || (step === 2 && step2Pending > 0) || (step === 4 && pdfPreparedCount > 0 && stepStatus(4) !== 'complete')"
                class="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[10px] font-bold text-primary-foreground tabular-nums"
              >
                <template v-if="step === 1">{{ step1Pending }}</template>
                <template v-else-if="step === 2">{{ step2Pending }}</template>
                <template v-else>{{ pdfPreparedCount }}</template>
              </span>
            </div>
            <!-- Label -->
            <span
              class="text-sm whitespace-nowrap transition-colors"
              :class="[
                activeStep === step
                  ? 'font-semibold text-foreground'
                  : stepStatus(step) === 'complete'
                    ? 'text-emerald-600 font-medium'
                    : 'text-muted-foreground',
              ]"
            >
              <template v-if="step === 1">Retrieve PDFs</template>
              <template v-else-if="step === 2">Prepare PDFs</template>
              <template v-else-if="step === 3">Review</template>
              <template v-else>Screen</template>
            </span>
          </button>

          <!-- Connector line: green only when the source step is complete -->
          <div
            v-if="step < 4"
            class="flex-1 h-px mx-3 min-w-4"
            :class="stepStatus(step) === 'complete' ? 'bg-emerald-500/40' : 'bg-border'"
          />
        </template>
      </div>
    </div>

    <!-- ── Step content ────────────────────────────────────────────── -->

    <!-- Steps 1–3: PDF workflow -->
    <PdfsSection
      v-if="activeStep <= 3 && projects.currentProjectId"
      :project-id="projects.currentProjectId"
      :step="activeStep as 1 | 2 | 3"
      class="flex-1 min-h-0"
      @go-to-next="goToStep((activeStep + 1) as WorkflowStep)"
      @all-pdfs-ready="goToStep(4)"
    />

    <!-- Step 4: Screen -->
    <div v-else-if="activeStep === 4" class="flex-1 min-h-0 flex flex-col">

      <!-- Edit mode -->
      <ScreenEditMode
        v-if="mode === 'edit'"
        class="px-4 py-3"
        @close="exitEditMode"
      />

      <!-- Completion -->
      <ScreenComplete
        v-else-if="mode === 'complete' || (!isLoading && queue.length === 0 && isScreenComplete)"
        class="px-4 py-3"
        :included-count="statusCounts?.rev_included ?? 0"
        :excluded-count="statusCounts?.rev_excluded ?? 0"
        :read-only="isReadOnly"
        @edit-decisions="enterEditMode"
      />

      <!-- Error -->
      <div
        v-else-if="!isLoading && loadError"
        class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8"
      >
        <AlertCircle class="h-10 w-10 text-destructive" />
        <div>
          <h3 class="text-lg font-medium">Failed to load screening queue</h3>
          <p class="text-sm text-muted-foreground mt-1">{{ loadError }}</p>
        </div>
        <Button variant="outline" @click="loadQueue">
          <RefreshCw class="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>

      <!-- No PDFs ready yet -->
      <div
        v-else-if="!isLoading && queue.length === 0 && !isScreenComplete && pdfPreparedCount === 0"
        class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8"
      >
        <FileDown class="h-10 w-10 text-muted-foreground" />
        <div>
          <h3 class="text-lg font-medium">PDFs not ready yet</h3>
          <p class="text-sm text-muted-foreground mt-1">Complete PDF retrieval and preparation before screening.</p>
        </div>
        <Button variant="outline" @click="goToStep(1)">
          Go to Retrieve step
        </Button>
      </div>

      <!-- Empty (loading) -->
      <div v-else-if="isLoading" class="flex-1 flex items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>

      <!-- No records to screen -->
      <EmptyState
        v-else-if="!isLoading && queue.length === 0"
        :icon="CheckSquare"
        title="No records to screen"
        description="There are no records ready for full-text screening."
      />

      <!-- Screening interface -->
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
    </div>

  </div>
</template>
