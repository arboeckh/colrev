<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  FileDown,
  CheckCircle2,
  FileUp,
  Loader2,
  Lock,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { OperationButton, EmptyState } from '@/components/common';
import PdfRecordTable from '@/components/pdf-get/PdfRecordTable.vue';
import BatchUploadDialog from '@/components/pdf-get/BatchUploadDialog.vue';
import type { PdfRecord, UploadResult } from '@/components/pdf-get/PdfRecordTable.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';
import type { GetRecordsResponse, UploadPdfResponse, MarkPdfNotAvailableResponse } from '@/types/api';

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const { isReadOnly } = useReadOnly();

type FilterKey = 'action' | 'completed' | 'unavailable' | 'all';

const records = ref<PdfRecord[]>([]);
const isLoading = ref(false);
const activeFilter = ref<FilterKey>('action');
const uploadingRecordId = ref<string | null>(null);
const markingRecordId = ref<string | null>(null);
const undoingRecordId = ref<string | null>(null);
const showBatchUpload = ref(false);
const pdfFileInput = ref<HTMLInputElement | null>(null);
const pendingUploadRecordId = ref<string | null>(null);
const uploadResults = ref<Record<string, UploadResult>>({});

const counts = computed(() => projects.currentStatus?.currently ?? null);
const prescreenIncludedCount = computed(() => counts.value?.rev_prescreen_included ?? 0);
const needsRetrievalCount = computed(() => counts.value?.pdf_needs_manual_retrieval ?? 0);
const importedCount = computed(() => counts.value?.pdf_imported ?? 0);
const preparedCount = computed(() => counts.value?.pdf_prepared ?? 0);
const needsPrepCount = computed(() => counts.value?.pdf_needs_manual_preparation ?? 0);
const notAvailableCount = computed(() => counts.value?.pdf_not_available ?? 0);

const anyPdfActivity = computed(
  () =>
    needsRetrievalCount.value +
      importedCount.value +
      preparedCount.value +
      needsPrepCount.value +
      notAvailableCount.value >
    0,
);

const completedCount = computed(() => importedCount.value + preparedCount.value);
const actionCount = computed(() => needsRetrievalCount.value + needsPrepCount.value);
const readyToRetrieveCount = computed(
  () => prescreenIncludedCount.value + needsRetrievalCount.value,
);

type PageState = 'blocked' | 'not-run' | 'post-run';

const pageState = computed<PageState>(() => {
  if (!anyPdfActivity.value && prescreenIncludedCount.value === 0) return 'blocked';
  if (!anyPdfActivity.value) return 'not-run';
  return 'post-run';
});

const canRunPdfGet = computed(() => projects.operationInfo.pdf_get?.can_run ?? false);
const showRetrieveButton = computed(
  () =>
    pageState.value === 'post-run' &&
    (readyToRetrieveCount.value > 0 || canRunPdfGet.value),
);
const allDone = computed(
  () =>
    pageState.value === 'post-run' &&
    actionCount.value === 0 &&
    readyToRetrieveCount.value === 0 &&
    preparedCount.value > 0,
);

const filteredRecords = computed(() => {
  if (activeFilter.value === 'action') {
    return records.value.filter(
      (r) =>
        r.colrev_status === 'pdf_needs_manual_retrieval' ||
        r.colrev_status === 'pdf_needs_manual_preparation',
    );
  }
  if (activeFilter.value === 'completed') {
    return records.value.filter(
      (r) => r.colrev_status === 'pdf_imported' || r.colrev_status === 'pdf_prepared',
    );
  }
  if (activeFilter.value === 'unavailable') {
    return records.value.filter((r) => r.colrev_status === 'pdf_not_available');
  }
  return records.value;
});

const needsPdfRecords = computed(() =>
  records.value.filter((r) => r.colrev_status === 'pdf_needs_manual_retrieval'),
);

const filterTabs: { key: FilterKey; label: string; count: () => number }[] = [
  { key: 'action', label: 'Action needed', count: () => actionCount.value },
  { key: 'completed', label: 'Completed', count: () => completedCount.value },
  { key: 'unavailable', label: 'Unavailable', count: () => notAvailableCount.value },
  { key: 'all', label: 'All', count: () => records.value.length },
];

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

      setTimeout(async () => {
        await refresh();
      }, 2000);
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
    const response = await backend.call<MarkPdfNotAvailableResponse>('undo_pdf_not_available', {
      project_id: projects.currentProjectId,
      record_id: recordId,
    });

    if (response.success) {
      notifications.success('Restored', `${recordId} ready for retrieval`);
      await refresh();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed', message);
  } finally {
    undoingRecordId.value = null;
  }
}

async function refresh() {
  await Promise.all([loadRecords(), projects.refreshCurrentProject()]);
}

async function handleOperationComplete() {
  activeFilter.value = 'action';
  await refresh();
}

async function handleBatchUploadComplete() {
  showBatchUpload.value = false;
  await refresh();
}

onMounted(async () => {
  await projects.refreshCurrentProject();
  await loadRecords();
});
</script>

<template>
  <div class="p-6 h-full flex flex-col space-y-6" data-testid="pdfs-page">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <FileDown class="h-6 w-6" />
          PDFs
        </h2>
        <p class="text-muted-foreground text-sm">Retrieve and prepare PDFs for included records</p>
      </div>

      <div class="flex items-center gap-3">
        <div
          v-if="allDone"
          class="flex items-center gap-2 text-green-600 dark:text-green-400"
        >
          <CheckCircle2 class="h-5 w-5" />
          <span class="text-sm font-medium">All retrieved</span>
        </div>

        <OperationButton
          v-if="projects.currentProjectId && (pageState === 'not-run' || showRetrieveButton)"
          operation="pdf_get"
          :project-id="projects.currentProjectId"
          :label="pageState === 'not-run' ? 'Retrieve PDFs' : 'Re-run retrieval'"
          :disabled="!canRunPdfGet"
          show-progress
          test-id="pdfs-retrieve-btn"
          @success="handleOperationComplete"
        />
      </div>
    </div>

    <Separator />

    <!-- Blocked state: prescreen not done -->
    <div v-if="pageState === 'blocked'" class="flex-1 flex items-center justify-center">
      <EmptyState
        :icon="Lock"
        title="Complete prescreening first"
        description="PDF retrieval starts once records have been included in the prescreen."
      />
    </div>

    <!-- Not-run state: centered CTA -->
    <div
      v-else-if="pageState === 'not-run'"
      class="flex-1 flex flex-col items-center justify-center text-center px-6"
      data-testid="pdfs-not-run"
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted/40 mb-6">
        <FileDown class="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 class="text-xl font-semibold mb-2">
        Retrieve PDFs for {{ prescreenIncludedCount }}
        record{{ prescreenIncludedCount === 1 ? '' : 's' }}
      </h3>
      <p class="text-sm text-muted-foreground max-w-md mb-8">
        CoLRev will attempt automated retrieval and preparation.
        Records it can't find will be listed for manual upload.
      </p>
      <OperationButton
        v-if="projects.currentProjectId"
        operation="pdf_get"
        :project-id="projects.currentProjectId"
        label="Retrieve PDFs"
        :disabled="!canRunPdfGet"
        show-progress
        test-id="pdfs-retrieve-cta"
        @success="handleOperationComplete"
      />
    </div>

    <!-- Post-run state -->
    <template v-else>
      <!-- Filter row + batch upload -->
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-6 text-sm">
          <button
            v-for="tab in filterTabs"
            :key="tab.key"
            type="button"
            class="relative -mb-px pb-1 border-b-2 transition-colors"
            :class="[
              activeFilter === tab.key
                ? 'border-foreground text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ]"
            :data-testid="`pdfs-filter-${tab.key}`"
            @click="activeFilter = tab.key"
          >
            {{ tab.label }}
            <span class="ml-1.5 text-xs tabular-nums text-muted-foreground/70">
              {{ tab.count() }}
            </span>
          </button>
        </div>

        <button
          v-if="needsPdfRecords.length > 0 && !isReadOnly"
          type="button"
          class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="pdfs-batch-upload-btn"
          @click="showBatchUpload = true"
        >
          <FileUp class="h-3.5 w-3.5" />
          Batch upload PDFs
        </button>
      </div>

      <Separator />

      <!-- Record list -->
      <div class="flex-1 min-h-0 overflow-auto -mx-6 px-6">
        <div
          v-if="isLoading"
          class="flex items-center justify-center py-12"
        >
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>

        <div
          v-else-if="filteredRecords.length === 0"
          class="flex items-center justify-center py-12 text-sm text-muted-foreground"
          data-testid="pdfs-empty-filter"
        >
          <template v-if="activeFilter === 'action'">
            <CheckCircle2 class="h-4 w-4 mr-2 text-green-600" />
            Nothing needs action
          </template>
          <template v-else-if="activeFilter === 'completed'">
            No records completed yet
          </template>
          <template v-else-if="activeFilter === 'unavailable'">
            No records marked unavailable
          </template>
          <template v-else>
            No records
          </template>
        </div>

        <PdfRecordTable
          v-else
          :records="filteredRecords"
          :uploading-record-id="uploadingRecordId"
          :marking-record-id="markingRecordId"
          :undoing-record-id="undoingRecordId"
          :upload-results="uploadResults"
          :show-actions="!isReadOnly"
          @upload="uploadPdfForRecord"
          @mark-not-available="markNotAvailable"
          @undo-not-available="undoNotAvailable"
        />
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
      :records="needsPdfRecords"
      @complete="handleBatchUploadComplete"
    />
  </div>
</template>
