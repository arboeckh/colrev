<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Plus, Loader2, Play } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { AddSourceDialog, SourceCard } from '@/components/search';
import { LoadErrorState } from '@/components/common';
import StepPageShell from '@/components/layout/StepPageShell.vue';
import SearchPageHelp from './SearchPageHelp.vue';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectDataStore } from '@/stores/projectData';
import { useProjectDataChanged } from '@/composables/useProjectDataChanged';
import { useReadOnly } from '@/composables/useReadOnly';
import type { SearchSource } from '@/types';

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const projectData = useProjectDataStore();
const { isReadOnly } = useReadOnly();

const sources = ref<SearchSource[]>([]);
const isLoadingSources = ref(false);
const sourcesLoadError = ref<string | null>(null);

// Search state
const isSearching = ref(false);
const searchingSource = ref<string | null>(null); // null = all sources, string = specific source filename
const searchProgress = ref(0);
const searchStatus = ref('');
const fetchedRecords = ref(0);
const totalRecords = ref(0);
const currentBatch = ref(0);
const totalBatches = ref(0);
let progressCleanup: (() => void) | null = null;

// Filter out empty FILES type sources (like the default files.bib)
// These are useful for PDF imports but clutter the UI when empty
const visibleSources = computed(() => {
  return sources.value.filter(source => {
    // Hide FILES type sources that have no search results
    if (source.search_type === 'FILES') {
      return false; // Hide all FILES sources for now - they're for advanced PDF import workflow
    }
    return true;
  });
});

// Count API sources for progress estimation
const apiSourceCount = computed(() => {
  return visibleSources.value.filter(s => s.search_type === 'API').length;
});

// Endpoints already configured as API sources — gallery uses these to disable
// duplicate tiles.
const existingApiEndpoints = computed(() => {
  return sources.value
    .filter(s => s.search_type === 'API')
    .map(s => s.platform ?? s.endpoint ?? '')
    .filter(Boolean);
});

// Dialog state — single unified Add Source dialog
const showAddSourceDialog = ref(false);

// Run search for a specific source
async function runSourceSearch(sourceFilename: string) {
  if (isSearching.value || !projects.currentProjectId || !backend.isRunning) return;

  isSearching.value = true;
  searchingSource.value = sourceFilename; // Track which source is being searched
  startProgressTracking();

  try {
    await backend.call('search', {
      project_id: projects.currentProjectId,
      source: sourceFilename,
      rerun: true,
    });

    stopProgressTracking(true);
    notifications.success('Search completed');

    // Sources, status counts and operation info refresh via the invalidation
    // seam (search is a writer RPC). Short delay to show 100% before hiding.
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    stopProgressTracking(false);
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Search failed', message);
  } finally {
    isSearching.value = false;
    searchingSource.value = null;
    searchProgress.value = 0;
    searchStatus.value = '';
    fetchedRecords.value = 0;
    totalRecords.value = 0;
  }
}

async function loadSources() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoadingSources.value = true;
  sourcesLoadError.value = null;
  const guard = projectData.snapshot();
  try {
    const response = await backend.call('get_sources', {
      project_id: projects.currentProjectId,
    });
    // Project/branch switch mid-flight: discard the stale response.
    if (!guard.isCurrent()) return;
    if (response.success) {
      const loadedSources = response.sources as unknown as SearchSource[];
      sources.value = loadedSources;
      // Update the store with stale status for sidebar to use
      // A source needs action if:
      // 1. It's explicitly marked as stale (needs re-run)
      // 2. It's an API source that has never been run (no records)
      const hasSourcesNeedingAction = loadedSources.some(s => {
        if (s.search_type === 'FILES') return false;
        // Explicitly stale
        if (s.is_stale) return true;
        // API source that has never been run
        if (s.search_type === 'API' && !s.last_run_timestamp) return true;
        return false;
      });
      projects.setHasStaleSearchSources(hasSourcesNeedingAction);
    }
  } catch (err) {
    if (guard.isCurrent()) {
      sourcesLoadError.value = err instanceof Error ? err.message : 'Unknown error';
    }
  } finally {
    isLoadingSources.value = false;
  }
}

function startProgressTracking() {
  searchProgress.value = 0;
  searchStatus.value = 'Connecting to search APIs...';
  fetchedRecords.value = 0;
  totalRecords.value = 0;
  currentBatch.value = 0;
  totalBatches.value = 0;

  // Listen for real progress from backend logs
  progressCleanup = backend.onSearchProgress((progress) => {
    currentBatch.value = progress.currentBatch;
    totalBatches.value = progress.totalBatches;
    fetchedRecords.value = progress.fetchedRecords;
    totalRecords.value = progress.totalRecords;
    searchStatus.value = progress.status;

    // Calculate real progress percentage
    if (progress.totalBatches > 0) {
      searchProgress.value = Math.round((progress.currentBatch / progress.totalBatches) * 100);
    } else if (progress.totalRecords > 0) {
      searchProgress.value = Math.round((progress.fetchedRecords / progress.totalRecords) * 100);
    }
  });
}

function stopProgressTracking(success: boolean) {
  if (progressCleanup) {
    progressCleanup();
    progressCleanup = null;
  }
  backend.clearSearchProgress();

  if (success) {
    searchProgress.value = 100;
    searchStatus.value = 'Search complete!';
  }
}

async function runSearch() {
  if (isSearching.value || !projects.currentProjectId || !backend.isRunning) return;

  isSearching.value = true;
  searchingSource.value = null; // null means all sources
  startProgressTracking();

  try {
    // Use rerun=true to fetch all results (not just incremental updates)
    // This ensures we don't hit the early termination logic in PubMed API
    await backend.call('search', {
      project_id: projects.currentProjectId,
      rerun: true,
    });

    stopProgressTracking(true);
    notifications.success('Search completed');

    // Sources, status counts and operation info refresh via the invalidation
    // seam. Short delay to show 100% before hiding.
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    stopProgressTracking(false);
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Search failed', message);
  } finally {
    isSearching.value = false;
    searchingSource.value = null;
    searchProgress.value = 0;
    searchStatus.value = '';
    fetchedRecords.value = 0;
    totalRecords.value = 0;
  }
}

// Source mutations (add/update/delete/upload) and searches are writer RPCs:
// the invalidation seam refreshes store-level state and this reloads the
// page-owned source list.
useProjectDataChanged(async () => {
  await loadSources();
});

onMounted(() => {
  loadSources();
});
</script>

<template>
  <StepPageShell
    step="search"
    subtitle="Configure and execute searches for literature"
    :page-help="SearchPageHelp"
  >
    <div class="p-6 space-y-6">
    <!-- Search Progress Card (only for "Run All Searches") -->
    <Card v-if="isSearching && searchingSource === null" class="border-primary/20 bg-primary/5">
      <CardContent class="pt-6">
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <Loader2 class="h-5 w-5 animate-spin text-primary" />
              <div>
                <p class="font-medium">Searching databases...</p>
                <p class="text-sm text-muted-foreground">{{ searchStatus || 'Connecting to APIs...' }}</p>
              </div>
            </div>
            <div class="text-right">
              <span class="text-sm font-medium tabular-nums">{{ Math.round(searchProgress) }}%</span>
              <p v-if="totalRecords > 0" class="text-xs text-muted-foreground tabular-nums">
                {{ fetchedRecords.toLocaleString() }} / {{ totalRecords.toLocaleString() }} records
              </p>
            </div>
          </div>
          <Progress :model-value="searchProgress" class="h-2" />
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span v-if="totalBatches > 0">
              Batch {{ currentBatch }} of {{ totalBatches }}
            </span>
            <span v-else>
              Querying {{ apiSourceCount }} API source{{ apiSourceCount !== 1 ? 's' : '' }}
            </span>
            <span v-if="totalRecords > 0">
              ~{{ Math.ceil((totalBatches - currentBatch) * 0.5) }}s remaining
            </span>
          </div>
          <!-- 10k limit warning -->
          <div v-if="totalRecords >= 10000"
            class="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-600 dark:text-yellow-500">
            <span class="font-medium">Note:</span>
            <span>PubMed API limits searches to 10,000 results. Consider narrowing your search query or splitting by
              date range for complete results.</span>
          </div>
        </div>
      </CardContent>
    </Card>

    <Separator />

    <!-- Sources section header with Run All button -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h3 class="text-lg font-medium">Search Sources</h3>
        <Badge variant="outline">{{ visibleSources.length }} source{{ visibleSources.length !== 1 ? 's' : '' }}</Badge>
      </div>

      <Button
        v-if="visibleSources.length > 0"
        :disabled="isSearching || !backend.isRunning || isReadOnly"
        data-testid="run-all-searches-button"
        @click="runSearch"
      >
        <Loader2 v-if="isSearching" class="h-4 w-4 mr-2 animate-spin" />
        <Play v-else class="h-4 w-4 mr-2" />
        {{ isSearching ? 'Searching...' : 'Run All Searches' }}
      </Button>
    </div>

    <!-- Load failure: retry UI, distinguishable from "no sources" -->
    <LoadErrorState
      v-if="sourcesLoadError && !isLoadingSources"
      title="Failed to load search sources"
      :message="sourcesLoadError"
      test-id="search-sources-load-error"
      @retry="loadSources"
    />

    <!-- Sources grid -->
    <div v-else class="flex flex-wrap gap-3" :class="{ 'opacity-50 pointer-events-none': isSearching }">
      <!-- Source cards -->
      <SourceCard
        v-for="source in visibleSources"
        :key="source.filename || source.search_results_path"
        :source="source"
        :project-id="projects.currentProjectId!"
        :is-searching="isSearching && (searchingSource === null || searchingSource === (source.filename || source.search_results_path))"
        :search-progress="isSearching && (searchingSource === null || searchingSource === (source.filename || source.search_results_path)) ? { progress: searchProgress, status: searchStatus, fetchedRecords, totalRecords, currentBatch, totalBatches } : undefined"
        :read-only="isReadOnly"
        class="w-80"
        @run-search="runSourceSearch"
      />

      <!-- Add Source skeleton card (hidden when read-only) -->
      <div v-if="!isReadOnly" class="relative w-72" data-testid="add-source-card">
        <Card
          class="h-full border-dashed border-2 hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
          @click="showAddSourceDialog = true"
        >
          <CardContent class="flex flex-col items-center justify-center py-6 text-muted-foreground h-full">
            <div class="h-8 w-8 rounded-full bg-muted flex items-center justify-center mb-2">
              <Plus class="h-4 w-4" />
            </div>
            <p class="font-medium text-sm">Add Source</p>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Unified Add Source dialog -->
    <AddSourceDialog
      v-if="projects.currentProjectId"
      v-model:open="showAddSourceDialog"
      :project-id="projects.currentProjectId"
      :existing-api-endpoints="existingApiEndpoints"
    />
    </div>
  </StepPageShell>
</template>
