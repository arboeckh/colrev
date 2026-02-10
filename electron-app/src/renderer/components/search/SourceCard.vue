<script setup lang="ts">
import { ref, computed } from 'vue';
import { Database, Globe, Trash2, Settings, Loader2, ExternalLink, AlertCircle, Play, CheckCircle2, Circle, Upload, Copy, Check } from 'lucide-vue-next';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchResultsModal } from '@/components/search';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectsStore } from '@/stores/projects';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SearchSource, RemoveSourceResponse, UpdateSourceResponse } from '@/types';

interface SearchProgress {
  progress: number;
  status: string;
  fetchedRecords: number;
  totalRecords: number;
  currentBatch: number;
  totalBatches: number;
}

const props = defineProps<{
  source: SearchSource;
  projectId: string;
  class?: string;
  isSearching?: boolean;
  searchProgress?: SearchProgress;
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

// Edit form state (for API sources)
const editSearchString = ref('');

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

const sourceName = computed(() => {
  // For DB (file-based) sources, use the filename without extension as the name
  // e.g., "data/search/scopus.ris" -> "scopus"
  if (props.source.search_type === 'DB') {
    const path = props.source.filename || props.source.search_results_path || '';
    const basename = path.split('/').pop() || '';
    return basename.replace(/\.[^/.]+$/, '') || 'unknown';
  }
  // For API sources, extract name from endpoint (e.g., "colrev.pubmed" -> "pubmed")
  const endpoint = props.source.endpoint || props.source.platform || 'unknown';
  return endpoint.split('.').pop() || endpoint;
});

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

// Source is completed when it has records and is not stale
const isCompleted = computed(() => {
  return (props.source.record_count ?? 0) > 0 && !props.source.is_stale;
});

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
  editSearchString.value = props.source.search_string || '';
  showEditDialog.value = true;
}

async function handleDelete() {
  isDeleting.value = true;

  try {
    const response = await backend.call<RemoveSourceResponse>('remove_source', {
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
    const response = await backend.call<UpdateSourceResponse>('update_source', {
      project_id: props.projectId,
      filename: filename.value,
      search_string: editSearchString.value,
    });

    if (response.success) {
      notifications.success('Source updated', 'Query changed - run search again to fetch new results');
      showEditDialog.value = false;
      emit('updated');
      // Refresh project status since search results were cleared
      await projects.refreshCurrentProject();
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
    const uploadResponse = await backend.call<{ success: boolean; path: string }>('upload_search_file', {
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
    const response = await backend.call<UpdateSourceResponse>('update_source', {
      project_id: props.projectId,
      filename: filename.value,
      run_date: runDateISO,
    });

    if (response.success) {
      notifications.success('Source updated', 'File replaced and search date updated');
      showUpdateFileDialog.value = false;
      emit('updated');
      await projects.refreshCurrentProject();
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
      isSearching
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
      <div class="flex items-center justify-between">
        <CardTitle class="text-base flex items-center gap-2 flex-wrap">
          <component :is="sourceIcon" class="h-4 w-4 shrink-0" />
          {{ sourceName }}
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
            :disabled="isSearching"
            :data-testid="`run-search-${sourceName}`"
            title="Run search for this source"
            @click="runSearch"
          >
            <Loader2 v-if="isSearching" class="h-4 w-4 animate-spin" />
            <Play v-else class="h-4 w-4" />
          </Button>
          <!-- Update file (DB sources only) -->
          <Button
            v-if="isDbSource"
            variant="ghost"
            size="icon"
            :data-testid="`update-source-${sourceName}`"
            title="Update source file"
            @click="openUpdateFileDialog"
          >
            <Upload class="h-4 w-4" />
          </Button>
          <!-- Edit query (API sources only) -->
          <Button
            v-if="isApiSource"
            variant="ghost"
            size="icon"
            :data-testid="`edit-source-${sourceName}`"
            title="Edit search query"
            @click="openEditDialog"
          >
            <Settings class="h-4 w-4" />
          </Button>
          <!-- Delete -->
          <Button
            variant="ghost"
            size="icon"
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
      <!-- Search progress (when searching) -->
      <div v-if="isSearching && searchProgress" class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <div class="flex items-center gap-2">
            <Loader2 class="h-4 w-4 animate-spin text-primary" />
            <span class="text-muted-foreground">{{ searchProgress.status || 'Searching...' }}</span>
          </div>
          <span class="text-xs font-medium tabular-nums">{{ Math.round(searchProgress.progress) }}%</span>
        </div>
        <Progress :model-value="searchProgress.progress" class="h-1.5" />
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span v-if="searchProgress.totalBatches > 0">
            Batch {{ searchProgress.currentBatch }}/{{ searchProgress.totalBatches }}
          </span>
          <span v-if="searchProgress.totalRecords > 0" class="tabular-nums">
            {{ searchProgress.fetchedRecords.toLocaleString() }}/{{ searchProgress.totalRecords.toLocaleString() }} records
          </span>
        </div>
      </div>

      <!-- Status section (when not searching) -->
      <div v-else class="flex items-center justify-between">
        <!-- Status indicator -->
        <div class="flex items-center gap-2 text-sm">
          <!-- Searching (fallback if no progress data) -->
          <template v-if="isSearching">
            <Loader2 class="h-4 w-4 animate-spin text-primary" />
            <span class="font-medium text-primary">Searching...</span>
          </template>
          <!-- Completed (has records, not stale) -->
          <template v-else-if="(source.record_count ?? 0) > 0 && !source.is_stale">
            <CheckCircle2 class="h-4 w-4 text-green-500" />
            <span class="text-muted-foreground">
              <span class="font-medium text-foreground">{{ source.record_count }}</span> records
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
            <span class="text-yellow-600 dark:text-yellow-400 text-xs">{{ source.stale_reason }}</span>
          </template>
          <!-- Never run -->
          <template v-else>
            <Circle class="h-4 w-4 text-muted-foreground" />
            <span class="text-muted-foreground italic">Not run yet</span>
          </template>
        </div>

        <!-- View records button (only when has records and not stale) -->
        <Button
          v-if="(source.record_count ?? 0) > 0 && !source.is_stale && !isSearching"
          variant="outline"
          size="sm"
          class="h-7 text-xs"
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
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete Source</DialogTitle>
        <DialogDescription>
          Are you sure you want to remove "{{ sourceName }}" from your search sources?
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

  <!-- Edit Dialog (for API sources) -->
  <Dialog v-model:open="showEditDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit {{ sourceName }} Search</DialogTitle>
        <DialogDescription>
          Update the search query for this API source.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-4 py-4">
        <div class="space-y-2">
          <label class="text-sm font-medium">Search Query</label>
          <Input
            v-model="editSearchString"
            placeholder="Enter search query"
            data-testid="edit-query-input"
            :disabled="isUpdating"
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
          :disabled="isUpdating || !editSearchString.trim()"
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
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Update {{ sourceName }} Source</DialogTitle>
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
    :source-name="sourceName"
    :filename="filename"
    :project-id="projectId"
  />
</template>
