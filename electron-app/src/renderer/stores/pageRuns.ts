import { defineStore } from 'pinia';
import { ref } from 'vue';

export type PreprocessingStageId = 'load' | 'prep' | 'dedupe';

/**
 * Run state of the Search and Preprocessing pages.
 *
 * The loops that run searches and preprocessing stages are started from a page
 * but keep going after the user navigates away. Their state lives here, not in
 * the page, so that a freshly mounted page shows the run that is still going
 * on and keeps its Run buttons disabled until it ends.
 */
export const usePageRunsStore = defineStore('pageRuns', () => {
  // Search page: one source at a time, the rest of a batch waits in the queue.
  const searchingSource = ref<string | null>(null);
  const queuedSources = ref<string[]>([]);
  const isRunningAllSearches = ref(false);

  // Preprocessing page: load → prep → dedupe.
  const isPreprocessing = ref(false);
  const currentStage = ref<PreprocessingStageId | null>(null);
  const completedStages = ref<PreprocessingStageId[]>([]);

  return {
    searchingSource,
    queuedSources,
    isRunningAllSearches,
    isPreprocessing,
    currentStage,
    completedStages,
  };
});
