<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Search, Plus, Upload, Play, ExternalLink } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { OperationButton, EmptyState } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import type { GetSourcesResponse, SearchSource } from '@/types';

const projects = useProjectsStore();
const backend = useBackendStore();

const sources = ref<SearchSource[]>([]);
const isLoadingSources = ref(false);

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
        <Button variant="outline" disabled>
          <Upload class="h-4 w-4 mr-2" />
          Upload File
        </Button>
        <Button variant="outline" disabled>
          <Plus class="h-4 w-4 mr-2" />
          Add Source
        </Button>
        <OperationButton
          v-if="projects.currentProjectId"
          operation="search"
          :project-id="projects.currentProjectId"
          label="Run Search"
          @success="handleSearchComplete"
        />
      </div>
    </div>

    <Separator />

    <!-- Sources list -->
    <div class="space-y-4">
      <h3 class="text-lg font-medium">Search Sources</h3>

      <EmptyState
        v-if="sources.length === 0 && !isLoadingSources"
        :icon="Search"
        title="No search sources configured"
        description="Add search sources to start finding literature for your review."
      >
        <template #action>
          <Button disabled>
            <Plus class="h-4 w-4 mr-2" />
            Add Source
          </Button>
        </template>
      </EmptyState>

      <div v-else class="grid gap-4">
        <Card v-for="source in sources" :key="source.filename">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardTitle class="text-base flex items-center gap-2">
                {{ source.endpoint.split('.').pop() }}
                <Badge variant="secondary">{{ source.search_type }}</Badge>
              </CardTitle>
              <Button variant="ghost" size="icon" disabled>
                <ExternalLink class="h-4 w-4" />
              </Button>
            </div>
            <CardDescription class="font-mono text-xs">
              {{ source.filename }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="text-sm text-muted-foreground">
              <pre class="text-xs overflow-auto">{{ JSON.stringify(source.search_parameters, null, 2) }}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
