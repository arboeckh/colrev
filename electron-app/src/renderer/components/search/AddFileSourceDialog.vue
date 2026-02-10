<script setup lang="ts">
import { ref, computed } from 'vue';
import { Upload, Loader2, FileText, CalendarIcon } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import { getLocalTimeZone, today, type DateValue, CalendarDate } from '@internationalized/date';
import { cn } from '@/lib/utils';

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
const searchQuery = ref('');
const searchDate = ref<DateValue>(today(getLocalTimeZone()));
const isUploading = ref(false);
const uploadProgress = ref('');

// Computed
const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const canSubmit = computed(() => {
  return sourceName.value.trim() && selectedFile.value && searchQuery.value.trim() && !isUploading.value;
});

const formattedDate = computed(() => {
  if (!searchDate.value) return 'Select date';
  const date = searchDate.value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date.year, date.month - 1, date.day));
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

    // Generate the target filename based on user's source name with the same extension as uploaded file
    const fileExtension = selectedFile.value!.name.split('.').pop() || 'bib';
    const sanitizedSourceName = sourceName.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const targetFilename = `${sanitizedSourceName}.${fileExtension}`;

    uploadProgress.value = 'Uploading file...';

    // Upload the file with the target filename (based on source name, not original filename)
    const uploadResponse = await backend.call<UploadSearchFileResponse>('upload_search_file', {
      project_id: props.projectId,
      filename: targetFilename,
      content: fileContent,
      encoding: 'utf-8',
    });

    if (!uploadResponse.success) {
      throw new Error('Failed to upload file');
    }

    uploadProgress.value = 'Adding source...';

    // Convert DateValue to ISO string for the run_date
    const runDateISO = searchDate.value
      ? new Date(searchDate.value.year, searchDate.value.month - 1, searchDate.value.day).toISOString()
      : new Date().toISOString();

    // Add the source configuration with run_date and search_string
    // The path returned from upload is used directly
    const addResponse = await backend.call<AddSourceResponse>('add_source', {
      project_id: props.projectId,
      endpoint: 'colrev.unknown_source',
      search_type: 'DB',
      filename: uploadResponse.path,
      run_date: runDateISO,
      search_string: searchQuery.value.trim(),
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
  searchQuery.value = '';
  searchDate.value = today(getLocalTimeZone());
}

function handleCancel() {
  resetForm();
  dialogOpen.value = false;
}
</script>

<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent class="max-w-prose">
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

        <!-- Search query -->
        <div class="space-y-2">
          <label class="text-sm font-medium">
            Search Query
            <span class="text-destructive">*</span>
          </label>
          <Textarea
            v-model="searchQuery"
            placeholder="e.g., (machine learning OR deep learning) AND healthcare"
            data-testid="search-query-input"
            :disabled="isUploading"
            class="min-h-20 resize-y"
          />
          <p class="text-xs text-muted-foreground">
            Document the exact query used in the database export for reproducibility.
          </p>
        </div>

        <!-- Search date picker -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Search Date</label>
          <Popover>
            <PopoverTrigger as-child>
              <Button
                variant="outline"
                :class="cn(
                  'w-full justify-start text-left font-normal',
                  !searchDate && 'text-muted-foreground'
                )"
                :disabled="isUploading"
                data-testid="search-date-picker"
              >
                <CalendarIcon class="mr-2 h-4 w-4" />
                {{ formattedDate }}
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar
                v-model="searchDate"
                layout="month-and-year"
                :max-value="today(getLocalTimeZone())"
              />
            </PopoverContent>
          </Popover>
          <p class="text-xs text-muted-foreground">
            When the database search was performed.
          </p>
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
