<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Search, Plus, Upload, Globe, Database, ChevronDown } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { OperationButton, EmptyState } from '@/components/common';
import { AddFileSourceDialog, AddApiSourceDialog, SourceCard } from '@/components/search';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import type { GetSourcesResponse, SearchSource } from '@/types';

const projects = useProjectsStore();
const backend = useBackendStore();

const sources = ref<SearchSource[]>([]);
const isLoadingSources = ref(false);

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

async function handleSearchComplete() {
  await loadSources();
  await projects.refreshCurrentProject();
}

function handleSourceAdded() {
  loadSources();
}

function handleSourceDeleted() {
  loadSources();
}

function handleSourceUpdated() {
  loadSources();
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
            data-testid="add-source-button"
            @click="showAddMenu = !showAddMenu"
          >
            <Plus class="h-4 w-4 mr-2" />
            Add Source
            <ChevronDown class="h-4 w-4 ml-2" />
          </Button>

          <!-- Dropdown menu -->
          <div
            v-if="showAddMenu"
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

        <OperationButton
          v-if="projects.currentProjectId"
          operation="search"
          :project-id="projects.currentProjectId"
          label="Run Search"
          data-testid="run-search-button"
          @success="handleSearchComplete"
        />
      </div>
    </div>

    <Separator />

    <!-- Sources list -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-medium">Search Sources</h3>
        <Badge variant="outline">{{ sources.length }} source{{ sources.length !== 1 ? 's' : '' }}</Badge>
      </div>

      <EmptyState
        v-if="sources.length === 0 && !isLoadingSources"
        :icon="Search"
        title="No search sources configured"
        description="Add search sources to start finding literature for your review."
      >
        <template #action>
          <div class="flex gap-2">
            <Button
              variant="outline"
              data-testid="empty-add-file-source"
              @click="showAddFileDialog = true"
            >
              <Upload class="h-4 w-4 mr-2" />
              Upload File
            </Button>
            <Button data-testid="empty-add-api-source" @click="showAddApiDialog = true">
              <Globe class="h-4 w-4 mr-2" />
              PubMed Search
            </Button>
          </div>
        </template>
      </EmptyState>

      <div v-else class="grid gap-4">
        <SourceCard
          v-for="source in sources"
          :key="source.filename || source.search_results_path"
          :source="source"
          :project-id="projects.currentProjectId!"
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
