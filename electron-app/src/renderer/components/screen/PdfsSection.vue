<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  FileDown,
  FileCheck,
  Search,
  Loader2,
  FileUp,
} from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OperationButton, EmptyState } from '@/components/common';
import PdfRecordTable from '@/components/pdf-get/PdfRecordTable.vue';
import BatchUploadDialog from '@/components/pdf-get/BatchUploadDialog.vue';
import type { PdfRecord, UploadResult } from '@/components/pdf-get/PdfRecordTable.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';
import type { GetRecordsResponse, UploadPdfResponse, MarkPdfNotAvailableResponse } from '@/types/api';

defineProps<{
  projectId: string;
}>();

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const { isReadOnly } = useReadOnly();

const pdfGetInfo = projects.operationInfo.pdf_get;
const pdfPrepInfo = projects.operationInfo.pdf_prep;

const records = ref<PdfRecord[]>([]);
const isLoading = ref(false);
const searchText = ref('');
const activeTab = ref('needs_pdf');
const uploadingRecordId = ref<string | null>(null);
const markingRecordId = ref<string | null>(null);
const showBatchUpload = ref(false);
const pdfFileInput = ref<HTMLInputElement | null>(null);
const pendingUploadRecordId = ref<string | null>(null);
const uploadResults = ref<Record<string, UploadResult>>({});

// Status counts from project status
const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const needsPdfCount = computed(() => statusCounts.value?.pdf_needs_manual_retrieval ?? 0);
const pdfImportedCount = computed(() => statusCounts.value?.pdf_imported ?? 0);
const pdfPreparedCount = computed(() => statusCounts.value?.pdf_prepared ?? 0);
const pdfNeedsPrepCount = computed(() => statusCounts.value?.pdf_needs_manual_preparation ?? 0);
const pdfNotAvailableCount = computed(() => statusCounts.value?.pdf_not_available ?? 0);

const retrievedCount = computed(() => pdfImportedCount.value + pdfPreparedCount.value + pdfNotAvailableCount.value);

// Filter records by tab
const filteredRecords = computed(() => {
  let filtered = records.value;

  if (activeTab.value === 'needs_pdf') {
    filtered = filtered.filter((r) => r.colrev_status === 'pdf_needs_manual_retrieval');
  } else if (activeTab.value === 'retrieved') {
    filtered = filtered.filter((r) =>
      ['pdf_imported', 'pdf_prepared', 'pdf_not_available'].includes(r.colrev_status),
    );
  } else if (activeTab.value === 'needs_prep') {
    filtered = filtered.filter((r) => r.colrev_status === 'pdf_needs_manual_preparation');
  }

  if (searchText.value) {
    const q = searchText.value.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.author?.toLowerCase().includes(q) ||
        r.ID.toLowerCase().includes(q),
    );
  }

  return filtered;
});

const needsPdfRecords = computed(() =>
  records.value.filter((r) => r.colrev_status === 'pdf_needs_manual_retrieval'),
);

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

onMounted(async () => {
  await projects.refreshCurrentProject();
  await loadRecords();
});
</script>

<template>
  <div class="p-4 h-full flex flex-col" data-testid="pdfs-section">
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="text-lg font-medium flex items-center gap-2">
          <FileDown class="h-5 w-5" />
          PDFs
        </h3>
        <p class="text-muted-foreground text-sm">Retrieve and prepare PDF documents</p>
      </div>

      <div class="flex items-center gap-2">
        <OperationButton
          v-if="projects.currentProjectId"
          operation="pdf_get"
          :project-id="projects.currentProjectId"
          label="Run PDF Get"
          :disabled="!pdfGetInfo?.can_run"
          @success="handleOperationComplete"
        />
        <OperationButton
          v-if="projects.currentProjectId"
          operation="pdf_prep"
          :project-id="projects.currentProjectId"
          label="Run PDF Prep"
          :disabled="!pdfPrepInfo?.can_run"
          @success="handleOperationComplete"
        />
      </div>
    </div>

    <!-- Summary badges -->
    <div class="flex items-center gap-3 mb-4" data-testid="pdfs-summary">
      <Badge
        variant="destructive"
        class="px-3 py-1"
        data-testid="pdfs-needs-count"
      >
        {{ needsPdfCount }} Need PDF
      </Badge>
      <Badge
        variant="secondary"
        class="px-3 py-1"
        data-testid="pdfs-imported-count"
      >
        {{ pdfImportedCount }} Imported
      </Badge>
      <Badge
        class="px-3 py-1 bg-green-600 text-white hover:bg-green-600"
        data-testid="pdfs-prepared-count"
      >
        {{ pdfPreparedCount }} Prepared
      </Badge>
      <Badge
        v-if="pdfNeedsPrepCount > 0"
        variant="secondary"
        class="px-3 py-1 border-yellow-500"
        data-testid="pdfs-needs-prep-count"
      >
        {{ pdfNeedsPrepCount }} Needs Prep
      </Badge>
      <Badge
        variant="outline"
        class="px-3 py-1"
        data-testid="pdfs-not-available-count"
      >
        {{ pdfNotAvailableCount }} Not Available
      </Badge>
    </div>

    <!-- Tabs + Search + Batch Upload -->
    <Tabs v-model="activeTab" class="flex-1 flex flex-col min-h-0">
      <div class="flex items-center justify-between mb-3">
        <TabsList>
          <TabsTrigger value="needs_pdf" data-testid="pdfs-tab-needs">
            Needs PDF ({{ needsPdfCount }})
          </TabsTrigger>
          <TabsTrigger value="retrieved" data-testid="pdfs-tab-retrieved">
            Retrieved ({{ retrievedCount }})
          </TabsTrigger>
          <TabsTrigger value="needs_prep" data-testid="pdfs-tab-needs-prep">
            Needs Prep ({{ pdfNeedsPrepCount }})
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="pdfs-tab-all">
            All
          </TabsTrigger>
        </TabsList>

        <div class="flex items-center gap-2">
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              v-model="searchText"
              placeholder="Search records..."
              class="pl-9 w-64"
              data-testid="pdfs-search"
            />
          </div>
          <Button
            v-if="needsPdfRecords.length > 0 && !isReadOnly"
            variant="outline"
            data-testid="pdfs-batch-upload-btn"
            @click="showBatchUpload = true"
          >
            <FileUp class="h-4 w-4 mr-2" />
            Batch Upload PDFs
          </Button>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="isLoading" class="flex-1 flex items-center justify-center">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <!-- Empty state -->
      <EmptyState
        v-else-if="records.length === 0"
        :icon="FileDown"
        title="No PDF records"
        description="Run PDF Get to start retrieving PDFs for your included records."
      />

      <!-- Records tables -->
      <template v-else>
        <TabsContent value="needs_pdf" class="flex-1 min-h-0 mt-0">
          <ScrollArea class="h-full">
            <PdfRecordTable
              :records="filteredRecords"
              :uploading-record-id="uploadingRecordId"
              :marking-record-id="markingRecordId"
              :upload-results="uploadResults"
              :show-actions="!isReadOnly"
              @upload="uploadPdfForRecord"
              @mark-not-available="markNotAvailable"
            />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="retrieved" class="flex-1 min-h-0 mt-0">
          <ScrollArea class="h-full">
            <PdfRecordTable :records="filteredRecords" />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="needs_prep" class="flex-1 min-h-0 mt-0">
          <ScrollArea class="h-full">
            <EmptyState
              v-if="filteredRecords.length === 0"
              :icon="FileCheck"
              title="No records need preparation"
              description="All imported PDFs have been prepared, or none need manual preparation."
            />
            <PdfRecordTable
              v-else
              :records="filteredRecords"
              :uploading-record-id="uploadingRecordId"
              :upload-results="uploadResults"
              :show-actions="!isReadOnly"
              @upload="uploadPdfForRecord"
            />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="all" class="flex-1 min-h-0 mt-0">
          <ScrollArea class="h-full">
            <PdfRecordTable
              :records="filteredRecords"
              :uploading-record-id="uploadingRecordId"
              :marking-record-id="markingRecordId"
              :upload-results="uploadResults"
              :show-actions="!isReadOnly"
              @upload="uploadPdfForRecord"
              @mark-not-available="markNotAvailable"
            />
          </ScrollArea>
        </TabsContent>
      </template>
    </Tabs>

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
      :records="needsPdfRecords"
      @complete="handleBatchUploadComplete"
    />
  </div>
</template>
