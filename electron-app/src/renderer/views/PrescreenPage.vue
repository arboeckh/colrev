<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Filter, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type {
  GetPrescreenQueueResponse,
  PrescreenQueueRecord,
  PrescreenRecordResponse,
  EnrichRecordMetadataResponse,
  BatchEnrichRecordsResponse,
} from '@/types/api';

// Enrichment status tracking
type EnrichmentStatus = 'pending' | 'loading' | 'complete' | 'failed';

interface EnrichedRecord extends PrescreenQueueRecord {
  _enrichmentStatus: EnrichmentStatus;
}

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();

const queue = ref<EnrichedRecord[]>([]);
const totalCount = ref(0);
const isLoading = ref(false);
const currentIndex = ref(0);
const isDeciding = ref(false);

// Number of records to prefetch in background
const PREFETCH_BATCH_SIZE = 10;

const currentRecord = computed(() => queue.value[currentIndex.value] || null);

// Check if current record is ready to display (has abstract or enrichment complete/failed)
const isCurrentRecordReady = computed(() => {
  const record = currentRecord.value;
  if (!record) return false;
  // Ready if: has abstract, or enrichment is complete/failed, or can't be enriched
  return (
    record.abstract ||
    record._enrichmentStatus === 'complete' ||
    record._enrichmentStatus === 'failed' ||
    !record.can_enrich
  );
});

// Check if next record is ready
const isNextRecordReady = computed(() => {
  const nextRecord = queue.value[currentIndex.value + 1];
  if (!nextRecord) return true; // No next record means ready to proceed
  return (
    nextRecord.abstract ||
    nextRecord._enrichmentStatus === 'complete' ||
    nextRecord._enrichmentStatus === 'failed' ||
    !nextRecord.can_enrich
  );
});

async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  try {
    const response = await backend.call<GetPrescreenQueueResponse>('get_prescreen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
    });
    if (response.success) {
      // Mark records with enrichment status
      queue.value = response.records.map((record) => ({
        ...record,
        _enrichmentStatus: record.abstract
          ? 'complete'
          : record.can_enrich
            ? 'pending'
            : 'complete',
      }));
      totalCount.value = response.total_count;
      currentIndex.value = 0;

      // Start background enrichment for first batch
      startBackgroundEnrichment();
    }
  } catch (err) {
    console.error('Failed to load prescreen queue:', err);
  } finally {
    isLoading.value = false;
  }
}

async function startBackgroundEnrichment() {
  // Get first N records that need enrichment
  const recordsToEnrich = queue.value
    .slice(0, PREFETCH_BATCH_SIZE)
    .filter((r) => r._enrichmentStatus === 'pending')
    .map((r) => r.id);

  if (recordsToEnrich.length === 0) return;

  // Mark as loading
  recordsToEnrich.forEach((id) => {
    const record = queue.value.find((r) => r.id === id);
    if (record) record._enrichmentStatus = 'loading';
  });

  try {
    const response = await backend.call<BatchEnrichRecordsResponse>('batch_enrich_records', {
      project_id: projects.currentProjectId!,
      record_ids: recordsToEnrich,
      skip_commit: true,
    });

    if (response.success) {
      // Update queue with enriched data
      for (const result of response.records) {
        const queueRecord = queue.value.find((r) => r.id === result.id);
        if (queueRecord && result.record) {
          // Update record data
          queueRecord.abstract = result.record.abstract;
          queueRecord.can_enrich = false;
          queueRecord._enrichmentStatus = result.success ? 'complete' : 'failed';
        } else if (queueRecord) {
          queueRecord._enrichmentStatus = 'failed';
        }
      }
    }
  } catch (err) {
    console.error('Background enrichment failed:', err);
    // Mark all as failed
    recordsToEnrich.forEach((id) => {
      const record = queue.value.find((r) => r.id === id);
      if (record) record._enrichmentStatus = 'failed';
    });
  }
}

async function enrichSingleRecord(recordId: string) {
  const record = queue.value.find((r) => r.id === recordId);
  if (!record || record._enrichmentStatus !== 'pending') return;

  record._enrichmentStatus = 'loading';

  try {
    const response = await backend.call<EnrichRecordMetadataResponse>('enrich_record_metadata', {
      project_id: projects.currentProjectId!,
      record_id: recordId,
      skip_commit: true,
    });

    if (response.success && response.record) {
      record.abstract = response.record.abstract;
      record.can_enrich = false;
      record._enrichmentStatus = 'complete';
    } else {
      record._enrichmentStatus = 'failed';
    }
  } catch (err) {
    console.error(`Failed to enrich record ${recordId}:`, err);
    record._enrichmentStatus = 'failed';
  }
}

// Watch for index changes to prefetch next record
watch(currentIndex, async (newIndex) => {
  const nextRecord = queue.value[newIndex + 1];
  if (nextRecord && nextRecord._enrichmentStatus === 'pending') {
    await enrichSingleRecord(nextRecord.id);
  }

  // Also ensure current record is enriched if needed
  const current = queue.value[newIndex];
  if (current && current._enrichmentStatus === 'pending') {
    await enrichSingleRecord(current.id);
  }
});

async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isDeciding.value) return;

  isDeciding.value = true;
  try {
    const response = await backend.call<PrescreenRecordResponse>('prescreen_record', {
      project_id: projects.currentProjectId,
      record_id: currentRecord.value.id,
      decision,
    });

    if (response.success) {
      notifications.success(
        decision === 'include' ? 'Included' : 'Excluded',
        `${response.remaining_count} records remaining`
      );

      // Remove current record from queue and move to next
      queue.value.splice(currentIndex.value, 1);
      totalCount.value = response.remaining_count;

      // Adjust index if we're past the end
      if (currentIndex.value >= queue.value.length) {
        currentIndex.value = Math.max(0, queue.value.length - 1);
      }

      // Reload queue if empty but more records exist
      if (queue.value.length === 0 && response.remaining_count > 0) {
        await loadQueue();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Decision failed', message);
  } finally {
    isDeciding.value = false;
  }
}

function nextRecord() {
  if (currentIndex.value < queue.value.length - 1) {
    currentIndex.value++;
  }
}

function prevRecord() {
  if (currentIndex.value > 0) {
    currentIndex.value--;
  }
}

onMounted(() => {
  loadQueue();
});
</script>

<template>
  <div class="p-6 h-full flex flex-col">
    <!-- Page header -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <Filter class="h-6 w-6" />
          Prescreen
        </h2>
        <p class="text-muted-foreground">Screen records by title and abstract</p>
      </div>

      <Badge variant="secondary" class="text-lg px-3 py-1">
        {{ totalCount }} remaining
      </Badge>
    </div>

    <Separator class="mb-4" />

    <!-- Empty state -->
    <EmptyState
      v-if="!isLoading && queue.length === 0"
      :icon="Filter"
      title="No records to prescreen"
      description="All records have been prescreened or there are no records ready for prescreening."
    />

    <!-- Screening interface -->
    <div v-else class="flex-1 flex flex-col min-h-0">
      <!-- Current record card -->
      <Card v-if="currentRecord" class="flex-1 flex flex-col min-h-0">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <Badge variant="outline" class="font-mono">{{ currentRecord.id }}</Badge>
            <span class="text-sm text-muted-foreground">
              {{ currentIndex + 1 }} of {{ queue.length }}
            </span>
          </div>
          <CardTitle class="text-lg leading-tight">{{ currentRecord.title }}</CardTitle>
          <CardDescription>
            {{ currentRecord.author }} ({{ currentRecord.year }})
            <span v-if="currentRecord.journal" class="block">{{ currentRecord.journal }}</span>
            <span v-else-if="currentRecord.booktitle" class="block">{{
              currentRecord.booktitle
            }}</span>
          </CardDescription>
        </CardHeader>

        <CardContent class="flex-1 min-h-0 flex flex-col">
          <h4 class="text-sm font-medium mb-2">Abstract</h4>
          <ScrollArea class="flex-1 pr-4">
            <!-- Loading state for abstract enrichment -->
            <div
              v-if="currentRecord._enrichmentStatus === 'loading'"
              class="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 class="h-4 w-4 animate-spin" />
              <span>Loading abstract...</span>
            </div>
            <!-- Abstract content -->
            <p v-else class="text-sm text-muted-foreground whitespace-pre-wrap">
              {{ currentRecord.abstract || 'No abstract available' }}
            </p>
          </ScrollArea>
        </CardContent>
      </Card>

      <!-- Decision buttons -->
      <div class="flex items-center justify-center gap-4 mt-4 py-4 border-t">
        <Button variant="outline" size="lg" :disabled="currentIndex === 0" @click="prevRecord">
          Previous
        </Button>

        <Button
          variant="destructive"
          size="lg"
          class="min-w-[120px]"
          :disabled="!currentRecord || isDeciding || !isCurrentRecordReady"
          @click="makeDecision('exclude')"
        >
          <Loader2 v-if="isDeciding" class="h-5 w-5 mr-2 animate-spin" />
          <ThumbsDown v-else class="h-5 w-5 mr-2" />
          Exclude
        </Button>

        <Button
          variant="default"
          size="lg"
          class="min-w-[120px] bg-green-600 hover:bg-green-700"
          :disabled="!currentRecord || isDeciding || !isCurrentRecordReady"
          @click="makeDecision('include')"
        >
          <Loader2 v-if="isDeciding" class="h-5 w-5 mr-2 animate-spin" />
          <ThumbsUp v-else class="h-5 w-5 mr-2" />
          Include
        </Button>

        <Button
          variant="outline"
          size="lg"
          :disabled="currentIndex >= queue.length - 1 || !isNextRecordReady"
          @click="nextRecord"
        >
          <Loader2
            v-if="!isNextRecordReady"
            class="h-4 w-4 mr-2 animate-spin"
          />
          Skip
        </Button>
      </div>
    </div>
  </div>
</template>
