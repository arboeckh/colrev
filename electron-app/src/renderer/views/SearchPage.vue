<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Plus, Globe, Database, CheckCircle2, ArrowRight, Loader2, AlertTriangle, Play } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { AddFileSourceDialog, AddApiSourceDialog, SourceCard } from '@/components/search';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type { GetSourcesResponse, SearchSource } from '@/types';

const router = useRouter();
const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();

const sources = ref<SearchSource[]>([]);
const isLoadingSources = ref(false);

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

// Check if a PubMed source already exists (to disable adding another)
const hasPubmedSource = computed(() => {
  return sources.value.some(s =>
    s.platform === 'colrev.pubmed' || s.endpoint === 'colrev.pubmed'
  );
});

// Per-source staleness tracking
const hasStaleSource = computed(() => {
  return visibleSources.value.some(s => s.is_stale);
});

const staleSourceCount = computed(() => {
  return visibleSources.value.filter(s => s.is_stale).length;
});

// Determine if search step is complete (has actual records retrieved and no pending changes)
const isSearchComplete = computed(() => {
  const status = projects.currentStatus;
  if (!status) return false;

  // Check per-source staleness first
  if (hasStaleSource.value) return false;

  // Check if search needs to be re-run based on backend state
  const searchOpInfo = projects.operationInfo.search;
  if (searchOpInfo?.needs_rerun) return false;

  // Search is complete only when there are actual records in the system
  const totalRecords = status.total_records || 0;
  return totalRecords > 0;
});

function goToNextStep() {
  if (projects.currentProjectId) {
    router.push(`/project/${projects.currentProjectId}/load`);
  }
}

// Dialog states
const showAddFileDialog = ref(false);
const showAddApiDialog = ref(false);
const showAddMenu = ref(false);

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

    await new Promise(resolve => setTimeout(resolve, 500));
    await loadSources();
    await projects.refreshCurrentProject();
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

// Get total record count across all sources
const totalSourceRecords = computed(() => {
  return visibleSources.value.reduce((sum, s) => sum + (s.record_count ?? 0), 0);
});

async function loadSources() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoadingSources.value = true;
  try {
    const response = await backend.call<GetSourcesResponse>('get_sources', {
      project_id: projects.currentProjectId,
    });
    if (response.success) {
      sources.value = response.sources;
    }
  } catch (err) {
    console.error('Failed to load sources:', err);
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

    // Short delay to show 100% before hiding
    await new Promise(resolve => setTimeout(resolve, 500));

    await loadSources();
    // Refresh project to get updated operation info from backend
    await projects.refreshCurrentProject();
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

async function handleSourceAdded() {
  await loadSources();
  // Refresh operation info to detect that search needs re-run
  await projects.refreshCurrentProject();
}

async function handleSourceDeleted() {
  await loadSources();
  // Refresh operation info to detect that search needs re-run
  await projects.refreshCurrentProject();
}

async function handleSourceUpdated() {
  await loadSources();
  // Refresh operation info to detect that search needs re-run
  await projects.refreshCurrentProject();
}

onMounted(() => {
  loadSources();
});
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <Search class="h-6 w-6" />
          Search
        </h2>
        <p class="text-muted-foreground">Configure and execute searches for literature</p>
      </div>

      <!-- Status indicator (top right) -->
      <div class="flex items-center gap-3">
        <!-- Complete state -->
        <template v-if="isSearchComplete">
          <div class="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 class="h-5 w-5" />
            <span class="text-sm font-medium">{{ totalSourceRecords.toLocaleString() }} records</span>
          </div>
          <Button data-testid="next-step-button" @click="goToNextStep">
            Next: Load
            <ArrowRight class="h-4 w-4 ml-2" />
          </Button>
        </template>

        <!-- Stale state -->
        <template v-else-if="hasStaleSource">
          <div class="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
            <AlertTriangle class="h-5 w-5" />
            <span class="text-sm font-medium">{{ staleSourceCount }} stale</span>
          </div>
        </template>

        <!-- No sources / pending state -->
        <template v-else-if="visibleSources.length === 0">
          <div class="flex items-center gap-2 text-muted-foreground">
            <Search class="h-5 w-5" />
            <span class="text-sm">No sources configured</span>
          </div>
        </template>

        <!-- Has sources but not run -->
        <template v-else>
          <div class="flex items-center gap-2 text-muted-foreground">
            <Search class="h-5 w-5" />
            <span class="text-sm font-medium">{{ visibleSources.length }} source{{ visibleSources.length !== 1 ? 's' : '' }}</span>
          </div>
        </template>
      </div>
    </div>

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
        :disabled="isSearching || !backend.isRunning"
        data-testid="run-all-searches-button"
        @click="runSearch"
      >
        <Loader2 v-if="isSearching" class="h-4 w-4 mr-2 animate-spin" />
        <Play v-else class="h-4 w-4 mr-2" />
        {{ isSearching ? 'Searching...' : 'Run All Searches' }}
      </Button>
    </div>

    <!-- Sources grid -->
    <div class="flex flex-wrap gap-3" :class="{ 'opacity-50 pointer-events-none': isSearching }">
      <!-- Source cards -->
      <SourceCard
        v-for="source in visibleSources"
        :key="source.filename || source.search_results_path"
        :source="source"
        :project-id="projects.currentProjectId!"
        :is-searching="isSearching && (searchingSource === null || searchingSource === (source.filename || source.search_results_path))"
        :search-progress="isSearching && (searchingSource === null || searchingSource === (source.filename || source.search_results_path)) ? { progress: searchProgress, status: searchStatus, fetchedRecords, totalRecords, currentBatch, totalBatches } : undefined"
        class="w-80"
        @deleted="handleSourceDeleted"
        @updated="handleSourceUpdated"
        @run-search="runSourceSearch"
      />

      <!-- Add Source skeleton card -->
      <div class="relative w-72" data-testid="add-source-card">
        <Card
          class="h-full border-dashed border-2 hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
          @click="showAddMenu = !showAddMenu"
        >
          <CardContent class="flex flex-col items-center justify-center py-6 text-muted-foreground h-full">
            <div class="h-8 w-8 rounded-full bg-muted flex items-center justify-center mb-2">
              <Plus class="h-4 w-4" />
            </div>
            <p class="font-medium text-sm">Add Source</p>
          </CardContent>
        </Card>

        <!-- Add source dropdown menu -->
        <div
          v-if="showAddMenu"
          class="absolute left-0 top-full mt-2 w-64 bg-popover border border-border rounded-md shadow-lg z-50"
          data-testid="add-source-menu"
        >
          <div class="p-1">
            <button
              class="w-full flex items-center gap-3 px-3 py-3 text-sm rounded-sm"
              :class="hasPubmedSource
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-accent hover:text-accent-foreground cursor-pointer'"
              :disabled="hasPubmedSource"
              data-testid="add-api-source-option"
              @click="!hasPubmedSource && (showAddApiDialog = true, showAddMenu = false)"
            >
              <Globe class="h-5 w-5" />
              <div class="text-left">
                <div class="font-medium">PubMed Search</div>
                <div class="text-xs text-muted-foreground">
                  {{ hasPubmedSource ? 'Already added - edit existing source' : 'Search via API' }}
                </div>
              </div>
            </button>
            <button
              class="w-full flex items-center gap-3 px-3 py-3 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground"
              data-testid="add-file-source-option"
              @click="showAddFileDialog = true; showAddMenu = false"
            >
              <Database class="h-5 w-5" />
              <div class="text-left">
                <div class="font-medium">Database Export</div>
                <div class="text-xs text-muted-foreground">Upload BibTeX, RIS, etc.</div>
              </div>
            </button>
          </div>
        </div>

        <!-- Click outside to close -->
        <div v-if="showAddMenu" class="fixed inset-0 z-40" @click="showAddMenu = false" />
      </div>
    </div>

    <!-- Dialogs -->
    <AddFileSourceDialog
      v-if="projects.currentProjectId"
      v-model:open="showAddFileDialog"
      :project-id="projects.currentProjectId"
      @source-added="handleSourceAdded"
    />

    <AddApiSourceDialog
      v-if="projects.currentProjectId"
      v-model:open="showAddApiDialog"
      :project-id="projects.currentProjectId"
      @source-added="handleSourceAdded"
    />
  </div>
</template>
