<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import {
  Play,
  Loader2,
  Check,
  ArrowRight,
  Eye,
  Database,
  AlertTriangle,
  FileDown,
  Sparkles,
  GitMerge,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useProjectsStore } from '@/stores/projects';
import { computePreprocessingStages } from '@/lib/stepStatus';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';
import PreprocessingResultsModal from '@/components/preprocessing/PreprocessingResultsModal.vue';
import StepPageShell from '@/components/layout/StepPageShell.vue';
import PreprocessingPageHelp from './PreprocessingPageHelp.vue';
import type { SearchSource } from '@/types';
import { useProjectDataChanged } from '@/composables/useProjectDataChanged';
import { formatSourceName } from '@/lib/displayNames';
import { formatCount, countTextSizeClass } from '@/lib/utils';

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const { isReadOnly } = useReadOnly();

// Stage definitions
type StageId = 'load' | 'prep' | 'dedupe';
interface Stage {
  id: StageId;
  label: string;
  shortLabel: string;
  summary: string;
  description: string;
  icon: typeof FileDown;
}

const stageDefinitions: Stage[] = [
  {
    id: 'load',
    label: 'Loading',
    shortLabel: 'Load',
    summary: 'Import search results',
    description: 'Convert raw search result files into a unified record format.',
    icon: FileDown,
  },
  {
    id: 'prep',
    label: 'Preparing',
    shortLabel: 'Prep',
    summary: 'Clean metadata',
    description: 'Standardize fields and fix formatting so records are comparable.',
    icon: Sparkles,
  },
  {
    id: 'dedupe',
    label: 'Deduplicating',
    shortLabel: 'Dedupe',
    summary: 'Merge duplicates',
    description: 'Detect and merge records that appear across multiple sources.',
    icon: GitMerge,
  },
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
  return formatSourceName(source.endpoint || source.platform);
}

// Compute stage status based on record counts
const stageStatus = computed(() =>
  computePreprocessingStages(projects.payloadSteps, projects.currentStatus?.total_records ?? 0),
);

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

// Records needing manual attention
const needsAttentionCount = computed(() => {
  return projects.currentStatus?.currently?.md_needs_manual_preparation ?? 0;
});

// Check if we can run preprocessing
const canRunPreprocessing = computed(() => {
  // Can run if there are records to process at any stage
  const opLoad = projects.operationInfo.load;
  const opPrep = projects.operationInfo.prep;
  const opDedupe = projects.operationInfo.dedupe;
  return opLoad?.runnable || opPrep?.runnable || opDedupe?.runnable;
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
    const response = await backend.call('get_sources', {
      project_id: projects.currentProjectId,
    });
    if (response.success && response.sources) {
      sources.value = response.sources as unknown as SearchSource[];
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
  backend.resetOperationProgress();
  await nextTick();

  try {
    const params: Record<string, unknown> = {
      project_id: projects.currentProjectId,
    };

    // Use minimal prep (no external API calls) for fast processing
    // Records from RIS imports already have abstracts - no enrichment needed
    if (stageId === 'prep') {
      params.use_minimal_prep = true;
    }

    await backend.callUntyped(stageId, params);
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
    // Run each stage in sequence — no gaps between stages.
    // Backend operations handle empty cases gracefully (no-op if nothing to process).
    for (const stage of stageDefinitions) {
      const success = await runStage(stage.id);
      if (!success) break;
    }

    notifications.success('Preprocessing completed');
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    notifications.error('Preprocessing failed', error.message);
  } finally {
    isRunning.value = false;
    currentStage.value = null;
    backend.resetOperationProgress();
    // Counts and operation info refresh via the invalidation seam; the
    // page-owned source list reloads here.
    loadSources();
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
    // Check completedStages FIRST so a finished stage immediately shows 'complete'
    // even while currentStage still points to it (before the next stage starts)
    if (completedStages.value.has(stageId)) {
      statuses[stageId] = 'complete';
    } else if (currentStage.value === stageId && isRunning.value) {
      statuses[stageId] = 'running';
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

// Progress percentage for the currently running stage (from backend log parsing)
const currentStageProgress = computed((): number | null => {
  if (!isRunning.value || !currentStage.value) return null;
  return backend.operationProgress;
});

// Helper for template (reads from computed)
function getStageVisualStatus(stageId: StageId): 'pending' | 'running' | 'complete' {
  return stageVisualStatuses.value[stageId];
}

// A pull / reset / merge replaced the working tree: search sources may have
// changed under us.
useProjectDataChanged(async (event) => {
  if (!event.full) return;
  await loadSources();
});

onMounted(() => {
  loadSources();
});

// Refresh status when results modal closes (records may have been edited)
// Record edits inside the results modal go through writer RPCs — the
// invalidation seam refreshes status when they land.

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
  <StepPageShell
    step="preprocessing"
    subtitle="Turn raw search results into a clean, deduplicated dataset"
    :page-help="PreprocessingPageHelp"
  >
  <div class="p-6 max-w-6xl mx-auto space-y-6" data-testid="preprocessing-page">
    <div class="flex items-center justify-end">
      <Button
        v-if="visibleSources.length > 0"
        :disabled="!canRunPreprocessing || isRunning || isReadOnly"
        data-testid="preprocessing-run-all-button"
        @click="runAllStages"
      >
        <Loader2 v-if="isRunning" class="h-4 w-4 mr-1.5 animate-spin" />
        <Play v-else class="h-4 w-4 mr-1.5" />
        {{ isRunning ? 'Running...' : isPreprocessingComplete ? 'Run again' : 'Run preprocessing' }}
      </Button>
    </div>

    <Separator />

    <!-- No sources: prompt -->
    <div
      v-if="visibleSources.length === 0 && !isLoadingSources"
      class="flex flex-col items-center justify-center py-16 rounded-lg border border-dashed border-border bg-muted/20 text-center"
    >
      <Database class="h-10 w-10 text-muted-foreground mb-3" />
      <h3 class="text-base font-medium mb-1">No search sources yet</h3>
      <p class="text-sm text-muted-foreground max-w-sm">
        Add at least one search source before preprocessing can run. Head back to the
        Search step to add one.
      </p>
    </div>

    <template v-else>
      <!-- Pipeline: sources → stages → output.
           The diagram is a container: it reads as a left-to-right pipeline when
           there is room for one, and stacks top-to-bottom when there is not.
           Every column can shrink (min-w-0) so long source names and large
           counts clip or wrap instead of pushing their card open. -->
      <div
        class="@container rounded-lg border border-border bg-muted/10 p-4 @2xl:p-6"
        data-testid="preprocessing-flow-diagram"
      >
        <div
          class="flex flex-col gap-4 @3xl:grid @3xl:grid-cols-[minmax(0,0.75fr)_auto_minmax(0,2fr)_auto_minmax(0,0.75fr)] @3xl:items-stretch"
        >
          <!-- Sources column -->
          <div class="flex flex-col gap-2 min-w-0">
            <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground px-1">
              Sources
            </div>
            <div
              v-for="source in visibleSources"
              :key="source.filename || source.search_results_path"
              class="flex items-center gap-2 p-2.5 bg-background rounded-md border border-border min-w-0"
              :data-testid="`preprocessing-source-${getSourceDisplayName(source).toLowerCase()}`"
            >
              <Database class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div class="flex flex-col min-w-0 flex-1">
                <span class="text-xs font-medium truncate" :title="getSourceDisplayName(source)">
                  {{ getSourceDisplayName(source) }}
                </span>
                <span class="text-[11px] text-muted-foreground tabular-nums truncate">
                  {{ formatCount(source.record_count ?? 0) }} records
                </span>
              </div>
            </div>
            <div
              class="mt-1 pt-2 border-t border-border/60 text-xs text-muted-foreground px-1 flex items-baseline justify-between gap-2"
            >
              <span class="shrink-0">Total</span>
              <span class="font-medium text-foreground tabular-nums truncate">
                {{ formatCount(totalSourceRecords) }}
              </span>
            </div>
          </div>

          <!-- Arrow (points down while the pipeline is stacked) -->
          <div class="flex items-center justify-center shrink-0 @3xl:pt-6">
            <ArrowRight class="h-5 w-5 text-muted-foreground rotate-90 @3xl:rotate-0" />
          </div>

          <!-- Stages. Its own container: three across when the column is wide
               enough for the stage labels, stacked when it is not. -->
          <div class="@container flex flex-col min-w-0" data-testid="preprocessing-progress">
            <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground px-1 mb-2">
              Stages
            </div>
            <!-- Three across only when a stage card can hold its full label;
                 below that the stages stack rather than shrink into ellipses. -->
            <div class="grid grid-cols-1 @lg:grid-cols-3 gap-3 flex-1">
              <div
                v-for="(stage, index) in stageDefinitions"
                :key="stage.id"
                class="relative flex flex-col min-w-0 p-3 rounded-md border transition-all duration-300"
                :class="{
                  'border-primary/60 bg-primary/5 shadow-sm': getStageVisualStatus(stage.id) === 'running',
                  'border-emerald-500/40 bg-emerald-500/5': getStageVisualStatus(stage.id) === 'complete',
                  'border-border bg-background': getStageVisualStatus(stage.id) === 'pending',
                }"
                :data-testid="`preprocessing-step-${stage.id}`"
                :data-status="getStageVisualStatus(stage.id)"
              >
                <!-- Header wraps before it overflows: the percentage drops to
                     its own line rather than pushing past the card edge. -->
                <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span
                      class="flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-semibold shrink-0"
                      :class="{
                        'bg-primary text-primary-foreground': getStageVisualStatus(stage.id) === 'running',
                        'bg-emerald-500 text-white': getStageVisualStatus(stage.id) === 'complete',
                        'bg-muted text-muted-foreground': getStageVisualStatus(stage.id) === 'pending',
                      }"
                    >
                      <Loader2
                        v-if="getStageVisualStatus(stage.id) === 'running'"
                        class="h-3 w-3 animate-spin"
                      />
                      <Check
                        v-else-if="getStageVisualStatus(stage.id) === 'complete'"
                        class="h-3 w-3"
                      />
                      <template v-else>{{ index + 1 }}</template>
                    </span>
                    <component :is="stage.icon" class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span class="text-sm font-medium truncate" :title="stage.label">{{ stage.label }}</span>
                  </div>
                  <span
                    v-if="getStageVisualStatus(stage.id) === 'running' && currentStageProgress !== null"
                    class="text-xs font-medium tabular-nums text-primary shrink-0"
                  >{{ currentStageProgress }}%</span>
                </div>
                <p class="text-xs text-muted-foreground leading-snug mb-2 break-words">
                  {{ stage.description }}
                </p>
                <!-- Progress bar (running only) -->
                <div
                  v-if="getStageVisualStatus(stage.id) === 'running'"
                  class="mt-auto h-1 rounded-full bg-muted overflow-hidden"
                >
                  <div
                    v-if="currentStageProgress !== null"
                    class="h-full bg-primary transition-all duration-300"
                    :style="{ width: `${currentStageProgress}%` }"
                  />
                  <div v-else class="h-full w-1/3 bg-primary animate-pulse" />
                </div>
              </div>
            </div>
          </div>

          <!-- Arrow (points down while the pipeline is stacked) -->
          <div class="flex items-center justify-center shrink-0 @3xl:pt-6">
            <ArrowRight class="h-5 w-5 text-muted-foreground rotate-90 @3xl:rotate-0" />
          </div>

          <!-- Output column -->
          <div class="flex flex-col min-w-0">
            <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground px-1 mb-2">
              Output
            </div>
            <div
              class="flex-1 flex flex-col items-center justify-center min-w-0 p-4 rounded-md border text-center transition-all duration-300"
              :class="isPreprocessingComplete
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-background border-border'"
            >
              <template v-if="isPreprocessingComplete">
                <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Dataset
                </span>
                <!-- The headline number steps down a size as it gains digits,
                     so a six- or seven-figure dataset still fits the column. -->
                <span
                  class="font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1 max-w-full leading-tight"
                  :class="countTextSizeClass(finalRecordCount)"
                >
                  {{ formatCount(finalRecordCount) }}
                </span>
                <span class="text-xs text-muted-foreground">records</span>
                <Badge
                  v-if="duplicatesRemoved > 0"
                  variant="secondary"
                  class="mt-2 text-[11px] max-w-full"
                  :title="`${formatCount(duplicatesRemoved)} duplicates removed`"
                >
                  −{{ formatCount(duplicatesRemoved) }} duplicate{{ duplicatesRemoved === 1 ? '' : 's' }}
                </Badge>
              </template>
              <template v-else>
                <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Pending
                </span>
                <span class="text-sm text-muted-foreground mt-2 text-center text-balance">
                  Run preprocessing to generate the dataset
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Post-run summary: attention -->
      <div v-if="isPreprocessingComplete">
        <div
          class="flex flex-wrap items-start gap-3 p-4 rounded-lg border"
          :class="needsAttentionCount > 0
            ? 'bg-amber-500/5 border-amber-500/30'
            : 'bg-muted/20 border-border'"
        >
          <div
            class="h-9 w-9 rounded-md flex items-center justify-center shrink-0"
            :class="needsAttentionCount > 0
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-muted text-muted-foreground'"
          >
            <AlertTriangle v-if="needsAttentionCount > 0" class="h-4 w-4" data-testid="attention-indicator" />
            <Check v-else class="h-4 w-4" />
          </div>
          <div class="flex-1 min-w-0 basis-64">
            <div class="text-sm font-medium text-pretty">
              <template v-if="needsAttentionCount > 0">
                {{ formatCount(needsAttentionCount) }} record{{ needsAttentionCount === 1 ? '' : 's' }} need{{ needsAttentionCount === 1 ? 's' : '' }} attention
              </template>
              <template v-else>
                All records processed cleanly
              </template>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">
              <template v-if="needsAttentionCount > 0">
                Some records couldn't be prepared automatically. Review and fix missing fields.
              </template>
              <template v-else>
                Inspect the dataset to double-check merges and metadata before screening.
              </template>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0 ml-auto"
            data-testid="view-results-button"
            @click="showResultsModal = true"
          >
            <Eye class="h-4 w-4 mr-1.5" />
            View
          </Button>
        </div>
      </div>
    </template>

    <!-- Results Modal -->
    <PreprocessingResultsModal
      v-model:open="showResultsModal"
      :project-id="projects.currentProjectId || ''"
    />
  </div>
  </StepPageShell>
</template>
