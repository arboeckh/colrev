<script setup lang="ts">
import { ref, computed } from 'vue';
import { Database, Globe, Trash2, Settings, Loader2, Eye } from 'lucide-vue-next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import type { SearchSource, RemoveSourceResponse, UpdateSourceResponse } from '@/types';

const props = defineProps<{
  source: SearchSource;
  projectId: string;
  canViewResults?: boolean;
}>();

const emit = defineEmits<{
  (e: 'deleted'): void;
  (e: 'updated'): void;
}>();

const backend = useBackendStore();
const notifications = useNotificationsStore();
const projects = useProjectsStore();

// State
const showDeleteDialog = ref(false);
const showEditDialog = ref(false);
const showResultsModal = ref(false);
const isDeleting = ref(false);
const isUpdating = ref(false);

// Edit form state
const editSearchString = ref('');

// Computed
const sourceIcon = computed(() => {
  return props.source.search_type === 'API' ? Globe : Database;
});

const sourceName = computed(() => {
  // Extract name from endpoint (e.g., "colrev.pubmed" -> "pubmed")
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

// Methods
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
</script>

<template>
  <Card :data-testid="`source-card-${sourceName}`">
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base flex items-center gap-2">
          <component :is="sourceIcon" class="h-4 w-4" />
          {{ sourceName }}
          <Badge :variant="searchTypeVariant">{{ source.search_type }}</Badge>
        </CardTitle>
        <div class="flex items-center gap-1">
          <Button
            v-if="canViewResults"
            variant="ghost"
            size="icon"
            :data-testid="`view-results-${sourceName}`"
            title="View search results"
            @click="showResultsModal = true"
          >
            <Eye class="h-4 w-4" />
          </Button>
          <Button
            v-if="source.search_type === 'API'"
            variant="ghost"
            size="icon"
            :data-testid="`edit-source-${sourceName}`"
            @click="openEditDialog"
          >
            <Settings class="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            :data-testid="`delete-source-${sourceName}`"
            @click="showDeleteDialog = true"
          >
            <Trash2 class="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      <CardDescription class="font-mono text-xs">
        {{ filename }}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div class="text-sm text-muted-foreground space-y-2">
        <!-- Search string for API sources -->
        <div v-if="hasSearchString" class="space-y-1">
          <span class="text-xs font-medium">Query:</span>
          <pre class="text-xs bg-muted p-2 rounded overflow-auto max-h-20">{{ source.search_string }}</pre>
        </div>
        <!-- Parameters -->
        <div v-if="Object.keys(source.search_parameters || {}).length > 0">
          <span class="text-xs font-medium">Parameters:</span>
          <pre class="text-xs bg-muted p-2 rounded overflow-auto max-h-20">{{ JSON.stringify(source.search_parameters, null, 2) }}</pre>
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

  <!-- Search Results Modal -->
  <SearchResultsModal
    v-model:open="showResultsModal"
    :source-name="sourceName"
    :filename="filename"
    :project-id="projectId"
  />
</template>
