<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  Upload,
  Loader2,
  FileText,
  CalendarIcon,
  ArrowLeft,
  Globe,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import type { AddSourceResponse, UploadSearchFileResponse } from '@/types';
import { getLocalTimeZone, today, type DateValue } from '@internationalized/date';
import { cn } from '@/lib/utils';
import DatabaseTile from './DatabaseTile.vue';
import ConnectorLogo from './ConnectorLogo.vue';
import {
  type DbConnector,
  ENABLED_API_CONNECTORS,
  PLANNED_API_CONNECTORS,
  ENABLED_UPLOAD_CONNECTORS,
  PLANNED_UPLOAD_CONNECTORS,
} from './db-catalog';

const props = defineProps<{
  projectId: string;
  open: boolean;
  existingApiEndpoints?: string[];
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'sourceAdded'): void;
}>();

const backend = useBackendStore();
const notifications = useNotificationsStore();

const view = ref<'gallery' | 'details'>('gallery');
const selected = ref<DbConnector | null>(null);

// Shared form state
const searchQuery = ref('');
const selectedFile = ref<File | null>(null);
const searchDate = ref<DateValue>(today(getLocalTimeZone()));
const isSubmitting = ref(false);
const progressText = ref('');

const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

// When dialog closes externally, reset everything
watch(dialogOpen, (isOpen) => {
  if (!isOpen) resetAll();
});

const addedApiSet = computed(() => new Set(props.existingApiEndpoints ?? []));

const plannedConnectors = computed(() => {
  const seen = new Set<string>();
  const out: DbConnector[] = [];
  for (const c of [...PLANNED_API_CONNECTORS, ...PLANNED_UPLOAD_CONNECTORS]) {
    if (seen.has(c.endpoint)) continue;
    seen.add(c.endpoint);
    out.push(c);
  }
  return out;
});

function isApiAdded(c: DbConnector) {
  return c.style === 'api' && addedApiSet.value.has(c.endpoint);
}

function handleSelect(c: DbConnector) {
  if (c.status !== 'enabled' || isApiAdded(c)) return;
  selected.value = c;
  view.value = 'details';
}

function backToGallery() {
  view.value = 'gallery';
  selected.value = null;
  searchQuery.value = '';
  selectedFile.value = null;
  searchDate.value = today(getLocalTimeZone());
  progressText.value = '';
}

function resetAll() {
  view.value = 'gallery';
  selected.value = null;
  searchQuery.value = '';
  selectedFile.value = null;
  searchDate.value = today(getLocalTimeZone());
  isSubmitting.value = false;
  progressText.value = '';
}

// ── Upload helpers ─────────────────────────────────────────────
function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    selectedFile.value = input.files[0];
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

const formattedDate = computed(() => {
  if (!searchDate.value) return 'Select date';
  const d = searchDate.value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(d.year, d.month - 1, d.day));
});

const canSubmit = computed(() => {
  if (!selected.value || isSubmitting.value) return false;
  if (selected.value.style === 'api') {
    return !!searchQuery.value.trim();
  }
  return !!selectedFile.value && !!searchQuery.value.trim();
});

// ── Submit paths ───────────────────────────────────────────────
async function submitApi() {
  const c = selected.value!;
  isSubmitting.value = true;
  try {
    const response = await backend.call<AddSourceResponse>('add_source', {
      project_id: props.projectId,
      endpoint: c.endpoint,
      search_type: 'API',
      search_string: searchQuery.value.trim(),
    });
    if (response.success) {
      notifications.success(`${c.name} source added`, 'Run search to fetch results');
      dialogOpen.value = false;
      emit('sourceAdded');
    }
  } catch (err) {
    notifications.error(
      'Failed to add source',
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isSubmitting.value = false;
  }
}

async function submitUpload() {
  const c = selected.value!;
  const file = selectedFile.value!;
  isSubmitting.value = true;
  progressText.value = 'Reading file...';
  try {
    const content = await readFileAsText(file);
    const ext = file.name.split('.').pop() || 'bib';
    const sanitized = c.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const targetFilename = `${sanitized}.${ext}`;

    progressText.value = 'Uploading file...';
    const uploadParams: Record<string, unknown> = {
      project_id: props.projectId,
      filename: targetFilename,
      content,
      encoding: 'utf-8',
    };
    if (c.csvTemplate) uploadParams.source_template = c.csvTemplate;
    const uploadResp = await backend.call<UploadSearchFileResponse>(
      'upload_search_file',
      uploadParams,
    );
    if (!uploadResp.success) throw new Error('Upload failed');

    progressText.value = 'Adding source...';
    const runDateISO = searchDate.value
      ? new Date(
          searchDate.value.year,
          searchDate.value.month - 1,
          searchDate.value.day,
        ).toISOString()
      : new Date().toISOString();

    const addResp = await backend.call<AddSourceResponse>('add_source', {
      project_id: props.projectId,
      endpoint: c.endpoint,
      search_type: 'DB',
      filename: uploadResp.path,
      run_date: runDateISO,
      search_string: searchQuery.value.trim(),
    });
    if (addResp.success) {
      notifications.success(
        `${c.name} source added`,
        `Imported ${uploadResp.detected_format}`,
      );
      dialogOpen.value = false;
      emit('sourceAdded');
    }
  } catch (err) {
    notifications.error(
      'Failed to add source',
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isSubmitting.value = false;
    progressText.value = '';
  }
}

function handleSubmit() {
  if (!canSubmit.value) return;
  if (selected.value!.style === 'api') void submitApi();
  else void submitUpload();
}

function handleCancel() {
  dialogOpen.value = false;
}
</script>

<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent class="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
      <!-- ─── Gallery view ──────────────────────────── -->
      <template v-if="view === 'gallery'">
        <DialogHeader>
          <DialogTitle>Add a search source</DialogTitle>
          <DialogDescription>
            Pick a database to search directly, or upload an export file.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-6 py-4">
          <section>
            <h3 class="mb-3 text-sm font-semibold tracking-tight text-foreground">
              API
            </h3>
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-1">
              <DatabaseTile
                v-for="c in ENABLED_API_CONNECTORS"
                :key="c.id"
                :connector="c"
                :added="isApiAdded(c)"
                :disabled="isApiAdded(c)"
                @select="handleSelect"
              />
            </div>
          </section>

          <section>
            <h3 class="mb-3 text-sm font-semibold tracking-tight text-foreground">
              Manual upload
            </h3>
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-1">
              <DatabaseTile
                v-for="c in ENABLED_UPLOAD_CONNECTORS"
                :key="c.id"
                :connector="c"
                @select="handleSelect"
              />
            </div>
          </section>

          <section>
            <h3 class="mb-3 text-sm font-semibold tracking-tight text-foreground">
              Planned
            </h3>
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-1">
              <DatabaseTile
                v-for="c in plannedConnectors"
                :key="c.endpoint"
                :connector="c"
                disabled
              />
            </div>
          </section>
        </div>
      </template>

      <!-- ─── Details view ──────────────────────────── -->
      <template v-else-if="selected">
        <DialogHeader>
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit mb-2"
            data-testid="back-to-gallery"
            :disabled="isSubmitting"
            @click="backToGallery"
          >
            <ArrowLeft class="h-3 w-3" />
            Back to databases
          </button>
          <DialogTitle>Add {{ selected.name }}</DialogTitle>
          <DialogDescription>
            {{ selected.tagline }}
          </DialogDescription>
        </DialogHeader>

        <!-- Source header -->
        <div class="flex items-center gap-3 border-b border-border pb-3">
          <ConnectorLogo :connector="selected" size="md" />
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{{ selected.name }}</div>
            <div class="text-xs text-muted-foreground">
              {{ selected.style === 'api' ? 'Direct API connection' : 'Manual file upload' }}
            </div>
          </div>
        </div>

        <!-- API form -->
        <div v-if="selected.style === 'api'" class="space-y-4 py-2">
          <div class="space-y-2">
            <label class="text-sm font-medium">
              Search query
              <span class="text-destructive">*</span>
            </label>
            <Textarea
              v-model="searchQuery"
              :placeholder="selected.queryPlaceholder"
              :disabled="isSubmitting"
              data-testid="search-query-input"
              class="min-h-24 resize-y font-mono text-sm"
            />
            <p v-if="selected.queryHelp" class="text-xs text-muted-foreground">
              {{ selected.queryHelp }}
            </p>
          </div>
        </div>

        <!-- Upload form -->
        <div v-else class="space-y-4 py-2">
          <div class="space-y-2">
            <label class="text-sm font-medium">Search results file</label>
            <Input
              type="file"
              :accept="selected.acceptedFormats?.join(',')"
              :disabled="isSubmitting"
              data-testid="file-input"
              @change="handleFileSelect"
            />
            <p v-if="selected.uploadInstructions" class="text-xs text-muted-foreground">
              {{ selected.uploadInstructions }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              Supported: {{ selected.acceptedFormats?.join(', ') }}
            </p>
          </div>

          <div
            v-if="selectedFile"
            class="flex items-center gap-2 p-3 bg-muted rounded-md"
          >
            <FileText class="h-4 w-4 text-muted-foreground" />
            <span class="text-sm truncate">{{ selectedFile.name }}</span>
            <span class="text-xs text-muted-foreground">
              ({{ (selectedFile.size / 1024).toFixed(1) }} KB)
            </span>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium">
              Search query
              <span class="text-destructive">*</span>
            </label>
            <Textarea
              v-model="searchQuery"
              placeholder="e.g., (machine learning OR deep learning) AND healthcare"
              :disabled="isSubmitting"
              data-testid="search-query-input"
              class="min-h-20 resize-y"
            />
            <p class="text-xs text-muted-foreground">
              Document the exact query you used on {{ selected.name }} for reproducibility.
            </p>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium">Search date</label>
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  :class="cn(
                    'w-full justify-start text-left font-normal',
                    !searchDate && 'text-muted-foreground',
                  )"
                  :disabled="isSubmitting"
                  data-testid="search-date-picker"
                >
                  <CalendarIcon class="mr-2 h-4 w-4" />
                  {{ formattedDate }}
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0" align="start">
                <Calendar
                  v-model="searchDate as DateValue"
                  layout="month-and-year"
                  :max-value="today(getLocalTimeZone())"
                />
              </PopoverContent>
            </Popover>
            <p class="text-xs text-muted-foreground">
              When you performed the search on {{ selected.name }}.
            </p>
          </div>
        </div>

        <div
          v-if="progressText"
          class="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="h-4 w-4 animate-spin" />
          {{ progressText }}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            :disabled="isSubmitting"
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
            <Loader2 v-if="isSubmitting" class="h-4 w-4 mr-2 animate-spin" />
            <Upload v-else-if="selected.style === 'upload'" class="h-4 w-4 mr-2" />
            <Globe v-else class="h-4 w-4 mr-2" />
            Add source
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
