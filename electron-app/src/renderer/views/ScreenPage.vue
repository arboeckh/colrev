<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { CheckSquare, FileDown, AlertCircle, RefreshCw, GitBranch } from 'lucide-vue-next';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  PdfViewerPanel,
  ScreenSplitPanel,
  ScreenRecordPanel,
  ScreenEditMode,
  ScreenComplete,
  CriteriaManagementDialog,
} from '@/components/screen';
import { useProjectsStore } from '@/stores/projects';
import { useAuthStore } from '@/stores/auth';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useReadOnly } from '@/composables/useReadOnly';
import type {
  GetCurrentManagedReviewTaskResponse,
  GetScreenQueueResponse,
  ListManagedReviewTasksResponse,
  ManagedReviewTask,
  ScreenQueueRecord,
  ScreenRecordResponse,
  ScreenCriterionDefinition,
} from '@/types/api';

type DecisionState = 'undecided' | 'included' | 'excluded';
type ScreenMode = 'screening' | 'edit' | 'complete';

interface ScreenEnrichedRecord extends ScreenQueueRecord {
  _decision: DecisionState;
  _criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'>;
}

const props = withDefaults(defineProps<{
  embedded?: boolean;
}>(), {
  embedded: false,
});

const auth = useAuthStore();
const projects = useProjectsStore();
const backend = useBackendStore();
const git = useGitStore();
const notifications = useNotificationsStore();
const reviewDefStore = useReviewDefinitionStore();
const { isReadOnly } = useReadOnly();

const queue = ref<ScreenEnrichedRecord[]>([]);
const decisionHistory = ref<ScreenEnrichedRecord[]>([]);
const criteria = ref<Record<string, ScreenCriterionDefinition>>({});
const totalCount = ref(0);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const currentIndex = ref(0);
const isDeciding = ref(false);
const mode = ref<ScreenMode>('screening');
const showCriteriaDialog = ref(false);
const managedTask = ref<GetCurrentManagedReviewTaskResponse['task']>(null);
const accessState = ref<'loading' | 'switching' | 'ready' | 'blocked'>('loading');
const activeManagedTask = ref<ManagedReviewTask | null>(null);
const assignedReviewerBranch = ref<string | null>(null);

const statusCounts = computed(() => projects.currentStatus?.currently ?? null);
const pdfPreparedCount = computed(() => statusCounts.value?.pdf_prepared ?? 0);
const currentRecord = computed(() => queue.value[currentIndex.value] || null);
const hasCriteria = computed(() => Object.keys(criteria.value).length > 0);
const decidedCount = computed(() => queue.value.filter((r) => r._decision !== 'undecided').length);
const includedCount = computed(() => queue.value.filter((r) => r._decision === 'included').length);
const excludedCount = computed(() => queue.value.filter((r) => r._decision === 'excluded').length);
const isCurrentDecided = computed(() => currentRecord.value?._decision !== 'undecided');
const nextUndecidedIndex = computed(() => {
  for (let i = currentIndex.value + 1; i < queue.value.length; i++) {
    if (queue.value[i]._decision === 'undecided') return i;
  }
  return -1;
});
const derivedDecision = computed((): 'include' | 'exclude' | null => {
  if (!currentRecord.value || !hasCriteria.value) return null;
  const decisions = currentRecord.value._criteriaDecisions;
  if (Object.values(decisions).some((value) => value === 'out')) return 'exclude';
  const inclusionNames = Object.keys(criteria.value).filter(
    (name) => criteria.value[name]?.criterion_type !== 'exclusion_criterion',
  );
  if (inclusionNames.length > 0 && inclusionNames.every((name) => decisions[name] === 'in')) {
    return 'include';
  }
  return null;
});
const canSubmitCriteria = computed(() => derivedDecision.value !== null);
const isScreenComplete = computed(() => {
  if (!statusCounts.value) return false;
  const { rev_included, rev_excluded, pdf_prepared } = statusCounts.value;
  return pdf_prepared === 0 && (rev_included > 0 || rev_excluded > 0);
});
const assignedReviewer = computed(() => {
  if (!activeManagedTask.value || !auth.user?.login) return null;
  const login = auth.user.login.toLowerCase();
  return activeManagedTask.value.reviewers.find(
    (reviewer) => reviewer.github_login.toLowerCase() === login,
  ) ?? null;
});
const isManagedAccessBlocked = computed(() => accessState.value === 'blocked');
const managedAccessTitle = computed(() => {
  if (!activeManagedTask.value) return 'Screening is unavailable';
  if (assignedReviewer.value) return 'Switching to your screening branch failed';
  return 'Managed screen is active';
});
const managedAccessDescription = computed(() => {
  if (!activeManagedTask.value) {
    return 'No managed screening branch is available for the current session.';
  }
  if (assignedReviewer.value) {
    return `This task is assigned to you on ${assignedReviewer.value.branch_name}. Full-text screening happens only on reviewer branches, not on dev.`;
  }
  return `Task ${activeManagedTask.value.id} is currently assigned to ${activeManagedTask.value.reviewers.map((reviewer) => reviewer.github_login).join(' and ')}. Full-text screening decisions should only be made from reviewer branches.`;
});

async function loadManagedTask() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  try {
    const response = await backend.call<GetCurrentManagedReviewTaskResponse>('get_current_managed_review_task', {
      project_id: projects.currentProjectId,
      kind: 'screen',
    });
    managedTask.value = response.task;
  } catch {
    managedTask.value = null;
  }
}

async function ensureManagedTaskAccess(): Promise<boolean> {
  if (!projects.currentProjectId || !backend.isRunning) return false;

  accessState.value = 'loading';
  activeManagedTask.value = null;
  assignedReviewerBranch.value = null;

  await loadManagedTask();
  if (managedTask.value) {
    activeManagedTask.value = managedTask.value;
    accessState.value = 'ready';
    return true;
  }

  let tasksResponse: ListManagedReviewTasksResponse;
  try {
    tasksResponse = await backend.call<ListManagedReviewTasksResponse>('list_managed_review_tasks', {
      project_id: projects.currentProjectId,
      kind: 'screen',
    });
  } catch {
    accessState.value = 'ready';
    return true;
  }

  const activeTask = tasksResponse.tasks.find((task) => ['active', 'reconciling'].includes(task.state)) ?? null;
  activeManagedTask.value = activeTask;
  if (!activeTask) {
    accessState.value = 'ready';
    return true;
  }

  const login = auth.user?.login?.toLowerCase();
  const assignedReviewerEntry = login
    ? activeTask.reviewers.find((reviewer) => reviewer.github_login.toLowerCase() === login) ?? null
    : null;

  if (!assignedReviewerEntry) {
    accessState.value = 'blocked';
    return false;
  }

  assignedReviewerBranch.value = assignedReviewerEntry.branch_name;
  if (git.currentBranch !== assignedReviewerEntry.branch_name) {
    accessState.value = 'switching';
    // Fetch remote refs first so the reviewer branch is available locally
    if (git.hasRemote) {
      await git.fetch();
    }
    const switched = await git.switchBranch(assignedReviewerEntry.branch_name);
    if (!switched) {
      accessState.value = 'blocked';
      return false;
    }
  }

  await loadManagedTask();
  activeManagedTask.value = managedTask.value ?? activeTask;
  accessState.value = managedTask.value ? 'ready' : 'blocked';
  return managedTask.value !== null;
}

async function loadQueue() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  isLoading.value = true;
  loadError.value = null;
  try {
    const response = await backend.call<GetScreenQueueResponse>('get_screen_queue', {
      project_id: projects.currentProjectId,
      limit: 50,
      task_id: managedTask.value?.id,
    });
    if (response.success) {
      criteria.value = response.criteria || {};
      const criteriaNames = Object.keys(criteria.value);
      const newRecords: ScreenEnrichedRecord[] = response.records.map((record) => {
        const criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'> = {};
        for (const name of criteriaNames) {
          criteriaDecisions[name] = record.current_criteria?.[name] as 'in' | 'out' || 'TODO';
        }
        return {
          ...record,
          _decision: 'undecided' as DecisionState,
          _criteriaDecisions: criteriaDecisions,
        };
      });
      const history = decisionHistory.value;
      queue.value = [...history, ...newRecords];
      totalCount.value = response.total_count;
      currentIndex.value = history.length;
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    isLoading.value = false;
  }
}

async function makeDecision(decision: 'include' | 'exclude') {
  if (!currentRecord.value || !projects.currentProjectId || isDeciding.value) return;
  if (isCurrentDecided.value) return;

  isDeciding.value = true;
  try {
    const criteriaDecisions: Record<string, 'in' | 'out'> = {};
    if (hasCriteria.value) {
      for (const [name, value] of Object.entries(currentRecord.value._criteriaDecisions)) {
        if (value !== 'TODO') criteriaDecisions[name] = value;
      }
    }

    const response = await backend.call<ScreenRecordResponse>('screen_record', {
      project_id: projects.currentProjectId,
      record_id: currentRecord.value.id,
      decision,
      criteria_decisions: Object.keys(criteriaDecisions).length > 0 ? criteriaDecisions : undefined,
      task_id: managedTask.value?.id,
    });

    if (response.success) {
      currentRecord.value._decision = decision === 'include' ? 'included' : 'excluded';
      totalCount.value = response.remaining_count;
      decisionHistory.value.push({ ...currentRecord.value });
      if (nextUndecidedIndex.value !== -1) {
        currentIndex.value = nextUndecidedIndex.value;
      } else if (response.remaining_count > 0) {
        await loadQueue();
      } else {
        queue.value = [];
        await projects.refreshCurrentProject();
      }
    }
  } catch (err) {
    notifications.error('Decision failed', err instanceof Error ? err.message : 'Unknown error');
  } finally {
    isDeciding.value = false;
  }
}

function submitCriteriaDecision() {
  if (!canSubmitCriteria.value || !derivedDecision.value) return;
  makeDecision(derivedDecision.value);
}

function toggleCriterion(name: string, value: 'in' | 'out' | 'TODO') {
  if (!currentRecord.value) return;
  currentRecord.value._criteriaDecisions[name] = value;
}

function goToRecord(index: number) {
  if (index >= 0 && index < queue.value.length) currentIndex.value = index;
}

function skipToNextUndecided() {
  if (nextUndecidedIndex.value !== -1) currentIndex.value = nextUndecidedIndex.value;
}

function enterEditMode() {
  mode.value = 'edit';
}

function exitEditMode() {
  mode.value = isScreenComplete.value ? 'complete' : 'screening';
}

async function handleCriteriaChanged() {
  await loadQueue();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (mode.value !== 'screening') return;

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (currentIndex.value > 0) currentIndex.value -= 1;
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (currentIndex.value < queue.value.length - 1) currentIndex.value += 1;
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (!hasCriteria.value && !isCurrentDecided.value && currentRecord.value) makeDecision('exclude');
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (!hasCriteria.value && !isCurrentDecided.value && currentRecord.value) makeDecision('include');
      break;
  }
}

onMounted(async () => {
  if (!props.embedded) {
    await projects.refreshCurrentProject();
    await git.refreshStatus();
  }
  await reviewDefStore.loadDefinition();
  const canLoadQueue = await ensureManagedTaskAccess();
  if (canLoadQueue) {
    await loadQueue();
  } else {
    queue.value = [];
    totalCount.value = 0;
  }
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

</script>

<template>
  <div class="h-full flex flex-col" data-testid="screen-page">
    <div
      v-if="accessState === 'switching'"
      class="mx-6 mt-6 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
    >
      <div class="font-medium">Opening your assigned screening branch</div>
      <div class="text-muted-foreground">
        Full-text screening happens on reviewer branches. The app is switching you behind the scenes.
      </div>
    </div>
    <div v-if="managedTask" class="mx-6 mt-6 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
      <div class="flex items-center gap-2 font-medium">
        <GitBranch class="h-4 w-4" />
        Managed screen task
      </div>
      <div class="text-muted-foreground">
        Working on <code>{{ managedTask.id }}</code>. This queue only includes records assigned to the current reviewer branch.
      </div>
    </div>
    <EmptyState
      v-if="isManagedAccessBlocked"
      :icon="CheckSquare"
      :title="managedAccessTitle"
      :description="managedAccessDescription"
    />
    <template v-else>

    <div v-if="mode === 'edit'" class="px-4 py-3">
      <ScreenEditMode @close="exitEditMode" />
    </div>

    <ScreenComplete
      v-else-if="mode === 'complete' || (!isLoading && queue.length === 0 && isScreenComplete)"
      class="px-4 py-3"
      :included-count="statusCounts?.rev_included ?? 0"
      :excluded-count="statusCounts?.rev_excluded ?? 0"
      :read-only="isReadOnly"
      @edit-decisions="enterEditMode"
    />

    <div
      v-else-if="!isLoading && loadError"
      class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8"
    >
      <AlertCircle class="h-10 w-10 text-destructive" />
      <div>
        <h3 class="text-lg font-medium">Failed to load screening queue</h3>
        <p class="text-sm text-muted-foreground mt-1">{{ loadError }}</p>
      </div>
      <Button variant="outline" @click="loadQueue">
        <RefreshCw class="h-4 w-4 mr-2" />
        Retry
      </Button>
    </div>

    <div
      v-else-if="!isLoading && queue.length === 0 && !isScreenComplete && pdfPreparedCount === 0"
      class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8"
    >
      <FileDown class="h-10 w-10 text-muted-foreground" />
      <div>
        <h3 class="text-lg font-medium">No PDFs ready to screen</h3>
        <p class="text-sm text-muted-foreground mt-1">
          Finish PDF retrieval and preparation, then use Screen Launch to create paired reviewer branches.
        </p>
      </div>
    </div>

    <div v-else-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <EmptyState
      v-else-if="!isLoading && queue.length === 0"
      :icon="CheckSquare"
      title="No records to screen"
      description="There are no full-text records ready for the current screening queue."
    />

    <ScreenSplitPanel
      v-else-if="currentRecord"
      class="flex-1 min-h-0"
      data-testid="screen-record-card"
    >
      <template #left>
        <PdfViewerPanel :pdf-path="currentRecord.pdf_path" />
      </template>
      <template #right>
        <ScreenRecordPanel
          :key="currentRecord.id"
          :record="currentRecord"
          :criteria="criteria"
          :criteria-decisions="currentRecord._criteriaDecisions"
          :has-criteria="hasCriteria"
          :decided-count="decidedCount"
          :included-count="includedCount"
          :excluded-count="excludedCount"
          :total-count="totalCount"
          :is-deciding="isDeciding"
          :is-current-decided="isCurrentDecided"
          :derived-decision="derivedDecision"
          :can-submit-criteria="canSubmitCriteria"
          :next-undecided-index="nextUndecidedIndex"
          :mode="mode"
          :queue-records="queue"
          :current-index="currentIndex"
          :read-only="isReadOnly"
          @toggle-criterion="toggleCriterion"
          @make-decision="makeDecision"
          @submit-criteria-decision="submitCriteriaDecision"
          @skip-to-next-undecided="skipToNextUndecided"
          @enter-edit-mode="enterEditMode"
          @show-criteria-dialog="showCriteriaDialog = true"
          @navigate="goToRecord"
        />
      </template>
    </ScreenSplitPanel>

    <CriteriaManagementDialog
      v-model:open="showCriteriaDialog"
      @criteria-changed="handleCriteriaChanged"
    />
    </template>
  </div>
</template>
