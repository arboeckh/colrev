<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { X, ChevronLeft, ChevronRight, Loader2, ExternalLink } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBackendStore } from '@/stores/backend';
import type { GetSourceRecordsResponse, SourceRecord } from '@/types';

const props = defineProps<{
  open: boolean;
  sourceName: string;
  filename: string;
  projectId: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const backend = useBackendStore();

// State
const isLoading = ref(false);
const records = ref<SourceRecord[]>([]);
const totalCount = ref(0);
const currentPage = ref(1);
const pageSize = 20;

const totalPages = computed(() => Math.ceil(totalCount.value / pageSize));

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

async function loadRecords() {
  if (!props.projectId || !props.filename) return;

  isLoading.value = true;
  try {
    const response = await backend.call<GetSourceRecordsResponse>('get_source_records', {
      project_id: props.projectId,
      filename: props.filename,
      pagination: {
        offset: (currentPage.value - 1) * pageSize,
        limit: pageSize,
      },
    });

    if (response.success) {
      records.value = response.records;
      totalCount.value = response.total_count;
    }
  } catch (err) {
    console.error('Failed to load source records:', err);
  } finally {
    isLoading.value = false;
  }
}

function goToPreviousPage() {
  if (currentPage.value > 1) {
    currentPage.value--;
    loadRecords();
  }
}

function goToNextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
    loadRecords();
  }
}

// Load records when modal opens
watch(() => props.open, (newValue) => {
  if (newValue) {
    currentPage.value = 1;
    loadRecords();
  }
});

function truncate(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-w-4xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          Search Results: {{ sourceName }}
          <Badge variant="secondary">{{ totalCount }} records</Badge>
        </DialogTitle>
        <DialogDescription>
          Records retrieved from {{ filename }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 overflow-auto min-h-0">
        <!-- Loading state -->
        <div v-if="isLoading" class="flex items-center justify-center py-12">
          <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
        </div>

        <!-- Empty state -->
        <div v-else-if="records.length === 0" class="flex items-center justify-center py-12 text-muted-foreground">
          No records found in this source.
        </div>

        <!-- Records table -->
        <div v-else class="border rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-muted/50">
              <tr>
                <th class="px-4 py-3 text-left font-medium w-16">#</th>
                <th class="px-4 py-3 text-left font-medium">Title</th>
                <th class="px-4 py-3 text-left font-medium w-48">Authors</th>
                <th class="px-4 py-3 text-left font-medium w-20">Year</th>
                <th class="px-4 py-3 text-left font-medium w-32">Type</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr
                v-for="(record, index) in records"
                :key="record.ID"
                class="hover:bg-muted/30"
              >
                <td class="px-4 py-3 text-muted-foreground">
                  {{ (currentPage - 1) * pageSize + index + 1 }}
                </td>
                <td class="px-4 py-3">
                  <div class="space-y-1">
                    <div class="font-medium" :title="record.title">
                      {{ truncate(record.title, 80) }}
                    </div>
                    <div v-if="record.journal || record.booktitle" class="text-xs text-muted-foreground">
                      {{ record.journal || record.booktitle }}
                    </div>
                    <div v-if="record.doi" class="text-xs">
                      <a
                        :href="`https://doi.org/${record.doi}`"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-primary hover:underline inline-flex items-center gap-1"
                        @click.stop
                      >
                        {{ record.doi }}
                        <ExternalLink class="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-muted-foreground" :title="record.author">
                  {{ truncate(record.author, 30) }}
                </td>
                <td class="px-4 py-3">
                  {{ record.year || '-' }}
                </td>
                <td class="px-4 py-3">
                  <Badge variant="outline" class="text-xs">
                    {{ record.ENTRYTYPE }}
                  </Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between pt-4 border-t">
        <div class="text-sm text-muted-foreground">
          Showing {{ (currentPage - 1) * pageSize + 1 }}-{{ Math.min(currentPage * pageSize, totalCount) }} of {{ totalCount }}
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="currentPage === 1 || isLoading"
            @click="goToPreviousPage"
          >
            <ChevronLeft class="h-4 w-4" />
            Previous
          </Button>
          <span class="text-sm text-muted-foreground px-2">
            Page {{ currentPage }} of {{ totalPages }}
          </span>
          <Button
            variant="outline"
            size="sm"
            :disabled="currentPage === totalPages || isLoading"
            @click="goToNextPage"
          >
            Next
            <ChevronRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
