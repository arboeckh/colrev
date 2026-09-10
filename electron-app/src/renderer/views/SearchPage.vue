<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Plus, Loader2, Play } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { AddSourceDialog, SourceCard } from '@/components/search';
import type { SourceRunState } from '@/components/search/SourceCard.vue';
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

// Search state, per source.
//
// "Run all searches" is a wrapper around the per-source runs rather than a
// separate batch RPC, so every card reports its own status instead of echoing
// whichever source the shared progress channel last mentioned. The backend
// handles one RPC at a time, so the batch advances one source at a time and
// the sources still waiting say "Queued".
const searchingSource = ref<string | null>(null);
const queuedSources = ref<string[]>([]);
const isRunningAll = ref(false);
const progressBySource = ref<Record<string, string>>({});
let progressCleanup: (() => void) | null = null;

const isSearching = computed(() => searchingSource.value !== null);

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

// Only API sources can be run from here. File-based sources are refreshed by
// uploading a new export — colrev's DB search path prompts on stdin, which the
// JSON-RPC backend has no way to answer.
const runnableSources = computed(() =>
  visibleSources.value.filter(s => s.search_type === 'API'),
);

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

function sourceKey(source: SearchSource): string {
  return source.filename || source.search_results_path || '';
}

function runStateFor(source: SearchSource): SourceRunState {
  const key = sourceKey(source);
  if (searchingSource.value === key) return 'searching';
  if (queuedSources.value.includes(key)) return 'queued';
  return 'idle';
}

/** Run one source. Resolves either way so a batch continues past a failure. */
async function runSourceSearch(sourceFilename: string): Promise<boolean> {
  if (isSearching.value || !projects.currentProjectId || !backend.isRunning) return false;

  searchingSource.value = sourceFilename;
  delete progressBySource.value[sourceFilename];

  try {
    await backend.call('search', {
      project_id: projects.currentProjectId,
      source: sourceFilename,
      rerun: true,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Search failed', message);
    return false;
  } finally {
    searchingSource.value = null;
    delete progressBySource.value[sourceFilename];
  }
}

/** Run every API source, one after another, reporting each on its own card. */
async function runAllSearches() {
  if (isSearching.value || isRunningAll.value) return;
  if (!projects.currentProjectId || !backend.isRunning) return;

  const pending = runnableSources.value.map(sourceKey).filter(Boolean);
  if (pending.length === 0) return;

  isRunningAll.value = true;
  queuedSources.value = [...pending];
  let succeeded = 0;

  try {
    for (const filename of pending) {
      queuedSources.value = queuedSources.value.filter(f => f !== filename);
      if (await runSourceSearch(filename)) succeeded += 1;
    }
  } finally {
    queuedSources.value = [];
    isRunningAll.value = false;
  }

  if (succeeded === pending.length) {
    notifications.success(
      'Searches completed',
      `Ran ${succeeded} source${succeeded !== 1 ? 's' : ''}`,
    );
  } else if (succeeded > 0) {
    notifications.error(
      'Some searches failed',
      `${succeeded} of ${pending.length} sources completed`,
    );
  }
}

/** Run one source from its card, outside a batch. */
async function runSingleSearch(sourceFilename: string) {
  if (await runSourceSearch(sourceFilename)) {
    notifications.success('Search completed');
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
      // Per-source staleness metadata (is_stale/stale_reason) is display
      // detail for the cards below. The sidebar-level staleness flag comes
      // from the status payload (projects.hasStaleSearchSources) — this
      // page does not write it.
      sources.value = response.sources as unknown as SearchSource[];
    }
  } catch (err) {
    if (guard.isCurrent()) {
      sourcesLoadError.value = err instanceof Error ? err.message : 'Unknown error';
    }
  } finally {
    isLoadingSources.value = false;
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
  // Progress events carry the source they belong to, so a status line lands on
  // the card that produced it.
  progressCleanup = backend.onSearchProgress((progress) => {
    if (!progress.source) return;
    progressBySource.value = {
      ...progressBySource.value,
      [progress.source]: progress.status,
    };
  });
});

onUnmounted(() => {
  progressCleanup?.();
  progressCleanup = null;
  backend.clearSearchProgress();
});
</script>

<template>
  <StepPageShell
    step="search"
    subtitle="Configure and execute searches for literature"
    :page-help="SearchPageHelp"
  >
    <div class="p-6 space-y-6">
    <Separator />

    <!-- Sources section header with Run All button -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h3 class="text-lg font-medium">Search Sources</h3>
        <Badge variant="outline">{{ visibleSources.length }} source{{ visibleSources.length !== 1 ? 's' : '' }}</Badge>
      </div>

      <Button
        v-if="runnableSources.length > 0"
        :disabled="isSearching || isRunningAll || !backend.isRunning || isReadOnly"
        data-testid="run-all-searches-button"
        @click="runAllSearches"
      >
        <Loader2 v-if="isRunningAll" class="h-4 w-4 mr-2 animate-spin" />
        <Play v-else class="h-4 w-4 mr-2" />
        {{ isRunningAll ? 'Running searches...' : 'Run All Searches' }}
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
    <div v-else class="flex flex-wrap gap-3">
      <!-- Source cards -->
      <SourceCard
        v-for="source in visibleSources"
        :key="sourceKey(source)"
        :source="source"
        :project-id="projects.currentProjectId!"
        :run-state="runStateFor(source)"
        :progress-message="progressBySource[sourceKey(source)]"
        :busy="isSearching || isRunningAll"
        :read-only="isReadOnly"
        class="w-80"
        @run-search="runSingleSearch"
      />

      <!-- Add Source skeleton card (hidden when read-only) -->
      <div v-if="!isReadOnly" class="relative w-72" data-testid="add-source-card">
        <Card
          class="h-full border-dashed border-2 hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
          :class="(isSearching || isRunningAll) && 'pointer-events-none opacity-50'"
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
