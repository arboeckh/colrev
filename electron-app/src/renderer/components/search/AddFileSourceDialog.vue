<script setup lang="ts">
import { ref, computed } from 'vue';
import { Upload, Loader2, FileText } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type { UploadSearchFileResponse, AddSourceResponse } from '@/types';

const props = defineProps<{
  projectId: string;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'sourceAdded'): void;
}>();

const backend = useBackendStore();
const notifications = useNotificationsStore();

// Form state
const sourceName = ref('');
const selectedFile = ref<File | null>(null);
const isUploading = ref(false);
const uploadProgress = ref('');

// Computed
const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const canSubmit = computed(() => {
  return sourceName.value.trim() && selectedFile.value && !isUploading.value;
});

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    selectedFile.value = input.files[0];
    // Auto-fill source name from filename if empty
    if (!sourceName.value) {
      const fileName = selectedFile.value.name;
      const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
      sourceName.value = nameWithoutExt;
    }
  }
}

async function handleSubmit() {
  if (!canSubmit.value) return;

  isUploading.value = true;
  uploadProgress.value = 'Reading file...';

  try {
    // Read file content
    const fileContent = await readFileAsText(selectedFile.value!);
    const filename = selectedFile.value!.name;

    uploadProgress.value = 'Uploading file...';

    // Upload the file
    const uploadResponse = await backend.call<UploadSearchFileResponse>('upload_search_file', {
      project_id: props.projectId,
      filename: filename,
      content: fileContent,
      encoding: 'utf-8',
    });

    if (!uploadResponse.success) {
      throw new Error('Failed to upload file');
    }

    uploadProgress.value = 'Adding source...';

    // Add the source configuration
    const addResponse = await backend.call<AddSourceResponse>('add_source', {
      project_id: props.projectId,
      endpoint: 'colrev.unknown_source',
      search_type: 'DB',
      filename: uploadResponse.path,
    });

    if (addResponse.success) {
      notifications.success('Source added', `Added ${sourceName.value} (${uploadResponse.detected_format})`);
      resetForm();
      dialogOpen.value = false;
      emit('sourceAdded');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to add source', message);
  } finally {
    isUploading.value = false;
    uploadProgress.value = '';
  }
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function resetForm() {
  sourceName.value = '';
  selectedFile.value = null;
}

function handleCancel() {
  resetForm();
  dialogOpen.value = false;
}
</script>

<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add File Source</DialogTitle>
        <DialogDescription>
          Upload a search results file (BibTeX, RIS, NBIB, etc.) from a database export.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- Source name -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Source Name</label>
          <Input
            v-model="sourceName"
            placeholder="e.g., scopus, web-of-science"
            data-testid="source-name-input"
            :disabled="isUploading"
          />
          <p class="text-xs text-muted-foreground">
            A descriptive name for this search source.
          </p>
        </div>

        <!-- File upload -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Search Results File</label>
          <div class="flex items-center gap-2">
            <Input
              type="file"
              accept=".bib,.ris,.nbib,.enl,.csv,.xlsx,.txt"
              data-testid="file-input"
              :disabled="isUploading"
              @change="handleFileSelect"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            Supported formats: BibTeX (.bib), RIS (.ris), NBIB (.nbib), EndNote (.enl), CSV, Excel
          </p>
        </div>

        <!-- Selected file info -->
        <div v-if="selectedFile" class="flex items-center gap-2 p-3 bg-muted rounded-md">
          <FileText class="h-4 w-4 text-muted-foreground" />
          <span class="text-sm">{{ selectedFile.name }}</span>
          <span class="text-xs text-muted-foreground">
            ({{ (selectedFile.size / 1024).toFixed(1) }} KB)
          </span>
        </div>

        <!-- Upload progress -->
        <div v-if="uploadProgress" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          {{ uploadProgress }}
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isUploading"
          data-testid="cancel-add-source"
          @click="handleCancel"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSubmit"
          data-testid="submit-add-source"
          @click="handleSubmit"
        >
          <Upload v-if="!isUploading" class="h-4 w-4 mr-2" />
          <Loader2 v-else class="h-4 w-4 mr-2 animate-spin" />
          Add Source
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
