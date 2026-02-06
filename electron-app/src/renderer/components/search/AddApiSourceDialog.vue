<script setup lang="ts">
import { ref, computed } from 'vue';
import { Globe, Loader2 } from 'lucide-vue-next';
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
import type { AddSourceResponse } from '@/types';

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
const searchQuery = ref('');
const isAdding = ref(false);

// Computed
const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const canSubmit = computed(() => {
  return searchQuery.value.trim() && !isAdding.value;
});

async function handleSubmit() {
  if (!canSubmit.value) return;

  isAdding.value = true;

  try {
    // Add the PubMed source
    const response = await backend.call<AddSourceResponse>('add_source', {
      project_id: props.projectId,
      endpoint: 'colrev.pubmed',
      search_type: 'API',
      search_string: searchQuery.value.trim(),
    });

    if (response.success) {
      notifications.success('PubMed source added', 'Run search to fetch results');
      resetForm();
      dialogOpen.value = false;
      emit('sourceAdded');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to add source', message);
  } finally {
    isAdding.value = false;
  }
}

function resetForm() {
  searchQuery.value = '';
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
        <DialogTitle>Add PubMed Search</DialogTitle>
        <DialogDescription>
          Configure a PubMed API search to automatically retrieve literature.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- Search query -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Search Query</label>
          <Input
            v-model="searchQuery"
            placeholder="e.g., machine learning AND cancer[MeSH]"
            data-testid="pubmed-query-input"
            :disabled="isAdding"
            @keyup.enter="handleSubmit"
          />
          <p class="text-xs text-muted-foreground">
            Use PubMed search syntax. Supports boolean operators (AND, OR, NOT) and field tags.
          </p>
        </div>

        <!-- Query tips -->
        <div class="p-3 bg-muted rounded-md space-y-2">
          <p class="text-sm font-medium">Query Examples:</p>
          <ul class="text-xs text-muted-foreground space-y-1">
            <li><code class="bg-background px-1 rounded">diabetes[MeSH] AND metformin</code></li>
            <li><code class="bg-background px-1 rounded">"systematic review"[Title] AND COVID-19</code></li>
            <li><code class="bg-background px-1 rounded">cancer AND (treatment OR therapy)</code></li>
          </ul>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isAdding"
          data-testid="cancel-add-pubmed"
          @click="handleCancel"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSubmit"
          data-testid="submit-add-pubmed"
          @click="handleSubmit"
        >
          <Globe v-if="!isAdding" class="h-4 w-4 mr-2" />
          <Loader2 v-else class="h-4 w-4 mr-2 animate-spin" />
          Add PubMed Source
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
