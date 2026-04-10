<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  FileDown,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileUp,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OperationButton } from '@/components/common';
import PdfRecordTable from '@/components/pdf-get/PdfRecordTable.vue';
import BatchUploadDialog from '@/components/pdf-get/BatchUploadDialog.vue';
import type { PdfRecord, UploadResult } from '@/components/pdf-get/PdfRecordTable.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';
import type { GetRecordsResponse, UploadPdfResponse, MarkPdfNotAvailableResponse, UndoPdfNotAvailableResponse } from '@/types/api';

const props = defineProps<{
  projectId: string;
  step: 1 | 2 | 3;
}>();

const emit = defineEmits<{
  'go-to-next': [];
  'all-pdfs-ready': [];
}>();

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const { isReadOnly } = useReadOnly();

const pdfGetInfo = computed(() => projects.operationInfo.pdf_get);
const pdfPrepInfo = computed(() => projects.operationInfo.pdf_prep);

const records = ref<PdfRecord[]>([]);
const isLoading = ref(false);
const searchText = ref('');
const uploadingRecordId = ref<string | null>(null);
const markingRecordId = ref<string | null>(null);
const undoingRecordId = ref<string | null>(null);
const showBatchUpload = ref(false);
const pdfFileInput = ref<HTMLInputElement | null>(null);
const pendingUploadRecordId = ref<string | null>(null);
const uploadResults = ref<Record<string, UploadResult>>({});
const notAvailableExpanded = ref(false);

// Status counts from project status
const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const revPrescreenIncludedCount = computed(() => statusCounts.value?.rev_prescreen_included ?? 0);
const needsPdfCount = computed(() => statusCounts.value?.pdf_needs_manual_retrieval ?? 0);
const pdfImportedCount = computed(() => statusCounts.value?.pdf_imported ?? 0);
const pdfPreparedCount = computed(() => statusCounts.value?.pdf_prepared ?? 0);
const pdfNeedsPrepCount = computed(() => statusCounts.value?.pdf_needs_manual_preparation ?? 0);
const pdfNotAvailableCount = computed(() => statusCounts.value?.pdf_not_available ?? 0);

// Step 1: can proceed once some records have moved to import/prep/prepared/not-available
const step1CanProceed = computed(() =>
  pdfImportedCount.value > 0 ||
  pdfPreparedCount.value > 0 ||
  pdfNeedsPrepCount.value > 0 ||
  pdfNotAvailableCount.value > 0,
);
const step1AllDone = computed(() =>
  revPrescreenIncludedCount.value === 0 && needsPdfCount.value === 0,
);

// Step 2: can proceed once some records are prepared or not-available
const step2CanProceed = computed(() =>
  pdfPreparedCount.value > 0 || pdfNotAvailableCount.value > 0,
);
const step2AllDone = computed(() =>
  pdfImportedCount.value === 0 && pdfNeedsPrepCount.value === 0,
);

// Records split by status
const needsRetrievalRecords = computed(() =>
  records.value.filter((r) => r.colrev_status === 'pdf_needs_manual_retrieval'),
);
const needsPrepRecords = computed(() =>
  records.value.filter((r) => r.colrev_status === 'pdf_needs_manual_preparation'),
);
const notAvailableRecords = computed(() =>
  records.value.filter((r) => r.colrev_status === 'pdf_not_available'),
);

function filterBySearch(recs: PdfRecord[]) {
  if (!searchText.value) return recs;
  const q = searchText.value.toLowerCase();
  return recs.filter(
    (r) =>
      r.title?.toLowerCase().includes(q) ||
      r.author?.toLowerCase().includes(q) ||
      r.ID.toLowerCase().includes(q),
  );
}

const filteredNeedsRetrievalRecords = computed(() => filterBySearch(needsRetrievalRecords.value));
const filteredNeedsPrepRecords = computed(() => filterBySearch(needsPrepRecords.value));
const filteredNotAvailableRecords = computed(() => filterBySearch(notAvailableRecords.value));

async function loadRecords() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  isLoading.value = true;
  try {
    const response = await backend.call<GetRecordsResponse>('get_records', {
      project_id: projects.currentProjectId,
      filters: {
        status: [
          'pdf_needs_manual_retrieval',
          'pdf_imported',
          'pdf_not_available',
          'pdf_prepared',
          'pdf_needs_manual_preparation',
        ],
      },
      pagination: { offset: 0, limit: 500 },
      fields: ['ID', 'title', 'author', 'year', 'colrev_status', 'journal', 'booktitle', 'doi', 'colrev_data_provenance'],
    });
    if (response.success) {
      records.value = response.records as unknown as PdfRecord[];
    }
  } catch (err) {
    console.error('Failed to load PDF records:', err);
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
  if (pdfFileInput.value) {
    pdfFileInput.value.value = '';
    pdfFileInput.value.click();
  }
}

async function handlePdfFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const recordId = pendingUploadRecordId.value;
  if (!file || !recordId || !projects.currentProjectId) return;

  uploadingRecordId.value = recordId;
  try {
    const content = await readFileAsBase64(file);
    const response = await backend.call<UploadPdfResponse>('upload_pdf', {
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
          message: response.prep_message || 'PDF needs manual preparation',
        };
        notifications.warning(
          'PDF uploaded, needs prep',
          response.prep_message || `${recordId} needs manual preparation`,
        );
      } else {
        uploadResults.value[recordId] = { status: 'success' };
        notifications.success('PDF uploaded', `PDF linked to ${recordId}`);
      }
      setTimeout(async () => { await refresh(); }, 2000);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    uploadResults.value[recordId] = { status: 'error', message };
    notifications.error('Upload failed', message);
  } finally {
    uploadingRecordId.value = null;
    pendingUploadRecordId.value = null;
  }
}

async function markNotAvailable(recordId: string) {
  if (!projects.currentProjectId) return;
  markingRecordId.value = recordId;
  try {
    const response = await backend.call<MarkPdfNotAvailableResponse>('mark_pdf_not_available', {
      project_id: projects.currentProjectId,
      record_id: recordId,
    });
    if (response.success) {
      notifications.success('Marked not available', `${recordId} → ${response.new_status}`);
      await refresh();
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
    const response = await backend.call<UndoPdfNotAvailableResponse>('undo_pdf_not_available', {
      project_id: projects.currentProjectId,
      record_id: recordId,
    });
    if (response.success) {
      notifications.success('Restored', `${recordId} is back in "Needs PDF"`);
      await refresh();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to undo', message);
  } finally {
    undoingRecordId.value = null;
  }
}

async function refresh() {
  await Promise.all([loadRecords(), projects.refreshCurrentProject()]);
}

async function handleOperationComplete() {
  await refresh();
}

async function handleBatchUploadComplete() {
  showBatchUpload.value = false;
  await refresh();
}

// Re-load records when the active step changes into this component
watch(() => props.step, async () => {
  await refresh();
});

onMounted(async () => {
  await projects.refreshCurrentProject();
  await loadRecords();
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden" data-testid="pdfs-section">

    <!-- ── Step 1: Retrieve PDFs ───────────────────────────────────── -->
    <template v-if="step === 1">

      <!-- Header -->
      <div class="shrink-0 border-b px-6 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base font-semibold">Retrieve PDFs</h2>
              <Badge v-if="revPrescreenIncludedCount + needsPdfCount > 0" variant="secondary" class="text-xs">
                {{ revPrescreenIncludedCount + needsPdfCount }} pending
              </Badge>
              <Badge v-else-if="step1CanProceed" class="text-xs bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                Complete
              </Badge>
            </div>
            <p class="text-sm text-muted-foreground mt-0.5">
              <template v-if="revPrescreenIncludedCount > 0 && needsPdfCount === 0">
                {{ revPrescreenIncludedCount }} record{{ revPrescreenIncludedCount !== 1 ? 's' : '' }} queued — run PDF Get to fetch PDFs automatically.
              </template>
              <template v-else-if="needsPdfCount > 0">
                {{ needsPdfCount }} record{{ needsPdfCount !== 1 ? 's' : '' }} could not be retrieved automatically — upload PDFs or mark as not available.
              </template>
              <template v-else-if="step1CanProceed">
                All records have been processed. Continue to prepare them.
              </template>
              <template v-else>
                No records are queued for PDF retrieval yet.
              </template>
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <OperationButton
              v-if="!isReadOnly && pdfGetInfo?.can_run && revPrescreenIncludedCount > 0"
              operation="pdf_get"
              :project-id="projectId"
              label="Run PDF Get"
              show-progress
              data-testid="run-pdf-get-btn"
              @success="handleOperationComplete"
            />
            <Button
              v-if="step1CanProceed"
              data-testid="pdf-step1-next-btn"
              @click="$emit('go-to-next')"
            >
              Prepare PDFs
              <ArrowRight class="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 min-h-0 overflow-auto px-6 py-4">

        <!-- Loading -->
        <div v-if="isLoading" class="flex items-center justify-center py-16">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>

        <!-- All retrieved (nothing pending) -->
        <div
          v-else-if="step1AllDone && step1CanProceed"
          class="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
            <CheckCircle2 class="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <p class="font-medium">Retrieval complete</p>
            <p class="text-sm text-muted-foreground mt-0.5">All PDFs have been retrieved or marked. Click "Prepare PDFs" to continue.</p>
          </div>
        </div>

        <!-- Waiting for auto-retrieval (revPrescreen > 0, no manual needed) -->
        <div
          v-else-if="revPrescreenIncludedCount > 0 && needsPdfCount === 0"
          class="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <FileDown class="h-10 w-10 text-muted-foreground" />
          <div>
            <p class="font-medium">{{ revPrescreenIncludedCount }} record{{ revPrescreenIncludedCount !== 1 ? 's' : '' }} ready for retrieval</p>
            <p class="text-sm text-muted-foreground mt-0.5">Click "Run PDF Get" to fetch PDFs automatically.</p>
          </div>
        </div>

        <!-- Manual retrieval list -->
        <template v-else-if="needsPdfCount > 0">
          <div class="flex items-center gap-2 mb-4">
            <div class="relative flex-1 max-w-xs">
              <Input
                v-model="searchText"
                placeholder="Search records..."
                class="h-8 text-sm"
                data-testid="pdfs-search"
              />
            </div>
            <Button
              v-if="!isReadOnly"
              variant="outline"
              size="sm"
              data-testid="pdfs-batch-upload-btn"
              @click="showBatchUpload = true"
            >
              <FileUp class="h-4 w-4 mr-2" />
              Batch Upload
            </Button>
          </div>
          <PdfRecordTable
            :records="filteredNeedsRetrievalRecords"
            :uploading-record-id="uploadingRecordId"
            :marking-record-id="markingRecordId"
            :undoing-record-id="undoingRecordId"
            :upload-results="uploadResults"
            :show-actions="!isReadOnly"
            @upload="uploadPdfForRecord"
            @mark-not-available="markNotAvailable"
            @undo-not-available="undoNotAvailable"
          />
        </template>

        <!-- Nothing to do yet -->
        <div
          v-else
          class="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <FileDown class="h-10 w-10 text-muted-foreground" />
          <div>
            <p class="font-medium text-muted-foreground">No records queued for retrieval</p>
            <p class="text-sm text-muted-foreground mt-0.5">Records will appear here after prescreen.</p>
          </div>
        </div>

      </div>
    </template>

    <!-- ── Step 2: Prepare PDFs ────────────────────────────────────── -->
    <template v-else-if="step === 2">

      <!-- Header -->
      <div class="shrink-0 border-b px-6 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-base font-semibold">Prepare PDFs</h2>
              <Badge v-if="pdfImportedCount + pdfNeedsPrepCount > 0" variant="secondary" class="text-xs">
                {{ pdfImportedCount + pdfNeedsPrepCount }} pending
              </Badge>
              <Badge v-else-if="step2CanProceed" class="text-xs bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                Complete
              </Badge>
            </div>
            <p class="text-sm text-muted-foreground mt-0.5">
              <template v-if="pdfImportedCount > 0 && pdfNeedsPrepCount === 0">
                {{ pdfImportedCount }} PDF{{ pdfImportedCount !== 1 ? 's' : '' }} ready — run PDF Prep to validate quality automatically.
              </template>
              <template v-else-if="pdfNeedsPrepCount > 0">
                {{ pdfNeedsPrepCount }} PDF{{ pdfNeedsPrepCount !== 1 ? 's' : '' }} have quality issues — re-upload corrected versions.
              </template>
              <template v-else-if="step2CanProceed">
                All PDFs have been prepared. Continue to review the results.
              </template>
              <template v-else>
                No PDFs are waiting for preparation yet.
              </template>
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <OperationButton
              v-if="!isReadOnly && pdfPrepInfo?.can_run && pdfImportedCount > 0"
              operation="pdf_prep"
              :project-id="projectId"
              label="Run PDF Prep"
              show-progress
              data-testid="run-pdf-prep-btn"
              @success="handleOperationComplete"
            />
            <Button
              v-if="step2CanProceed"
              data-testid="pdf-step2-next-btn"
              @click="$emit('go-to-next')"
            >
              Review Results
              <ArrowRight class="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 min-h-0 overflow-auto px-6 py-4">

        <!-- Loading -->
        <div v-if="isLoading" class="flex items-center justify-center py-16">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>

        <!-- All prepared -->
        <div
          v-else-if="step2AllDone && step2CanProceed"
          class="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
            <CheckCircle2 class="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <p class="font-medium">Preparation complete</p>
            <p class="text-sm text-muted-foreground mt-0.5">All PDFs have been prepared. Click "Review Results" to continue.</p>
          </div>
        </div>

        <!-- Waiting for PDF Prep to run (imported > 0, no manual failures) -->
        <div
          v-else-if="pdfImportedCount > 0 && pdfNeedsPrepCount === 0"
          class="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <FileCheck class="h-10 w-10 text-muted-foreground" />
          <div>
            <p class="font-medium">{{ pdfImportedCount }} PDF{{ pdfImportedCount !== 1 ? 's' : '' }} ready to prepare</p>
            <p class="text-sm text-muted-foreground mt-0.5">Click "Run PDF Prep" to validate quality and prepare for screening.</p>
          </div>
        </div>

        <!-- Manual prep list -->
        <template v-else-if="pdfNeedsPrepCount > 0">
          <div class="flex items-center gap-2 mb-4">
            <div class="relative flex-1 max-w-xs">
              <Input
                v-model="searchText"
                placeholder="Search records..."
                class="h-8 text-sm"
                data-testid="pdfs-search-prep"
              />
            </div>
          </div>
          <PdfRecordTable
            :records="filteredNeedsPrepRecords"
            :uploading-record-id="uploadingRecordId"
            :upload-results="uploadResults"
            :show-actions="!isReadOnly"
            @upload="uploadPdfForRecord"
          />
        </template>

        <!-- Nothing yet -->
        <div
          v-else
          class="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <FileCheck class="h-10 w-10 text-muted-foreground" />
          <div>
            <p class="font-medium text-muted-foreground">No PDFs waiting for preparation</p>
            <p class="text-sm text-muted-foreground mt-0.5">Go back to retrieve PDFs first.</p>
          </div>
        </div>

      </div>
    </template>

    <!-- ── Step 3: Review ──────────────────────────────────────────── -->
    <template v-else>

      <!-- Header -->
      <div class="shrink-0 border-b px-6 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold">Review</h2>
              <Badge v-if="pdfPreparedCount > 0" class="text-xs bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                {{ pdfPreparedCount }} ready
              </Badge>
            </div>
            <p class="text-sm text-muted-foreground mt-0.5">
              Review PDF retrieval results before starting full-text screening.
            </p>
          </div>
          <Button
            v-if="pdfPreparedCount > 0"
            data-testid="pdf-start-screening-btn"
            @click="$emit('all-pdfs-ready')"
          >
            Start Screening
            <ArrowRight class="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 min-h-0 overflow-auto px-6 py-4">

        <!-- Loading -->
        <div v-if="isLoading" class="flex items-center justify-center py-16">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>

        <template v-else>

          <!-- Summary stats -->
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
            <div class="rounded-lg border px-4 py-3">
              <div class="text-2xl font-semibold tabular-nums">{{ pdfPreparedCount }}</div>
              <div class="text-xs text-muted-foreground mt-0.5">Ready to screen</div>
            </div>
            <div class="rounded-lg border px-4 py-3">
              <div class="text-2xl font-semibold tabular-nums">{{ pdfNotAvailableCount }}</div>
              <div class="text-xs text-muted-foreground mt-0.5">Not available</div>
            </div>
            <div class="rounded-lg border px-4 py-3">
              <div class="text-2xl font-semibold tabular-nums">{{ pdfNeedsPrepCount }}</div>
              <div class="text-xs text-muted-foreground mt-0.5">Needs manual prep</div>
            </div>
            <div class="rounded-lg border px-4 py-3">
              <div class="text-2xl font-semibold tabular-nums">{{ needsPdfCount }}</div>
              <div class="text-xs text-muted-foreground mt-0.5">Needs retrieval</div>
            </div>
          </div>

          <!-- Not Available section (collapsible) -->
          <div
            v-if="pdfNotAvailableCount > 0"
            class="rounded-lg border mb-4"
            data-testid="pdf-not-available-section"
          >
            <button
              class="flex w-full items-center gap-2 px-4 py-3 text-left"
              @click="notAvailableExpanded = !notAvailableExpanded"
            >
              <ChevronDown v-if="notAvailableExpanded" class="h-4 w-4 text-muted-foreground shrink-0" />
              <ChevronRight v-else class="h-4 w-4 text-muted-foreground shrink-0" />
              <span class="text-sm font-medium">Not Available</span>
              <Badge variant="outline" class="text-xs h-5 ml-1">{{ pdfNotAvailableCount }}</Badge>
              <span class="text-xs text-muted-foreground ml-1">— click Undo to restore, or Upload to add a PDF</span>
            </button>
            <div v-if="notAvailableExpanded" class="border-t px-4 pb-3 pt-2">
              <PdfRecordTable
                :records="filteredNotAvailableRecords"
                :uploading-record-id="uploadingRecordId"
                :undoing-record-id="undoingRecordId"
                :upload-results="uploadResults"
                :show-actions="!isReadOnly"
                @upload="uploadPdfForRecord"
                @undo-not-available="undoNotAvailable"
              />
            </div>
          </div>

          <!-- No PDFs ready at all -->
          <div
            v-if="pdfPreparedCount === 0"
            class="flex flex-col items-center justify-center gap-3 py-12 text-center"
          >
            <AlertCircle class="h-10 w-10 text-muted-foreground" />
            <div>
              <p class="font-medium">No PDFs ready for screening</p>
              <p class="text-sm text-muted-foreground mt-0.5">
                Go back to retrieve and prepare PDFs first.
              </p>
            </div>
          </div>

        </template>
      </div>
    </template>

    <!-- Hidden file input -->
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
</template>
