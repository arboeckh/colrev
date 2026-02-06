<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { CheckSquare, ThumbsUp, ThumbsDown, FileText } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type { GetScreenQueueResponse, ScreenQueueRecord, ScreenRecordResponse, ScreenCriterionDefinition } from '@/types/api';

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();

const queue = ref<ScreenQueueRecord[]>([]);
const criteria = ref<Record<string, ScreenCriterionDefinition>>({});
const totalCount = ref(0);
const isLoading = ref(false);
const currentIndex = ref(0);
const isDeciding = ref(false);

const currentRecord = computed(() => queue.value[currentIndex.value] || null);

async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  try {
    const response = await backend.call<GetScreenQueueResponse>('get_screen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
    });
    if (response.success) {
      queue.value = response.records;
      criteria.value = response.criteria;
      totalCount.value = response.total_count;
      currentIndex.value = 0;
    }
  } catch (err) {
    console.error('Failed to load screen queue:', err);
  } finally {
    isLoading.value = false;
  }
}

async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isDeciding.value) return;

  isDeciding.value = true;
  try {
    const response = await backend.call<ScreenRecordResponse>('screen_record', {
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
          <CheckSquare class="h-6 w-6" />
          Screen
        </h2>
        <p class="text-muted-foreground">Full-text screening of records</p>
      </div>

      <Badge variant="secondary" class="text-lg px-3 py-1">
        {{ totalCount }} remaining
      </Badge>
    </div>

    <Separator class="mb-4" />

    <!-- Empty state -->
    <EmptyState
      v-if="!isLoading && queue.length === 0"
      :icon="CheckSquare"
      title="No records to screen"
      description="All records have been screened or there are no records ready for full-text screening."
    />

    <!-- Screening interface -->
    <div v-else class="flex-1 flex gap-4 min-h-0">
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
          </CardDescription>
        </CardHeader>

        <CardContent class="flex-1 min-h-0 flex flex-col">
          <h4 class="text-sm font-medium mb-2">Abstract</h4>
          <ScrollArea class="flex-1 pr-4">
            <p class="text-sm text-muted-foreground whitespace-pre-wrap">
              {{ currentRecord.abstract || 'No abstract available' }}
            </p>
          </ScrollArea>

          <!-- PDF link -->
          <div v-if="currentRecord.pdf_path" class="mt-4 p-3 bg-muted rounded-md">
            <div class="flex items-center gap-2 text-sm">
              <FileText class="h-4 w-4" />
              <span class="font-mono text-xs truncate">{{ currentRecord.pdf_path }}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Criteria panel -->
      <Card v-if="Object.keys(criteria).length > 0" class="w-72 flex flex-col">
        <CardHeader class="pb-2">
          <CardTitle class="text-base">Screening Criteria</CardTitle>
        </CardHeader>
        <CardContent class="flex-1 overflow-auto">
          <div class="space-y-3">
            <div v-for="(criterion, key) in criteria" :key="key" class="p-2 bg-muted rounded-md">
              <span class="font-medium text-sm">{{ key }}</span>
              <p class="text-xs text-muted-foreground mt-1">{{ criterion.explanation }}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Decision buttons -->
    <div class="flex items-center justify-center gap-4 mt-4 py-4 border-t">
      <Button
        variant="outline"
        size="lg"
        :disabled="currentIndex === 0"
        @click="prevRecord"
      >
        Previous
      </Button>

      <Button
        variant="destructive"
        size="lg"
        class="min-w-[120px]"
        :disabled="!currentRecord || isDeciding"
        @click="makeDecision('exclude')"
      >
        <ThumbsDown class="h-5 w-5 mr-2" />
        Exclude
      </Button>

      <Button
        variant="default"
        size="lg"
        class="min-w-[120px] bg-green-600 hover:bg-green-700"
        :disabled="!currentRecord || isDeciding"
        @click="makeDecision('include')"
      >
        <ThumbsUp class="h-5 w-5 mr-2" />
        Include
      </Button>

      <Button
        variant="outline"
        size="lg"
        :disabled="currentIndex >= queue.length - 1"
        @click="nextRecord"
      >
        Skip
      </Button>
    </div>
  </div>
</template>
