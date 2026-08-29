<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  FileDown,
  CheckCircle2,
  FileUp,
  Loader2,
  Lock,
  ChevronRight,
  ArrowRight,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { OperationButton, EmptyState, LoadErrorState } from '@/components/common';
import PdfRecordTable from '@/components/pdf-get/PdfRecordTable.vue';
import BatchUploadDialog from '@/components/pdf-get/BatchUploadDialog.vue';
import PdfShareActions from '@/components/shared/PdfShareActions.vue';
import StepPageShell from '@/components/layout/StepPageShell.vue';
import PdfsPageHelp from './PdfsPageHelp.vue';
import type { PdfRecord, UploadResult } from '@/components/pdf-get/pdf-record-utils';
import {
  UPLOAD_STAGE_PILLS,
  PREPARE_STAGE_PILLS,
  FIX_STAGE_PILLS,
  SUMMARY_STAGE_PILLS,
} from '@/components/pdf-get/pdf-record-utils';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectDataStore } from '@/stores/projectData';
import { useProjectDataChanged } from '@/composables/useProjectDataChanged';
import { useReadOnly } from '@/composables/useReadOnly';
import {
  computePdfStages,
  derivePdfCounts,
  pdfAnyActivity,
  pdfsAllDone,
  type PdfStageId,
} from '@/lib/stepStatus';

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const projectData = useProjectDataStore();
const { isReadOnly } = useReadOnly();

type StageId = PdfStageId;
type PendingUploadKind = 'normal' | 'missing-restore';

const records = ref<PdfRecord[]>([]);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const uploadingRecordId = ref<string | null>(null);
const markingRecordId = ref<string | null>(null);
const undoingRecordId = ref<string | null>(null);
const showBatchUpload = ref(false);
const pdfFileInput = ref<HTMLInputElement | null>(null);
const pendingUploadRecordId = ref<string | null>(null);
const pendingUploadKind = ref<PendingUploadKind>('normal');
const uploadResults = ref<Record<string, UploadResult>>({});

const userSelectedStage = ref<StageId | null>(null);

// All PDF stage counts come from the status payload's per-operation steps;
// the stage machine itself lives in the shared status module.
const pdfCounts = computed(() => derivePdfCounts(projects.payloadSteps));
const prescreenIncludedCount = computed(() => pdfCounts.value.prescreenIncluded);
const needsRetrievalCount = computed(() => pdfCounts.value.needsRetrieval);
const importedCount = computed(() => pdfCounts.value.imported);
const preparedCount = computed(() => pdfCounts.value.prepared);
const needsPrepCount = computed(() => pdfCounts.value.needsPrep);
const missingOnDiskCount = computed(
  () => records.value.filter((r) => r.file_on_disk === false).length,
);

const anyPdfActivity = computed(() => pdfAnyActivity(pdfCounts.value));

const pageBlocked = computed(
  () => !anyPdfActivity.value && prescreenIncludedCount.value === 0,
);

const stageStatus = computed(() =>
  computePdfStages(pdfCounts.value, missingOnDiskCount.value),
);

const firstActiveStage = computed<StageId>(() => {
  const order: StageId[] = ['retrieve', 'upload', 'prepare', 'fix', 'summary'];
  return order.find((id) => stageStatus.value[id] === 'active') ?? 'summary';
});

const activeStage = computed<StageId>(
  () => userSelectedStage.value ?? firstActiveStage.value,
);

watch(firstActiveStage, () => {
  userSelectedStage.value = null;
});

const allDone = computed(() => pdfsAllDone(pdfCounts.value, missingOnDiskCount.value));

const canRunPdfGet = computed(() => projects.operationInfo.pdf_get?.runnable ?? false);
const canRunPdfPrep = computed(() => projects.operationInfo.pdf_prep?.runnable ?? false);

const needsRetrievalRecords = computed(() =>
  records.value.filter((r) => r.colrev_status === 'pdf_needs_manual_retrieval'),
);

interface StageMeta {
  id: StageId;
  label: string;
  meta: string;
}

const stages = computed<StageMeta[]>(() => [
  {
    id: 'retrieve',
    label: 'Retrieve',
    meta:
      stageStatus.value.retrieve === 'complete'
        ? 'done'
        : prescreenIncludedCount.value > 0
          ? `${prescreenIncludedCount.value} to find`
          : '',
  },
  {
    id: 'upload',
    label: 'Upload',
    meta:
      stageStatus.value.upload === 'locked'
        ? ''
        : stageStatus.value.upload === 'complete'
          ? 'done'
          : `${needsRetrievalCount.value} to upload`,
  },
  {
    id: 'prepare',
    label: 'Prepare',
    meta:
      stageStatus.value.prepare === 'locked'
        ? ''
        : stageStatus.value.prepare === 'complete'
          ? 'done'
          : `${importedCount.value} ready`,
  },
  {
    id: 'fix',
    label: 'Fix defects',
    meta:
      stageStatus.value.fix === 'locked'
        ? ''
        : stageStatus.value.fix === 'complete'
          ? 'done'
          : `${needsPrepCount.value} to fix`,
  },
  {
    id: 'summary',
    label: 'Summary',
    meta:
      stageStatus.value.summary === 'locked'
        ? ''
        : stageStatus.value.summary === 'complete'
          ? 'done'
          : `${missingOnDiskCount.value} missing`,
  },
]);


async function loadRecords() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  loadError.value = null;
  const guard = projectData.snapshot();
  try {
    const response = await backend.call('get_records', {
      project_id: projects.currentProjectId,
      filters: {
        status: [
          'rev_prescreen_included',
          'pdf_needs_manual_retrieval',
          'pdf_imported',
          'pdf_not_available',
          'pdf_prepared',
          'pdf_needs_manual_preparation',
          'rev_excluded',
          'rev_included',
          'rev_synthesized',
        ],
      },
      pagination: { offset: 0, limit: 2000 },
      fields: [
        'ID',
        'title',
        'author',
        'year',
        'colrev_status',
        'journal',
        'booktitle',
        'doi',
        'colrev_data_provenance',
      ],
    });

    // Project/branch switch mid-flight: discard the stale response.
    if (!guard.isCurrent()) return;
    if (response.success) {
      records.value = response.records as unknown as PdfRecord[];
    }
  } catch (err) {
    if (guard.isCurrent()) {
      loadError.value = err instanceof Error ? err.message : 'Unknown error';
    }
  } finally {
    isLoading.value = false;
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function uploadPdfForRecord(recordId: string) {
  pendingUploadRecordId.value = recordId;
  pendingUploadKind.value = 'normal';
  if (pdfFileInput.value) {
    pdfFileInput.value.value = '';
    pdfFileInput.value.click();
  }
}

function uploadMissingFileForRecord(recordId: string) {
  pendingUploadRecordId.value = recordId;
  pendingUploadKind.value = 'missing-restore';
  if (pdfFileInput.value) {
    pdfFileInput.value.value = '';
    pdfFileInput.value.click();
  }
}

async function handlePdfFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const recordId = pendingUploadRecordId.value;
  const kind = pendingUploadKind.value;
  if (!file || !recordId || !projects.currentProjectId) return;

  uploadingRecordId.value = recordId;
  try {
    const content = await readFileAsBase64(file);

    if (kind === 'missing-restore') {
      await backend.call('restore_pdf_file', {
        project_id: projects.currentProjectId,
        record_id: recordId,
        content,
      });
      uploadResults.value[recordId] = { status: 'success' };
      notifications.success('PDF restored', `File placed on disk for ${recordId}`);
      return;
    }

    const response = await backend.call('upload_pdf', {
      project_id: projects.currentProjectId,
      record_id: recordId,
      filename: file.name,
      content,
    });

    if (response.success) {
      if (response.prep_status === 'pdf_prepared') {
        uploadResults.value[recordId] = { status: 'success' };
        notifications.success('PDF uploaded & prepared', `PDF for ${recordId} is ready`);
      } else if (
        response.prep_status === 'pdf_needs_manual_preparation' ||
        response.prep_status === 'skipped'
      ) {
        uploadResults.value[recordId] = {
          status: 'prep-failed',
          message: response.prep_message || 'PDF needs a cleaner copy',
        };
        notifications.warning(
          'PDF uploaded, needs a cleaner copy',
          response.prep_message || `${recordId} needs a cleaner copy`,
        );
      } else {
        uploadResults.value[recordId] = { status: 'success' };
        notifications.success('PDF uploaded', `PDF linked to ${recordId}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    uploadResults.value[recordId] = { status: 'error', message };
    notifications.error(
      kind === 'missing-restore' ? 'Restore failed' : 'Upload failed',
      message,
    );
  } finally {
    uploadingRecordId.value = null;
    pendingUploadRecordId.value = null;
    pendingUploadKind.value = 'normal';
  }
}

async function markNotAvailable(recordId: string) {
  if (!projects.currentProjectId) return;

  markingRecordId.value = recordId;
  try {
    const response = await backend.call('mark_pdf_not_available', {
      project_id: projects.currentProjectId,
      record_id: recordId,
    });

    if (response.success) {
      notifications.success('Marked unavailable', recordId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed', message);
  } finally {
    markingRecordId.value = null;
  }
}

async function undoNotAvailable(recordId: string) {
  if (!projects.currentProjectId) return;

  undoingRecordId.value = recordId;
  try {
    // Previously mistyped as MarkPdfNotAvailableResponse; the typed call
    // returns UndoPdfNotAvailableResponse (same fields read here).
    const response = await backend.call('undo_pdf_not_available', {
      project_id: projects.currentProjectId,
      record_id: recordId,
    });

    if (response.success) {
      notifications.success('Restored', `${recordId} ready to upload`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed', message);
  } finally {
    undoingRecordId.value = null;
  }
}

// Record list + store-level status refresh after any write via the
// invalidation seam (upload_pdf, pdf_get, pdf_prep, mark/undo, batch import
// are all writer RPCs) — no per-action refresh choreography needed.
useProjectDataChanged(async () => {
  await loadRecords();
});

function handleOperationComplete() {
  userSelectedStage.value = null;
}

function handleOperationError() {
  // Even when the operation surfaces an error toast, the backend may have
  // persisted partial progress before raising — the seam still fires on the
  // error path, so the UI reflects whatever made it to disk.
  userSelectedStage.value = null;
}

function handleBatchUploadComplete() {
  showBatchUpload.value = false;
}

function selectStage(id: StageId) {
  if (stageStatus.value[id] === 'locked') return;
  userSelectedStage.value = id;
}

onMounted(async () => {
  await loadRecords();
});
</script>

<template>
  <StepPageShell
    step="pdfs"
    subtitle="Retrieve and prepare full-text PDFs for included records"
    :page-help="PdfsPageHelp"
  >
  <div class="h-full flex flex-col" data-testid="pdfs-page">
    <div class="px-8 pt-4 flex justify-end">
      <PdfShareActions variant="default" />
    </div>

    <!-- Blocked: prescreen not done -->
    <div v-if="pageBlocked" class="flex-1 flex items-center justify-center">
      <EmptyState
        :icon="Lock"
        title="Complete prescreening first"
        description="PDF retrieval starts once records have been included in the prescreen."
      />
    </div>

    <div v-else-if="loadError && !isLoading" class="flex-1 flex flex-col">
      <LoadErrorState
        title="Failed to load PDF records"
        :message="loadError"
        test-id="pdfs-load-error"
        @retry="loadRecords"
      />
    </div>

    <template v-else>
      <!-- Stepper -->
      <nav
        class="px-8 pb-6 flex items-center gap-2 text-sm flex-wrap"
        data-testid="pdfs-stepper"
        aria-label="PDFs workflow"
      >
        <template v-for="(stage, idx) in stages" :key="stage.id">
          <ChevronRight
            v-if="idx > 0"
            class="h-3.5 w-3.5 text-muted-foreground/40 shrink-0"
          />
          <button
            type="button"
            :disabled="stageStatus[stage.id] === 'locked'"
            :aria-current="activeStage === stage.id ? 'step' : undefined"
            class="px-2 py-1 rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
            :class="[
              stageStatus[stage.id] === 'locked' && 'text-muted-foreground/40 cursor-not-allowed',
              stageStatus[stage.id] !== 'locked' && activeStage === stage.id && 'text-foreground font-medium',
              stageStatus[stage.id] !== 'locked' && activeStage !== stage.id && 'text-muted-foreground hover:text-foreground cursor-pointer',
            ]"
            :data-testid="`pdfs-stage-${stage.id}`"
            @click="selectStage(stage.id)"
          >
            <span class="flex items-center gap-1.5">
              <CheckCircle2
                v-if="stageStatus[stage.id] === 'complete'"
                class="h-3.5 w-3.5 text-green-600 dark:text-green-400"
              />
              {{ stage.label }}
              <span
                v-if="stage.meta"
                class="text-xs tabular-nums text-muted-foreground/70 font-normal"
              >
                · {{ stage.meta }}
              </span>
            </span>
          </button>
        </template>
      </nav>

      <div class="h-px bg-border/60 mx-8" />

      <!-- Stage panels -->
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <!-- Stage 1: Retrieve -->
        <section
          v-if="activeStage === 'retrieve'"
          class="flex-1 min-h-0 overflow-auto px-8 py-16 text-center"
          data-testid="pdfs-stage-retrieve-panel"
        >
          <div
            class="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-6"
          >
            <FileDown class="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 class="text-xl font-medium mb-3">
            <template v-if="stageStatus.retrieve === 'complete' && !canRunPdfGet">
              Retrieval finished.
            </template>
            <template v-else-if="stageStatus.retrieve === 'complete'">
              Retrieval finished — you can run it again.
            </template>
            <template v-else>
              Let's find the PDFs for your
              <span class="tabular-nums">{{ prescreenIncludedCount }}</span>
              included {{ prescreenIncludedCount === 1 ? 'record' : 'records' }}.
            </template>
          </h2>
          <p class="text-sm text-muted-foreground leading-relaxed max-w-prose mx-auto mb-8">
            <template v-if="stageStatus.retrieve === 'complete' && !canRunPdfGet">
              There are no records left that CoLRev can retrieve for. Add new
              records in earlier steps, or move on to upload the ones below.
            </template>
            <template v-else-if="stageStatus.retrieve === 'complete'">
              Re-run retrieval after adding new sources or credentials to pick
              up anything that failed the first time.
            </template>
            <template v-else>
              CoLRev will try to fetch each PDF automatically from open and
              licensed sources. Anything it can't find will show up in the next
              step for you to upload.
            </template>
          </p>
          <OperationButton
            v-if="projects.currentProjectId && (stageStatus.retrieve !== 'complete' || canRunPdfGet)"
            operation="pdf_get"
            :project-id="projects.currentProjectId"
            :label="stageStatus.retrieve === 'complete' ? 'Re-run retrieval' : 'Start retrieval'"
            running-label="Retrieving PDFs"
            :disabled="!canRunPdfGet"
            show-progress
            test-id="pdfs-retrieve-cta"
            @success="handleOperationComplete"
            @error="handleOperationError"
          />
          <Button
            v-else-if="stageStatus.upload !== 'locked'"
            variant="default"
            data-testid="pdfs-retrieve-go-upload"
            @click="selectStage('upload')"
          >
            Go to upload
            <ArrowRight class="h-4 w-4 ml-2" />
          </Button>
        </section>

        <!-- Stage 2: Upload -->
        <section
          v-else-if="activeStage === 'upload'"
          class="flex-1 min-h-0 flex flex-col overflow-hidden px-8 pt-10 pb-6"
          data-testid="pdfs-stage-upload-panel"
        >
          <div class="max-w-xl mx-auto text-center mb-8 shrink-0">
            <h2 class="text-xl font-medium mb-3">
              <template v-if="needsRetrievalCount === 0">
                Every record has a PDF.
              </template>
              <template v-else>
                <span class="tabular-nums">{{ needsRetrievalCount }}</span>
                {{ needsRetrievalCount === 1 ? 'record' : 'records' }}
                still {{ needsRetrievalCount === 1 ? 'needs' : 'need' }} a PDF.
              </template>
            </h2>
            <p class="text-sm text-muted-foreground leading-relaxed max-w-prose mx-auto mb-6">
              <template v-if="needsRetrievalCount === 0">
                Move on to preparation when you're ready.
              </template>
              <template v-else>
                CoLRev couldn't find these automatically. Upload them in bulk,
                one at a time below, or mark any you can't find as unavailable.
              </template>
            </p>
            <Button
              v-if="needsRetrievalCount > 0 && !isReadOnly"
              variant="default"
              data-testid="pdfs-batch-upload-btn"
              @click="showBatchUpload = true"
            >
              <FileUp class="h-4 w-4 mr-2" />
              Batch upload PDFs
            </Button>
          </div>

          <div
            v-if="isLoading"
            class="max-w-4xl mx-auto w-full flex items-center justify-center py-12"
          >
            <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
          <div
            v-else-if="records.length > 0"
            class="max-w-7xl mx-auto w-full flex-1 min-h-0 flex flex-col"
          >
            <PdfRecordTable
              :records="records"
              title="records"
              :show-status="true"
              :show-actions="!isReadOnly"
              :uploading-record-id="uploadingRecordId"
              :marking-record-id="markingRecordId"
              :undoing-record-id="undoingRecordId"
              :upload-results="uploadResults"
              :filter-pills="UPLOAD_STAGE_PILLS"
              :default-pill-idx="0"
              test-id="pdfs-upload-section"
              @upload="uploadPdfForRecord"
              @mark-not-available="markNotAvailable"
              @undo-not-available="undoNotAvailable"
            />
          </div>
        </section>

        <!-- Stage 3: Prepare -->
        <section
          v-else-if="activeStage === 'prepare'"
          class="flex-1 min-h-0 flex flex-col overflow-hidden px-8 pt-10 pb-6"
          data-testid="pdfs-stage-prepare-panel"
        >
          <div class="max-w-xl mx-auto text-center mb-6 shrink-0">
            <h2 class="text-xl font-medium mb-3">
              <template v-if="importedCount === 0">
                Nothing to prepare yet.
              </template>
              <template v-else>
                <span class="tabular-nums">{{ importedCount }}</span>
                {{ importedCount === 1 ? 'PDF is' : 'PDFs are' }} ready to prepare.
              </template>
            </h2>
            <p class="text-sm text-muted-foreground leading-relaxed max-w-prose mx-auto mb-8">
              <template v-if="importedCount === 0">
                Upload PDFs first, then come back here to prepare them.
              </template>
              <template v-else>
                Preparation validates each PDF, extracts its text, and flags any
                that need a cleaner copy.
              </template>
            </p>
            <OperationButton
              v-if="projects.currentProjectId && importedCount > 0"
              operation="pdf_prep"
              :project-id="projects.currentProjectId"
              label="Prepare PDFs"
              running-label="Preparing PDFs"
              :disabled="!canRunPdfPrep"
              show-progress
              test-id="pdfs-prepare-btn"
              @success="handleOperationComplete"
              @error="handleOperationError"
            />
          </div>

          <div
            v-if="importedCount > 0 || preparedCount > 0"
            class="max-w-7xl mx-auto w-full flex-1 min-h-0 flex flex-col"
          >
            <PdfRecordTable
              :records="records"
              title="records"
              :show-status="true"
              :filter-pills="PREPARE_STAGE_PILLS"
              :default-pill-idx="0"
              test-id="pdfs-prepare-section"
            />
          </div>
        </section>

        <!-- Stage 4: Fix defects -->
        <section
          v-else-if="activeStage === 'fix'"
          class="flex-1 min-h-0 flex flex-col overflow-hidden px-8 pt-10 pb-6"
          data-testid="pdfs-stage-fix-panel"
        >
          <div class="max-w-xl mx-auto text-center mb-8 shrink-0">
            <h2 class="text-xl font-medium mb-3">
              <span class="tabular-nums">{{ needsPrepCount }}</span>
              {{ needsPrepCount === 1 ? 'PDF needs' : 'PDFs need' }} a cleaner copy.
            </h2>
            <p class="text-sm text-muted-foreground leading-relaxed max-w-prose mx-auto">
              These PDFs were retrieved but have issues that prevent text
              extraction. Re-upload a better copy from another source — each
              row below explains what's wrong.
            </p>
          </div>

          <div
            v-if="isLoading"
            class="max-w-4xl mx-auto w-full flex items-center justify-center py-12"
          >
            <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
          <div
            v-else
            class="max-w-7xl mx-auto w-full flex-1 min-h-0 flex flex-col"
          >
            <PdfRecordTable
              :records="records"
              title="records"
              :show-status="true"
              :show-actions="!isReadOnly"
              :uploading-record-id="uploadingRecordId"
              :marking-record-id="markingRecordId"
              :undoing-record-id="undoingRecordId"
              :upload-results="uploadResults"
              :filter-pills="FIX_STAGE_PILLS"
              :default-pill-idx="0"
              :defects-as-prose="true"
              test-id="pdfs-fix-section"
              @upload="uploadPdfForRecord"
              @mark-not-available="markNotAvailable"
              @undo-not-available="undoNotAvailable"
            />
          </div>
        </section>

        <!-- Stage 5: Summary -->
        <div
          v-else-if="activeStage === 'summary' && allDone"
          class="flex-1 min-h-0 overflow-auto max-w-xl mx-auto px-8 py-20 text-center"
          data-testid="pdfs-all-done"
        >
          <div
            class="h-12 w-12 rounded-full bg-green-50 dark:bg-green-950/30 flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle2 class="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <h2 class="text-xl font-medium mb-2">
            All
            <span class="tabular-nums">{{ preparedCount }}</span>
            {{ preparedCount === 1 ? 'PDF is' : 'PDFs are' }} ready.
          </h2>
          <p class="text-sm text-muted-foreground leading-relaxed">
            You can move on to the Screen step whenever you're ready.
          </p>
        </div>

        <section
          v-else-if="activeStage === 'summary'"
          class="flex-1 min-h-0 flex flex-col overflow-hidden px-8 pt-10 pb-6"
          data-testid="pdfs-stage-summary-panel"
        >
          <div class="max-w-2xl mx-auto text-center mb-8 shrink-0">
            <h2 class="text-xl font-medium mb-3">
              <template v-if="missingOnDiskCount > 0">
                <span class="tabular-nums">{{ missingOnDiskCount }}</span>
                {{ missingOnDiskCount === 1 ? "PDF isn't" : "PDFs aren't" }}
                on this machine.
              </template>
              <template v-else>PDF summary.</template>
            </h2>
            <p class="text-sm text-muted-foreground leading-relaxed max-w-prose mx-auto mb-4">
              <template v-if="missingOnDiskCount > 0">
                PDFs aren't synced by git. Import a teammate's zip to restore them in one shot,
                or upload each one individually from the table below.
              </template>
              <template v-else>
                Everything checks out. Browse the full record list below for a final review.
              </template>
            </p>
            <div
              v-if="missingOnDiskCount > 0 && !isReadOnly"
              class="flex items-center justify-center gap-2"
              data-testid="pdfs-summary-import-cta"
            >
              <PdfShareActions variant="default" actions="import-only" />
              <span class="text-[11px] text-muted-foreground/70">
                Import a teammate's PDFs zip.
              </span>
            </div>
          </div>

          <div
            v-if="isLoading"
            class="max-w-4xl mx-auto w-full flex items-center justify-center py-12"
          >
            <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
          <div
            v-else
            class="max-w-7xl mx-auto w-full flex-1 min-h-0 flex flex-col"
          >
            <PdfRecordTable
              :records="records"
              title="records"
              :show-status="true"
              :show-actions="!isReadOnly"
              :uploading-record-id="uploadingRecordId"
              :marking-record-id="markingRecordId"
              :undoing-record-id="undoingRecordId"
              :upload-results="uploadResults"
              :filter-pills="SUMMARY_STAGE_PILLS"
              :default-pill-idx="missingOnDiskCount > 0 ? 0 : 1"
              test-id="pdfs-summary-section"
              @upload="uploadPdfForRecord"
              @mark-not-available="markNotAvailable"
              @undo-not-available="undoNotAvailable"
              @upload-missing="uploadMissingFileForRecord"
            />
          </div>
        </section>
      </div>
    </template>

    <!-- Hidden file input for single PDF upload -->
    <input
      ref="pdfFileInput"
      type="file"
      accept=".pdf"
      class="sr-only"
      data-testid="pdf-file-input"
      @change="handlePdfFileSelected"
    />

    <!-- Batch Upload Dialog -->
    <BatchUploadDialog
      v-model:open="showBatchUpload"
      :records="needsRetrievalRecords"
      @complete="handleBatchUploadComplete"
    />
  </div>
  </StepPageShell>
</template>
