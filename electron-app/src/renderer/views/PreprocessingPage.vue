<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { Play, Loader2, Layers, Check, ArrowRight, Eye, Info, Database } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import PreprocessingResultsModal from '@/components/preprocessing/PreprocessingResultsModal.vue';
import type { GetSourcesResponse, SearchSource } from '@/types';

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();

// Stage definitions
type StageId = 'load' | 'prep' | 'dedupe';
interface Stage {
  id: StageId;
  label: string;
  shortLabel: string;
  description: string;
}

const stageDefinitions: Stage[] = [
  { id: 'load', label: 'Loading', shortLabel: 'Load', description: 'Import records from search result files into a unified dataset format.' },
  { id: 'prep', label: 'Preparing', shortLabel: 'Prep', description: 'Clean and standardize metadata — fix formatting, resolve inconsistencies, and enrich records.' },
  { id: 'dedupe', label: 'Deduplicating', shortLabel: 'Dedupe', description: 'Identify and merge duplicate records that appear across multiple sources.' },
];

// State
const isRunning = ref(false);
const currentStage = ref<StageId | null>(null);
const completedStages = ref<Set<StageId>>(new Set());
const sources = ref<SearchSource[]>([]);
const isLoadingSources = ref(false);
const showResultsModal = ref(false);

// Filter out FILES type sources (like files_dir)
const visibleSources = computed(() => {
  return sources.value.filter((source) => {
    if (source.search_type === 'FILES') return false;
    return true;
  });
});

// Get source display name (same logic as SourceCard)
function getSourceDisplayName(source: SearchSource): string {
  if (source.search_type === 'DB') {
    const path = source.filename || source.search_results_path || '';
    const basename = path.split('/').pop() || '';
    return basename.replace(/\.[^/.]+$/, '') || 'unknown';
  }
  const endpoint = source.endpoint || source.platform || 'unknown';
  const name = endpoint.split('.').pop() || endpoint;
  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Compute stage status based on record counts
const stageStatus = computed(() => {
  const status = projects.currentStatus;
  if (!status?.currently) {
    return { loadCompleted: false, prepCompleted: false, dedupeCompleted: false };
  }

  const currently = status.currently;

  // Load is completed when no records are in md_retrieved state
  const loadCompleted = currently.md_retrieved === 0 && status.total_records > 0;

  // Prep is completed when no records are in md_imported or md_needs_manual_preparation
  const prepCompleted =
    loadCompleted &&
    currently.md_imported === 0 &&
    currently.md_needs_manual_preparation === 0;

  // Dedupe is completed when no records are in md_prepared (all moved to md_processed)
  const dedupeCompleted = prepCompleted && currently.md_prepared === 0;

  return { loadCompleted, prepCompleted, dedupeCompleted };
});

// Total records from sources (before processing)
const totalSourceRecords = computed(() => {
  return visibleSources.value.reduce((sum, s) => sum + (s.record_count ?? 0), 0);
});

// Final record count (total in dataset after all processing)
const finalRecordCount = computed(() => {
  const status = projects.currentStatus;
  if (!status) return 0;
  return status.total_records ?? 0;
});

// Duplicates removed
const duplicatesRemoved = computed(() => {
  return projects.currentStatus?.duplicates_removed ?? 0;
});

// Check if we can run preprocessing
const canRunPreprocessing = computed(() => {
  // Can run if there are records to process at any stage
  const opLoad = projects.operationInfo.load;
  const opPrep = projects.operationInfo.prep;
  const opDedupe = projects.operationInfo.dedupe;
  return opLoad?.can_run || opPrep?.can_run || opDedupe?.can_run;
});

// Check if preprocessing is complete
const isPreprocessingComplete = computed(() => {
  return stageStatus.value.dedupeCompleted && finalRecordCount.value > 0;
});

// Load sources (keeps old values until new ones arrive to prevent flicker)
async function loadSources() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoadingSources.value = true;
  try {
    const response = await backend.call<GetSourcesResponse>('get_sources', {
      project_id: projects.currentProjectId,
    });
    if (response.success && response.sources) {
      sources.value = response.sources;
    }
  } catch (err) {
    console.error('Failed to load sources:', err);
    // Keep existing sources on error - don't clear
  } finally {
    isLoadingSources.value = false;
  }
}

// Run a single stage
async function runStage(stageId: StageId): Promise<boolean> {
  if (!projects.currentProjectId) return false;

  currentStage.value = stageId;

  try {
    const params: Record<string, unknown> = {
      project_id: projects.currentProjectId,
    };

    // Use minimal prep (no external API calls) for fast processing
    // Records from RIS imports already have abstracts - no enrichment needed
    if (stageId === 'prep') {
      params.use_minimal_prep = true;
    }

    await backend.call(stageId, params);
    completedStages.value.add(stageId);
    return true;
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    notifications.error(`${stageId} failed`, error.message);
    return false;
  }
}

// Run all stages sequentially
async function runAllStages() {
  if (isRunning.value || !projects.currentProjectId) return;

  isRunning.value = true;
  completedStages.value.clear();

  try {
    // Refresh operation info before starting
    await projects.loadAllOperationInfo(projects.currentProjectId);

    // Run each stage in sequence if it can run
    for (const stage of stageDefinitions) {
      const opInfo = projects.operationInfo[stage.id];
      if (opInfo?.can_run) {
        const success = await runStage(stage.id);
        if (!success) break;
        // Refresh after each stage to get updated counts
        await projects.refreshCurrentProject();
        await loadSources();
      }
    }

    notifications.success('Preprocessing completed');
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    notifications.error('Preprocessing failed', error.message);
  } finally {
    isRunning.value = false;
    currentStage.value = null;
  }
}

// Computed stage visual statuses (avoids function calls in template)
const stageVisualStatuses = computed(() => {
  const statuses: Record<StageId, 'pending' | 'running' | 'complete'> = {
    load: 'pending',
    prep: 'pending',
    dedupe: 'pending',
  };

  for (const stageId of ['load', 'prep', 'dedupe'] as StageId[]) {
    // During running, prioritize local state to avoid flicker
    if (currentStage.value === stageId && isRunning.value) {
      statuses[stageId] = 'running';
    } else if (completedStages.value.has(stageId)) {
      statuses[stageId] = 'complete';
    } else if (!isRunning.value) {
      // Only check project status when NOT running (avoids mid-refresh flicker)
      if (stageId === 'load' && stageStatus.value.loadCompleted) {
        statuses[stageId] = 'complete';
      } else if (stageId === 'prep' && stageStatus.value.prepCompleted) {
        statuses[stageId] = 'complete';
      } else if (stageId === 'dedupe' && stageStatus.value.dedupeCompleted) {
        statuses[stageId] = 'complete';
      }
    }
  }

  return statuses;
});

// Helper for template (reads from computed)
function getStageVisualStatus(stageId: StageId): 'pending' | 'running' | 'complete' {
  return stageVisualStatuses.value[stageId];
}

onMounted(() => {
  loadSources();
});

watch(
  () => projects.currentProjectId,
  (newId, oldId) => {
    loadSources();
    // Only clear completedStages when switching to a DIFFERENT project
    // Don't clear when refreshing the same project (oldId === newId)
    if (newId !== oldId && oldId !== undefined) {
      completedStages.value.clear();
    }
  }
);
</script>

<template>
  <div class="p-6 space-y-6" data-testid="preprocessing-page">
    <!-- Page header -->
    <div>
      <h2 class="text-2xl font-bold flex items-center gap-2">
        <Layers class="h-6 w-6" />
        Preprocessing
      </h2>
      <p class="text-muted-foreground">
        Load, prepare, and deduplicate records from search sources
      </p>
    </div>

    <Separator />

    <!-- Data Flow Diagram with Run All -->
    <div
      class="flex flex-col w-fit mx-auto rounded-lg border border-border bg-muted/20"
      data-testid="preprocessing-flow-diagram"
    >
      <!-- Run All top bar -->
      <div v-if="visibleSources.length > 0" class="flex justify-end px-4 pt-3">
        <Button
          size="sm"
          :disabled="!canRunPreprocessing || isRunning"
          data-testid="preprocessing-run-all-button"
          @click="runAllStages"
        >
          <Loader2 v-if="isRunning" class="h-4 w-4 mr-1 animate-spin" />
          <Play v-else class="h-4 w-4 mr-1" />
          Run All
        </Button>
      </div>

      <!-- Flow diagram -->
      <div class="flex items-center justify-center gap-4 p-6 pt-3">
          <!-- Source nodes -->
          <div class="flex flex-col gap-2" v-if="visibleSources.length > 0">
            <div
              v-for="source in visibleSources"
              :key="source.filename || source.search_results_path"
              class="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-border min-w-24"
              :data-testid="`preprocessing-source-${getSourceDisplayName(source).toLowerCase()}`"
            >
              <Database class="h-4 w-4 text-muted-foreground shrink-0" />
              <div class="flex flex-col">
                <span class="text-xs font-medium truncate max-w-full">
                  {{ getSourceDisplayName(source) }}
                </span>
                <span class="text-xs text-muted-foreground tabular-nums">
                  {{ source.record_count ?? 0 }} records
                </span>
              </div>
            </div>
          </div>

          <!-- No sources message -->
          <div
            v-else
            class="flex flex-col items-center p-4 bg-muted/30 rounded-lg border border-dashed border-border text-muted-foreground"
          >
            <span class="text-sm">No sources found</span>
            <span class="text-xs">Add sources in the Search step</span>
          </div>

          <!-- Arrow from sources to steps -->
          <ArrowRight v-if="visibleSources.length > 0" class="h-5 w-5 text-muted-foreground shrink-0" />

          <!-- Processing steps -->
          <TooltipProvider v-if="visibleSources.length > 0">
            <div class="flex items-center gap-2" data-testid="preprocessing-progress">
              <template v-for="(stage, index) in stageDefinitions" :key="stage.id">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <div
                      class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-300 cursor-default"
                      :class="{
                        'bg-primary text-primary-foreground': getStageVisualStatus(stage.id) === 'running',
                        'bg-emerald-500 text-white': getStageVisualStatus(stage.id) === 'complete',
                        'bg-muted text-muted-foreground': getStageVisualStatus(stage.id) === 'pending',
                      }"
                      :data-testid="`preprocessing-step-${stage.id}`"
                      :data-status="getStageVisualStatus(stage.id)"
                    >
                      <Loader2
                        v-if="getStageVisualStatus(stage.id) === 'running'"
                        class="h-3.5 w-3.5 animate-spin"
                      />
                      <Check
                        v-else-if="getStageVisualStatus(stage.id) === 'complete'"
                        class="h-3.5 w-3.5"
                      />
                      <span
                        v-else
                        class="h-3.5 w-3.5 flex items-center justify-center text-xs"
                      >{{ index + 1 }}</span>
                      {{ stage.shortLabel }}
                      <Info class="h-3 w-3 opacity-50" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" class="max-w-60">
                    <p>{{ stage.description }}</p>
                  </TooltipContent>
                </Tooltip>

                <ArrowRight
                  v-if="index < stageDefinitions.length - 1"
                  class="h-4 w-4 text-muted-foreground"
                />
              </template>
            </div>
          </TooltipProvider>

          <!-- Arrow from steps to final -->
          <ArrowRight v-if="visibleSources.length > 0" class="h-5 w-5 text-muted-foreground shrink-0" />

          <!-- Final node -->
          <div
            v-if="visibleSources.length > 0"
            class="flex flex-col items-center p-4 rounded-lg border min-w-36 transition-all duration-300"
            :class="isPreprocessingComplete
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-muted/50 border-border'"
          >
            <template v-if="isPreprocessingComplete">
              <span class="text-xs font-medium text-muted-foreground">Final Dataset</span>
              <span class="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {{ finalRecordCount }}
              </span>
              <span class="text-xs text-muted-foreground">records</span>

              <Badge
                v-if="duplicatesRemoved > 0"
                variant="secondary"
                class="mt-2 text-xs"
              >
                -{{ duplicatesRemoved }} duplicates
              </Badge>

              <Button
                variant="outline"
                size="sm"
                class="mt-2"
                data-testid="view-results-button"
                @click="showResultsModal = true"
              >
                <Eye class="h-4 w-4 mr-1" />
                View Results
              </Button>
            </template>

            <template v-else>
              <span class="text-xs font-medium text-muted-foreground">Pending</span>
              <span class="text-sm text-muted-foreground">Run preprocessing</span>
            </template>
          </div>
      </div>
    </div>

    <!-- Results Modal -->
    <PreprocessingResultsModal
      v-model:open="showResultsModal"
      :project-id="projects.currentProjectId || ''"
    />
  </div>
</template>
