<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ChevronLeft, ChevronRight, Loader2, ExternalLink, AlertCircle, CheckCircle2, Pencil } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBackendStore } from '@/stores/backend';
import RecordEditDialog from '@/components/preprocessing/RecordEditDialog.vue';
import type { GetRecordsResponse, Record } from '@/types';

const props = defineProps<{
  open: boolean;
  projectId: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const backend = useBackendStore();

// State for each tab
const activeTab = ref<'ready' | 'attention'>('ready');

// Ready records (md_processed)
const readyRecords = ref<Record[]>([]);
const readyTotalCount = ref(0);
const readyCurrentPage = ref(1);
const isLoadingReady = ref(false);

// Attention records (md_needs_manual_preparation)
const attentionRecords = ref<Record[]>([]);
const attentionTotalCount = ref(0);
const attentionCurrentPage = ref(1);
const isLoadingAttention = ref(false);

// Edit dialog state
const showEditDialog = ref(false);
const selectedRecordId = ref<string | null>(null);

const pageSize = 20;

const readyTotalPages = computed(() => Math.ceil(readyTotalCount.value / pageSize));
const attentionTotalPages = computed(() => Math.ceil(attentionTotalCount.value / pageSize));

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

async function loadReadyRecords() {
  if (!props.projectId) return;

  isLoadingReady.value = true;
  try {
    const response = await backend.call<GetRecordsResponse>('get_records', {
      project_id: props.projectId,
      filters: {
        status: 'md_processed',
      },
      pagination: {
        offset: (readyCurrentPage.value - 1) * pageSize,
        limit: pageSize,
      },
      fields: ['ID', 'ENTRYTYPE', 'title', 'author', 'year', 'journal', 'booktitle', 'doi'],
    });

    if (response.success) {
      readyRecords.value = response.records;
      readyTotalCount.value = response.total_count;
    }
  } catch (err) {
    console.error('Failed to load ready records:', err);
  } finally {
    isLoadingReady.value = false;
  }
}

async function loadAttentionRecords() {
  if (!props.projectId) return;

  isLoadingAttention.value = true;
  try {
    const response = await backend.call<GetRecordsResponse>('get_records', {
      project_id: props.projectId,
      filters: {
        status: 'md_needs_manual_preparation',
      },
      pagination: {
        offset: (attentionCurrentPage.value - 1) * pageSize,
        limit: pageSize,
      },
      fields: ['ID', 'ENTRYTYPE', 'title', 'author', 'year', 'journal', 'booktitle', 'doi'],
    });

    if (response.success) {
      attentionRecords.value = response.records;
      attentionTotalCount.value = response.total_count;
    }
  } catch (err) {
    console.error('Failed to load attention records:', err);
  } finally {
    isLoadingAttention.value = false;
  }
}

function goToPreviousReadyPage() {
  if (readyCurrentPage.value > 1) {
    readyCurrentPage.value--;
    loadReadyRecords();
  }
}

function goToNextReadyPage() {
  if (readyCurrentPage.value < readyTotalPages.value) {
    readyCurrentPage.value++;
    loadReadyRecords();
  }
}

function goToPreviousAttentionPage() {
  if (attentionCurrentPage.value > 1) {
    attentionCurrentPage.value--;
    loadAttentionRecords();
  }
}

function goToNextAttentionPage() {
  if (attentionCurrentPage.value < attentionTotalPages.value) {
    attentionCurrentPage.value++;
    loadAttentionRecords();
  }
}

// Load records when modal opens
watch(() => props.open, (newValue) => {
  if (newValue) {
    readyCurrentPage.value = 1;
    attentionCurrentPage.value = 1;
    loadReadyRecords();
    loadAttentionRecords();
  }
});

function openEditDialog(recordId: string) {
  selectedRecordId.value = recordId;
  showEditDialog.value = true;
}

function onRecordUpdated() {
  loadAttentionRecords();
  loadReadyRecords();
}

function truncate(text: string | undefined, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="w-[80vw] max-w-[80vw] sm:max-w-[80vw] h-[80vh] flex flex-col" data-testid="preprocessing-results-modal">
      <DialogHeader>
        <DialogTitle>Preprocessing Results</DialogTitle>
        <DialogDescription>
          Review records after preprocessing
        </DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeTab" class="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TabsList class="w-fit shrink-0">
          <TabsTrigger value="ready" class="flex items-center gap-2" data-testid="tab-ready">
            <CheckCircle2 class="h-4 w-4" />
            Ready
            <Badge variant="secondary" class="ml-1">{{ readyTotalCount }}</Badge>
          </TabsTrigger>
          <TabsTrigger value="attention" class="flex items-center gap-2" data-testid="tab-attention">
            <AlertCircle class="h-4 w-4" />
            Needs Attention
            <Badge variant="secondary" class="ml-1">{{ attentionTotalCount }}</Badge>
          </TabsTrigger>
        </TabsList>

        <!-- Tab content wrapper - fixed height container -->
        <div class="flex-1 min-h-0 relative mt-4">
          <!-- Ready Tab -->
          <TabsContent value="ready" class="absolute inset-0 flex flex-col m-0 data-[state=inactive]:hidden">
          <div class="flex-1 overflow-auto min-h-0">
            <!-- Loading state -->
            <div v-if="isLoadingReady" class="flex items-center justify-center py-12">
              <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>

            <!-- Empty state -->
            <div v-else-if="readyRecords.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CheckCircle2 class="h-12 w-12 mb-4 text-muted-foreground/50" />
              <p>No records ready for prescreening yet.</p>
              <p class="text-sm">Run preprocessing to prepare records.</p>
            </div>

            <!-- Records table -->
            <div v-else class="border rounded-lg overflow-hidden">
              <table class="w-full text-sm" data-testid="ready-records-table">
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
                    v-for="(record, index) in readyRecords"
                    :key="record.ID"
                    class="hover:bg-muted/30"
                    :data-testid="`ready-record-row-${index}`"
                  >
                    <td class="px-4 py-3 text-muted-foreground">
                      {{ (readyCurrentPage - 1) * pageSize + index + 1 }}
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
            <div v-if="readyTotalPages > 1" class="flex items-center justify-between pt-4 border-t shrink-0">
              <div class="text-sm text-muted-foreground">
                Showing {{ (readyCurrentPage - 1) * pageSize + 1 }}-{{ Math.min(readyCurrentPage * pageSize, readyTotalCount) }} of {{ readyTotalCount }}
              </div>
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="readyCurrentPage === 1 || isLoadingReady"
                  @click="goToPreviousReadyPage"
                >
                  <ChevronLeft class="h-4 w-4" />
                  Previous
                </Button>
                <span class="text-sm text-muted-foreground px-2">
                  Page {{ readyCurrentPage }} of {{ readyTotalPages }}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="readyCurrentPage === readyTotalPages || isLoadingReady"
                  @click="goToNextReadyPage"
                >
                  Next
                  <ChevronRight class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </TabsContent>

          <!-- Attention Tab -->
          <TabsContent value="attention" class="absolute inset-0 flex flex-col m-0 data-[state=inactive]:hidden">
          <div class="flex-1 overflow-auto min-h-0">
            <!-- Loading state -->
            <div v-if="isLoadingAttention" class="flex items-center justify-center py-12">
              <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>

            <!-- Empty state -->
            <div v-else-if="attentionRecords.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CheckCircle2 class="h-12 w-12 mb-4 text-emerald-500" />
              <p>All records are ready!</p>
              <p class="text-sm">No records need manual preparation.</p>
            </div>

            <!-- Records table -->
            <div v-else class="border rounded-lg overflow-hidden">
              <table class="w-full text-sm" data-testid="attention-records-table">
                <thead class="bg-muted/50">
                  <tr>
                    <th class="px-4 py-3 text-left font-medium w-16">#</th>
                    <th class="px-4 py-3 text-left font-medium">Title</th>
                    <th class="px-4 py-3 text-left font-medium w-48">Authors</th>
                    <th class="px-4 py-3 text-left font-medium w-20">Year</th>
                    <th class="px-4 py-3 text-left font-medium w-32">Type</th>
                    <th class="px-4 py-3 text-left font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  <tr
                    v-for="(record, index) in attentionRecords"
                    :key="record.ID"
                    class="hover:bg-muted/30 cursor-pointer"
                    :data-testid="`attention-record-row-${index}`"
                    @click="openEditDialog(record.ID)"
                  >
                    <td class="px-4 py-3 text-muted-foreground">
                      {{ (attentionCurrentPage - 1) * pageSize + index + 1 }}
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
                    <td class="px-4 py-3 text-muted-foreground">
                      <Pencil class="h-4 w-4" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

            <!-- Pagination -->
            <div v-if="attentionTotalPages > 1" class="flex items-center justify-between pt-4 border-t shrink-0">
              <div class="text-sm text-muted-foreground">
                Showing {{ (attentionCurrentPage - 1) * pageSize + 1 }}-{{ Math.min(attentionCurrentPage * pageSize, attentionTotalCount) }} of {{ attentionTotalCount }}
              </div>
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="attentionCurrentPage === 1 || isLoadingAttention"
                  @click="goToPreviousAttentionPage"
                >
                  <ChevronLeft class="h-4 w-4" />
                  Previous
                </Button>
                <span class="text-sm text-muted-foreground px-2">
                  Page {{ attentionCurrentPage }} of {{ attentionTotalPages }}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="attentionCurrentPage === attentionTotalPages || isLoadingAttention"
                  @click="goToNextAttentionPage"
                >
                  Next
                  <ChevronRight class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </DialogContent>
  </Dialog>

  <!-- Edit Dialog (rendered outside the main dialog to avoid z-index issues) -->
  <RecordEditDialog
    v-model:open="showEditDialog"
    :project-id="props.projectId"
    :record-id="selectedRecordId"
    @record-updated="onRecordUpdated"
  />
</template>
