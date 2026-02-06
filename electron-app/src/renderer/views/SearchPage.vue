<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Plus, Upload, Globe, Database, ChevronDown, CheckCircle2, ArrowRight, Loader2, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/common';
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

// Determine if search step is complete (has actual records retrieved and no pending changes)
const isSearchComplete = computed(() => {
  // If sources were modified, search is not complete
  if (projects.searchSourcesModified) return false;

  const status = projects.currentStatus;
  if (!status) return false;

  // Search is complete only when there are actual records in the system
  const totalRecords = status.total_records || 0;
  return totalRecords > 0;
});

// Determine if we can view results (search has been run, sources not modified)
// This is separate from isSearchComplete because we want to show results
// even before records are loaded into records.bib
const canViewSourceResults = computed(() => {
  // If sources were modified since last search, can't view results
  if (projects.searchSourcesModified) return false;

  // If currently searching, can't view results
  if (isSearching.value) return false;

  // Must have sources configured
  return visibleSources.value.length > 0;
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

    // Reset modified flag since search was just run
    projects.clearSearchSourcesModified();

    await loadSources();
    await projects.refreshCurrentProject();
  } catch (err) {
    stopProgressTracking(false);
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Search failed', message);
  } finally {
    isSearching.value = false;
    searchProgress.value = 0;
    searchStatus.value = '';
    fetchedRecords.value = 0;
    totalRecords.value = 0;
  }
}

function handleSourceAdded() {
  loadSources();
  projects.markSearchSourcesModified();
}

function handleSourceDeleted() {
  loadSources();
  projects.markSearchSourcesModified();
}

function handleSourceUpdated() {
  loadSources();
  projects.markSearchSourcesModified();
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

      <div class="flex items-center gap-2">
        <!-- Add source dropdown -->
        <div class="relative" data-testid="add-source-dropdown">
          <Button
            variant="outline"
            :disabled="isSearching"
            data-testid="add-source-button"
            @click="showAddMenu = !showAddMenu"
          >
            <Plus class="h-4 w-4 mr-2" />
            Add Source
            <ChevronDown class="h-4 w-4 ml-2" />
          </Button>

          <!-- Dropdown menu -->
          <div
            v-if="showAddMenu && !isSearching"
            class="absolute right-0 mt-2 w-56 bg-popover border border-border rounded-md shadow-lg z-50"
            data-testid="add-source-menu"
          >
            <div class="p-1">
              <button
                class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground"
                data-testid="add-file-source-option"
                @click="showAddFileDialog = true; showAddMenu = false"
              >
                <Database class="h-4 w-4" />
                <div class="text-left">
                  <div class="font-medium">Database Export</div>
                  <div class="text-xs text-muted-foreground">Upload BibTeX, RIS, etc.</div>
                </div>
              </button>
              <button
                class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground"
                data-testid="add-api-source-option"
                @click="showAddApiDialog = true; showAddMenu = false"
              >
                <Globe class="h-4 w-4" />
                <div class="text-left">
                  <div class="font-medium">PubMed Search</div>
                  <div class="text-xs text-muted-foreground">Search via API</div>
                </div>
              </button>
            </div>
          </div>

          <!-- Click outside to close -->
          <div
            v-if="showAddMenu"
            class="fixed inset-0 z-40"
            @click="showAddMenu = false"
          />
        </div>

        <Button
          :disabled="isSearching || visibleSources.length === 0 || !backend.isRunning"
          data-testid="run-search-button"
          @click="runSearch"
        >
          <Loader2 v-if="isSearching" class="h-4 w-4 mr-2 animate-spin" />
          <Search v-else class="h-4 w-4 mr-2" />
          {{ isSearching ? 'Searching...' : 'Run Search' }}
        </Button>
      </div>
    </div>

    <!-- Search Progress Card -->
    <Card v-if="isSearching" class="border-primary/20 bg-primary/5">
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
          <div v-if="totalRecords >= 10000" class="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-600 dark:text-yellow-500">
            <span class="font-medium">Note:</span>
            <span>PubMed API limits searches to 10,000 results. Consider narrowing your search query or splitting by date range for complete results.</span>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Step completion banner -->
    <div
      v-else-if="isSearchComplete"
      class="flex items-center justify-between p-4 bg-green-500/10 border border-green-500/20 rounded-lg"
      data-testid="search-complete-banner"
    >
      <div class="flex items-center gap-3">
        <CheckCircle2 class="h-5 w-5 text-green-500" />
        <div>
          <p class="font-medium text-green-500">Search Complete</p>
          <p class="text-sm text-muted-foreground">
            {{ visibleSources.length }} source{{ visibleSources.length !== 1 ? 's' : '' }} configured.
            Ready to load records.
          </p>
        </div>
      </div>
      <Button data-testid="next-step-button" @click="goToNextStep">
        Next: Load
        <ArrowRight class="h-4 w-4 ml-2" />
      </Button>
    </div>

    <Separator />

    <!-- Sources list -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-medium">Search Sources</h3>
        <Badge variant="outline">{{ visibleSources.length }} source{{ visibleSources.length !== 1 ? 's' : '' }}</Badge>
      </div>

      <EmptyState
        v-if="visibleSources.length === 0 && !isLoadingSources"
        :icon="Search"
        title="No search sources configured"
        description="Add search sources to start finding literature for your review."
      >
        <template #action>
          <div class="flex gap-2">
            <Button
              variant="outline"
              :disabled="isSearching"
              data-testid="empty-add-file-source"
              @click="showAddFileDialog = true"
            >
              <Upload class="h-4 w-4 mr-2" />
              Upload File
            </Button>
            <Button :disabled="isSearching" data-testid="empty-add-api-source" @click="showAddApiDialog = true">
              <Globe class="h-4 w-4 mr-2" />
              PubMed Search
            </Button>
          </div>
        </template>
      </EmptyState>

      <div v-else class="grid gap-4" :class="{ 'opacity-50 pointer-events-none': isSearching }">
        <SourceCard
          v-for="source in visibleSources"
          :key="source.filename || source.search_results_path"
          :source="source"
          :project-id="projects.currentProjectId!"
          :can-view-results="canViewSourceResults"
          @deleted="handleSourceDeleted"
          @updated="handleSourceUpdated"
        />
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
