<script setup lang="ts">
import { ref, computed } from 'vue';
import { Database, Globe, Trash2, Settings, Loader2, ExternalLink, AlertCircle, Play, CheckCircle2, Circle, Upload, Copy, Check } from 'lucide-vue-next';
import { cn, formatCount } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchResultsModal } from '@/components/search';
import ApiQueryForm from './ApiQueryForm.vue';
import { findConnectorByEndpoint } from './db-catalog';
import {
  type ApiQueryValue,
  apiQueryFromSource,
  apiQueryIsComplete,
  apiQuerySearchString,
  apiQueryToStoredQuery,
  emptyApiQuery,
} from './api-query';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectsStore } from '@/stores/projects';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SearchSource } from '@/types';
import { formatSourceName } from '@/lib/displayNames';

/**
 * Where this source sits in a run.
 *
 * `queued` exists because "Run all searches" fans out into one search per
 * source and the backend takes them one at a time — a card that is waiting its
 * turn should say so rather than pretend to be working.
 */
export type SourceRunState = 'idle' | 'queued' | 'searching';

const props = defineProps<{
  source: SearchSource;
  projectId: string;
  class?: string;
  runState?: SourceRunState;
  /** Latest status line the backend reported for this source, if any. */
  progressMessage?: string;
  /** Another source is running, so this card's actions are unavailable. */
  busy?: boolean;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'deleted'): void;
  (e: 'updated'): void;
  (e: 'run-search', filename: string): void;
}>();

const backend = useBackendStore();
const notifications = useNotificationsStore();
const projects = useProjectsStore();

// State
const showDeleteDialog = ref(false);
const showEditDialog = ref(false);
const showUpdateFileDialog = ref(false);
const showResultsModal = ref(false);
const isDeleting = ref(false);
const isUpdating = ref(false);
const isUploadingUpdate = ref(false);

// Edit form state (for API sources) — the same shape the add dialog binds to,
// so an existing source is re-tuned with the controls it was created with.
const editQuery = ref<ApiQueryValue>(emptyApiQuery());
const editShowAdvanced = ref(false);

// Update file form state (for DB sources)
const updateFile = ref<File | null>(null);
// Use ISO date string format for HTML date input (YYYY-MM-DD)
const updateSearchDate = ref(new Date().toISOString().split('T')[0]);

// Copy query state
const copiedQuery = ref(false);

// Computed
const sourceIcon = computed(() => {
  return props.source.search_type === 'API' ? Globe : Database;
});

const endpoint = computed(
  () => props.source.endpoint || props.source.platform || '',
);

/**
 * Stable identifier for test hooks: the endpoint's last segment, or the file
 * stem for uploads. Never shown to the user — see `sourceLabel`.
 */
const sourceName = computed(() => {
  if (props.source.search_type === 'DB') {
    const path = props.source.filename || props.source.search_results_path || '';
    const basename = path.split('/').pop() || '';
    return basename.replace(/\.[^/.]+$/, '') || 'unknown';
  }
  return endpoint.value.split('.').pop() || endpoint.value || 'unknown';
});

/** The catalog entry, for the options its query form offers. */
const connector = computed(() =>
  findConnectorByEndpoint(
    endpoint.value,
    props.source.search_type === 'API' ? 'api' : 'upload',
  ),
);

// `sourceName` stays the raw identifier — it keys the card's test ids and the
// results modal. Anything a person reads uses `sourceLabel`, which maps
// `open_alex` to "OpenAlex" instead of showing the package name.
const sourceLabel = computed(() =>
  props.source.search_type === 'DB' ? sourceName.value : formatSourceName(sourceName.value),
);

const filename = computed(() => {
  return props.source.filename || props.source.search_results_path || '';
});

const searchTypeVariant = computed(() => {
  switch (props.source.search_type) {
    case 'API':
      return 'default';
    case 'DB':
      return 'secondary';
    default:
      return 'outline';
  }
});

const hasSearchString = computed(() => {
  return !!props.source.search_string;
});

const isApiSource = computed(() => {
  return props.source.search_type === 'API';
});

const isDbSource = computed(() => {
  return props.source.search_type === 'DB';
});

// Source is completed when it has been run and is not stale
const isCompleted = computed(() => {
  return !!props.source.last_run_timestamp && !props.source.is_stale;
});

const isSearching = computed(() => props.runState === 'searching');
const isQueued = computed(() => props.runState === 'queued');
const isActive = computed(() => isSearching.value || isQueued.value);

/**
 * No percentage: colrev reports one event per source, not per page fetched, so
 * any number here would be invented. The label says which source is working.
 */
const searchStatusText = computed(() =>
  isQueued.value ? 'Queued' : props.progressMessage || `Searching ${sourceLabel.value}…`,
);

// Format relative time for display with both relative and absolute date
function formatRelativeTime(timestamp: string): { relative: string; date: string } {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    let relative: string;
    if (diffDays === 0) relative = 'Today';
    else if (diffDays === 1) relative = 'Yesterday';
    else if (diffDays < 7) relative = `${diffDays} days ago`;
    else if (diffDays < 14) relative = '1 week ago';
    else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)} weeks ago`;
    else if (diffDays < 60) relative = '1 month ago';
    else relative = `${Math.floor(diffDays / 30)} months ago`;

    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return { relative, date: dateStr };
  } catch {
    return { relative: 'Unknown', date: '' };
  }
}

// Copy query to clipboard
async function copyQuery() {
  if (!props.source.search_string) return;
  try {
    await navigator.clipboard.writeText(props.source.search_string);
    copiedQuery.value = true;
    notifications.success('Copied', 'Query copied to clipboard');
    setTimeout(() => {
      copiedQuery.value = false;
    }, 2000);
  } catch {
    notifications.error('Failed to copy', 'Could not copy to clipboard');
  }
}

// Methods
function runSearch() {
  emit('run-search', filename.value);
}

function openEditDialog() {
  editQuery.value = apiQueryFromSource(
    props.source.search_parameters,
    props.source.search_string,
  );
  editShowAdvanced.value = !!editQuery.value.rawApiUrl;
  showEditDialog.value = true;
}

const supportsQueryOptions = computed(
  () => endpoint.value === 'colrev.open_alex',
);

const canSaveEdit = computed(
  () => !isUpdating.value && apiQueryIsComplete(editQuery.value, supportsQueryOptions.value),
);

async function handleDelete() {
  isDeleting.value = true;

  try {
    const response = await backend.call('remove_source', {
      project_id: props.projectId,
      filename: filename.value,
      delete_file: true,
    });

    if (response.success) {
      notifications.success('Source removed', response.message);
      showDeleteDialog.value = false;
      emit('deleted');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to remove source', message);
  } finally {
    isDeleting.value = false;
  }
}

async function handleUpdate() {
  isUpdating.value = true;

  try {
    const response = await backend.call('update_source', {
      project_id: props.projectId,
      filename: filename.value,
      search_string: apiQuerySearchString(editQuery.value),
      // The stored URL is derived from this query, so the filters travel with
      // the keywords — otherwise a filter change would never reach the API.
      ...(supportsQueryOptions.value
        ? { search_parameters: { query: apiQueryToStoredQuery(editQuery.value) } }
        : {}),
    });

    if (response.success) {
      notifications.success('Source updated', 'Query changed - run search again to fetch new results');
      showEditDialog.value = false;
      emit('updated');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to update source', message);
  } finally {
    isUpdating.value = false;
  }
}

function openUpdateFileDialog() {
  updateFile.value = null;
  updateSearchDate.value = new Date().toISOString().split('T')[0];
  showUpdateFileDialog.value = true;
}

function handleUpdateFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    updateFile.value = input.files[0];
  }
}

async function handleUpdateFile() {
  if (!updateFile.value) return;

  isUploadingUpdate.value = true;

  try {
    // Read file content
    const fileContent = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(updateFile.value!);
    });

    // Get just the filename from the source path (e.g., "data/search/scopus.ris" -> "scopus.ris")
    const sourceFilename = filename.value.split('/').pop() || filename.value;

    // Upload the file with the same filename to overwrite
    const uploadResponse = await backend.call('upload_search_file', {
      project_id: props.projectId,
      filename: sourceFilename,
      content: fileContent,
      encoding: 'utf-8',
    });

    if (!uploadResponse.success) {
      throw new Error('Failed to upload file');
    }

    // Update the source with the new run date (convert YYYY-MM-DD to ISO string)
    const runDateISO = new Date(updateSearchDate.value).toISOString();
    const response = await backend.call('update_source', {
      project_id: props.projectId,
      filename: filename.value,
      run_date: runDateISO,
    });

    if (response.success) {
      notifications.success('Source updated', 'File replaced and search date updated');
      showUpdateFileDialog.value = false;
      emit('updated');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to update source', message);
  } finally {
    isUploadingUpdate.value = false;
  }
}
</script>

<template>
  <Card
    :data-testid="`source-card-${sourceName}`"
    :class="cn(
      isActive
        ? 'border-primary/50 bg-primary/5'
        : source.is_stale
          ? 'border-yellow-500/50 bg-yellow-500/5'
          : isCompleted
            ? 'border-green-500/50 bg-green-500/5'
            : 'border-border',
      'transition-colors',
      props.class
    )"
  >
    <CardHeader class="pb-2">
      <div class="flex items-start justify-between gap-2 min-w-0">
        <CardTitle class="text-base flex items-center gap-2 flex-wrap min-w-0">
          <component :is="sourceIcon" class="h-4 w-4 shrink-0" />
          <!-- A DB source is named after its file: long, and often a single
               unbroken word. It gets the slack, the badges keep their size. -->
          <span class="truncate max-w-full" :title="sourceLabel">{{ sourceLabel }}</span>
          <Badge :variant="searchTypeVariant">{{ source.search_type }}</Badge>
          <Badge
            v-if="source.is_stale"
            variant="outline"
            class="text-yellow-600 border-yellow-500/50"
          >
            <AlertCircle class="h-3 w-3 mr-1" />
            Stale
          </Badge>
          <Badge
            v-else-if="isCompleted"
            variant="outline"
            class="text-green-600 border-green-500/50 bg-green-500/10"
          >
            <CheckCircle2 class="h-3 w-3 mr-1" />
            Complete
          </Badge>
        </CardTitle>
        <div class="flex items-center gap-1 shrink-0">
          <!-- Run search (API sources only) -->
          <Button
            v-if="isApiSource"
            variant="ghost"
            size="icon"
            :disabled="isActive || busy || readOnly"
            :data-testid="`run-search-${sourceName}`"
            :title="`Run the ${sourceLabel} search`"
            @click="runSearch"
          >
            <Loader2 v-if="isActive" class="h-4 w-4 animate-spin" />
            <Play v-else class="h-4 w-4" />
          </Button>
          <!-- Update file (DB sources only) -->
          <Button
            v-if="isDbSource && !readOnly"
            variant="ghost"
            size="icon"
            :disabled="busy"
            :data-testid="`update-source-${sourceName}`"
            title="Update source file"
            @click="openUpdateFileDialog"
          >
            <Upload class="h-4 w-4" />
          </Button>
          <!-- Edit query (API sources only) -->
          <Button
            v-if="isApiSource && !readOnly"
            variant="ghost"
            size="icon"
            :disabled="isActive || busy"
            :data-testid="`edit-source-${sourceName}`"
            :title="`Edit the ${sourceLabel} query`"
            @click="openEditDialog"
          >
            <Settings class="h-4 w-4" />
          </Button>
          <!-- Delete -->
          <Button
            v-if="!readOnly"
            variant="ghost"
            size="icon"
            :disabled="isActive || busy"
            :data-testid="`delete-source-${sourceName}`"
            title="Delete source"
            @click="showDeleteDialog = true"
          >
            <Trash2 class="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent class="space-y-3">
      <!-- Running: this source only. There is no meaningful percentage to show —
           colrev reports one event per source, not per page fetched — so the
           bar is indeterminate rather than a fabricated number. -->
      <div v-if="isActive" class="space-y-2" :data-testid="`search-status-${sourceName}`">
        <div class="flex items-center gap-2 text-sm">
          <Loader2 v-if="isSearching" class="h-4 w-4 animate-spin text-primary" />
          <Circle v-else class="h-4 w-4 text-muted-foreground" />
          <span :class="isSearching ? 'font-medium text-primary' : 'text-muted-foreground'">
            {{ searchStatusText }}
          </span>
        </div>
        <div v-if="isSearching" class="h-1.5 overflow-hidden rounded-full bg-primary/15">
          <div class="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
        </div>
      </div>

      <!-- Status section (when idle) -->
      <div v-else class="flex flex-wrap items-center justify-between gap-2">
        <!-- Status indicator -->
        <div class="flex items-center gap-2 text-sm min-w-0 flex-wrap">
          <!-- Completed (has records, not stale) -->
          <template v-if="source.last_run_timestamp && !source.is_stale">
            <CheckCircle2 class="h-4 w-4 text-green-500" />
            <span class="text-muted-foreground">
              <span class="font-medium text-foreground tabular-nums" :data-testid="`record-count-${sourceName}`">{{ formatCount(source.record_count) }}</span> records
            </span>
            <span class="text-muted-foreground">·</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="text-muted-foreground cursor-help">{{ formatRelativeTime(source.last_run_timestamp!).relative }}</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ formatRelativeTime(source.last_run_timestamp!).date }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </template>
          <!-- Stale -->
          <template v-else-if="source.is_stale">
            <AlertCircle class="h-4 w-4 text-yellow-500" />
            <span class="text-yellow-600 dark:text-yellow-400 text-xs min-w-0 break-words">{{ source.stale_reason }}</span>
          </template>
          <!-- Never run -->
          <template v-else>
            <Circle class="h-4 w-4 text-muted-foreground" />
            <span class="text-muted-foreground italic">Not run yet</span>
          </template>
        </div>

        <!-- View records button (only when has records and not stale) -->
        <Button
          v-if="(source.record_count ?? 0) > 0 && !source.is_stale"
          variant="outline"
          size="sm"
          class="h-7 text-xs shrink-0 ml-auto"
          :data-testid="`view-results-${sourceName}`"
          @click="showResultsModal = true"
        >
          View
          <ExternalLink class="h-3 w-3 ml-1" />
        </Button>
      </div>

      <!-- Search string for API sources -->
      <div v-if="hasSearchString" class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-muted-foreground">Query:</span>
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            :data-testid="`copy-query-${sourceName}`"
            title="Copy query to clipboard"
            @click="copyQuery"
          >
            <Check v-if="copiedQuery" class="h-3 w-3 text-green-500" />
            <Copy v-else class="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
        <div class="relative">
          <pre class="text-xs bg-muted p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap break-words">{{ source.search_string }}</pre>
        </div>
      </div>
    </CardContent>
  </Card>

  <!-- Delete Confirmation Dialog -->
  <Dialog v-model:open="showDeleteDialog">
    <DialogContent class="max-w-prose">
      <DialogHeader>
        <DialogTitle>Delete Source</DialogTitle>
        <DialogDescription>
          Are you sure you want to remove "{{ sourceLabel }}" from your search sources?
          This will also delete the search results file.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isDeleting"
          data-testid="cancel-delete-source"
          @click="showDeleteDialog = false"
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          :disabled="isDeleting"
          data-testid="confirm-delete-source"
          @click="handleDelete"
        >
          <Loader2 v-if="isDeleting" class="h-4 w-4 mr-2 animate-spin" />
          Delete Source
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Edit Dialog (for API sources) — the same form the source was added with,
       so every option stays reachable after creation. -->
  <Dialog v-model:open="showEditDialog">
    <DialogContent class="max-w-prose max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Edit {{ sourceLabel }} search</DialogTitle>
        <DialogDescription>
          Changing the search discards the results already fetched — run the
          search again to refill it.
        </DialogDescription>
      </DialogHeader>
      <div class="py-2">
        <ApiQueryForm
          v-if="connector"
          v-model="editQuery"
          v-model:show-advanced="editShowAdvanced"
          :connector="connector"
          :disabled="isUpdating"
        />
        <div v-else class="space-y-2">
          <label class="text-sm font-medium">Search query</label>
          <Textarea
            v-model="editQuery.searchQuery"
            placeholder="Enter search query"
            data-testid="edit-query-input"
            :disabled="isUpdating"
            class="min-h-24 resize-y"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isUpdating"
          data-testid="cancel-edit-source"
          @click="showEditDialog = false"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSaveEdit"
          data-testid="confirm-edit-source"
          @click="handleUpdate"
        >
          <Loader2 v-if="isUpdating" class="h-4 w-4 mr-2 animate-spin" />
          Save Changes
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Update File Dialog (for DB sources) -->
  <Dialog v-model:open="showUpdateFileDialog">
    <DialogContent class="max-w-prose">
      <DialogHeader>
        <DialogTitle>Update {{ sourceLabel }} source</DialogTitle>
        <DialogDescription>
          Upload a new file to replace the existing search results.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-4 py-4">
        <div class="space-y-2">
          <label class="text-sm font-medium">New Search Results File</label>
          <Input
            type="file"
            accept=".bib,.ris,.nbib,.enl,.csv,.xlsx,.txt"
            data-testid="update-file-input"
            :disabled="isUploadingUpdate"
            @change="handleUpdateFileSelect"
          />
          <p class="text-xs text-muted-foreground">
            The new file will replace the existing search results.
          </p>
        </div>
        <div v-if="updateFile" class="flex items-center gap-2 p-3 bg-muted rounded-md">
          <span class="text-sm">{{ updateFile.name }}</span>
          <span class="text-xs text-muted-foreground">
            ({{ (updateFile.size / 1024).toFixed(1) }} KB)
          </span>
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium">Search Date</label>
          <Input
            type="date"
            v-model="updateSearchDate"
            data-testid="update-search-date"
            :disabled="isUploadingUpdate"
          />
          <p class="text-xs text-muted-foreground">
            When the new database search was performed.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isUploadingUpdate"
          data-testid="cancel-update-file"
          @click="showUpdateFileDialog = false"
        >
          Cancel
        </Button>
        <Button
          :disabled="isUploadingUpdate || !updateFile"
          data-testid="confirm-update-file"
          @click="handleUpdateFile"
        >
          <Loader2 v-if="isUploadingUpdate" class="h-4 w-4 mr-2 animate-spin" />
          <Upload v-else class="h-4 w-4 mr-2" />
          Update Source
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Search Results Modal -->
  <SearchResultsModal
    v-model:open="showResultsModal"
    :source-name="sourceLabel"
    :filename="filename"
    :project-id="projectId"
  />
</template>
