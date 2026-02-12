<script setup lang="ts">
import { ref, computed, onMounted, toRaw } from 'vue';
import { Database } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common';
import {
  PdfViewerPanel,
  ScreenSplitPanel,
} from '@/components/screen';
import {
  DataExtractionPanel,
  DataComplete,
  DataFieldsConfigDialog,
} from '@/components/data';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
// notifications removed — progress bar provides sufficient feedback
import type {
  DataField,
  DataExtractionRecord,
  GetDataExtractionQueueResponse,
  SaveDataExtractionResponse,
  ConfigureStructuredEndpointResponse,
} from '@/types/api';

// --- Types ---
interface EnrichedRecord extends DataExtractionRecord {
  _completed: boolean;
}

// --- Stores ---
const projects = useProjectsStore();
const backend = useBackendStore();

// --- State ---
const isConfigured = ref(false);
const fields = ref<DataField[]>([]);
const queue = ref<EnrichedRecord[]>([]);
const currentIndex = ref(0);
const totalCount = ref(0);
const completedCount = ref(0);
const localValues = ref<Record<string, string>>({});
const isLoading = ref(false);
const isSaving = ref(false);
const isSavingFields = ref(false);
const showFieldsDialog = ref(false);

// --- Computed ---
const currentRecord = computed(() => queue.value[currentIndex.value] || null);

const canSave = computed(() => {
  if (!currentRecord.value || fields.value.length === 0) return false;
  return fields.value.every((f) => {
    const val = localValues.value[f.name];
    return val && val.trim() !== '' && val !== 'TODO';
  });
});

const isComplete = computed(
  () => isConfigured.value && fields.value.length > 0 && totalCount.value > 0 && completedCount.value >= totalCount.value,
);

const hasRecords = computed(() => queue.value.length > 0);

// --- Data loading ---
async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  try {
    const response = await backend.call<GetDataExtractionQueueResponse>(
      'get_data_extraction_queue',
      { project_id: projects.currentProjectId },
    );
    if (response.success) {
      isConfigured.value = response.configured;
      fields.value = response.fields || [];
      totalCount.value = response.total_count;
      completedCount.value = response.completed_count;

      const enriched: EnrichedRecord[] = response.records.map((r) => {
        const hasAllFilled = fields.value.length > 0 && fields.value.every((f) => {
          const val = r.extraction_values[f.name];
          return val && val !== 'TODO';
        });
        return { ...r, _completed: hasAllFilled };
      });

      queue.value = enriched;

      // Navigate to first pending record
      const firstPending = enriched.findIndex((r) => !r._completed);
      currentIndex.value = firstPending >= 0 ? firstPending : 0;

      // Initialize local values for current record
      syncLocalValues();
    }
  } catch (err) {
    console.error('Failed to load data extraction queue:', err);
  } finally {
    isLoading.value = false;
  }
}

function syncLocalValues() {
  if (!currentRecord.value) {
    localValues.value = {};
    return;
  }
  localValues.value = { ...currentRecord.value.extraction_values };
}

// --- Save ---
async function saveExtraction() {
  if (!currentRecord.value || !projects.currentProjectId || isSaving.value || !canSave.value) return;

  isSaving.value = true;
  try {
    const response = await backend.call<SaveDataExtractionResponse>(
      'save_data_extraction',
      {
        project_id: projects.currentProjectId,
        record_id: currentRecord.value.id,
        values: { ...toRaw(localValues.value) },
      },
    );

    if (response.success) {
      // Update local state
      currentRecord.value._completed = true;
      currentRecord.value.extraction_values = { ...localValues.value };
      completedCount.value = totalCount.value - response.remaining_count;

      // Auto-advance to next pending
      skipToNextPending();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Save failed:', message);
  } finally {
    isSaving.value = false;
  }
}

// --- Navigation ---
function goToRecord(index: number) {
  if (index >= 0 && index < queue.value.length) {
    currentIndex.value = index;
    syncLocalValues();
  }
}

function skipToNextPending() {
  // Search forward from current
  for (let i = currentIndex.value + 1; i < queue.value.length; i++) {
    if (!queue.value[i]._completed) {
      currentIndex.value = i;
      syncLocalValues();
      return;
    }
  }
  // Search from beginning
  for (let i = 0; i < currentIndex.value; i++) {
    if (!queue.value[i]._completed) {
      currentIndex.value = i;
      syncLocalValues();
      return;
    }
  }
  // All complete — refresh
  loadQueue();
}

function updateValue(fieldName: string, value: string) {
  localValues.value[fieldName] = value;
}

// --- Fields configuration ---
async function handleFieldsConfigured(configuredFields: DataField[]) {
  if (!projects.currentProjectId) return;

  isSavingFields.value = true;
  try {
    const response = await backend.call<ConfigureStructuredEndpointResponse>(
      'configure_structured_endpoint',
      {
        project_id: projects.currentProjectId,
        fields: configuredFields,
      },
    );

    if (response.success) {
      showFieldsDialog.value = false;
      await loadQueue();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Configuration failed:', message);
  } finally {
    isSavingFields.value = false;
  }
}

// --- Lifecycle ---
onMounted(async () => {
  await projects.refreshCurrentProject();
  await loadQueue();
});
</script>

<template>
  <div class="h-full flex flex-col" data-testid="data-page">
    <!-- Not configured state -->
    <EmptyState
      v-if="!isLoading && !isConfigured"
      :icon="Database"
      title="Configure data extraction"
      description="Set up extraction fields to begin structured data extraction from your included records."
    >
      <template #action>
        <Button
          data-testid="data-setup-btn"
          @click="showFieldsDialog = true"
        >
          Configure Fields
        </Button>
      </template>
    </EmptyState>

    <!-- Configured but no fields -->
    <EmptyState
      v-else-if="!isLoading && isConfigured && fields.length === 0"
      :icon="Database"
      title="No extraction fields"
      description="Add fields to begin extracting data from your records."
    >
      <template #action>
        <Button
          data-testid="data-setup-btn"
          @click="showFieldsDialog = true"
        >
          Configure Fields
        </Button>
      </template>
    </EmptyState>

    <!-- Completion state -->
    <DataComplete
      v-else-if="!isLoading && isComplete"
      :completed-count="completedCount"
      :total-count="totalCount"
      @configure-fields="showFieldsDialog = true"
    />

    <!-- No records available (screening not done) -->
    <EmptyState
      v-else-if="!isLoading && !hasRecords && isConfigured && fields.length > 0"
      :icon="Database"
      title="No records to extract"
      description="There are no records ready for data extraction yet. Complete screening first."
    />

    <!-- Extraction interface -->
    <ScreenSplitPanel
      v-else-if="currentRecord"
      class="flex-1 min-h-0"
      data-testid="data-extraction-card"
    >
      <template #left>
        <PdfViewerPanel :pdf-path="currentRecord.pdf_path" />
      </template>
      <template #right>
        <DataExtractionPanel
          :key="currentRecord.id"
          :record="currentRecord"
          :fields="fields"
          :local-values="localValues"
          :total-count="totalCount"
          :completed-count="completedCount"
          :is-saving="isSaving"
          :can-save="canSave"
          :queue-records="queue"
          :current-index="currentIndex"
          @update-value="updateValue"
          @save="saveExtraction"
          @skip-to-next="skipToNextPending"
          @navigate="goToRecord"
          @configure-fields="showFieldsDialog = true"
        />
      </template>
    </ScreenSplitPanel>

    <!-- Fields config dialog -->
    <DataFieldsConfigDialog
      v-model:open="showFieldsDialog"
      :existing-fields="fields"
      :is-saving="isSavingFields"
      @configured="handleFieldsConfigured"
    />
  </div>
</template>
