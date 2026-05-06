<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useManagedReviewStore } from '@/stores/managedReview';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectsStore } from '@/stores/projects';
import ReconcileWalkthrough from './ReconcileWalkthrough.vue';
import ScreenReconcileWalkthrough from './ScreenReconcileWalkthrough.vue';
import type {
  ApplyReconciliationResponse,
  ExportReconciliationAuditResponse,
  ListManagedReviewTasksResponse,
  ManagedReviewTask,
} from '@/types/api';

const props = defineProps<{
  kind: 'prescreen' | 'screen';
}>();

const backend = useBackendStore();
const git = useGitStore();
const managedReview = useManagedReviewStore();
const notifications = useNotificationsStore();
const projects = useProjectsStore();

const isLoading = ref(false);
const isExporting = ref(false);
const tasks = ref<ManagedReviewTask[]>([]);
const showWalkthrough = ref(false);

const kindLabel = computed(() => (props.kind === 'screen' ? 'Screen' : 'Prescreen'));
const activeTask = computed(
  () =>
    tasks.value.find((task) => ['active', 'reconciling'].includes(task.state)) ?? null,
);
const displayTask = computed(() => activeTask.value ?? tasks.value[0] ?? null);
const isOnDev = computed(() => git.currentBranch === 'dev');
const canStartReconciliation = computed(() => {
  if (!displayTask.value || !isOnDev.value) return false;
  return displayTask.value.state !== 'completed' && displayTask.value.state !== 'aborted';
});

function prettyDate(value?: string | null) {
  if (!value) return 'Not finished';
  return new Date(value).toLocaleString();
}

async function refreshData() {
  if (!projects.currentProjectId || !backend.isRunning) return;
  isLoading.value = true;
  try {
    await git.refreshStatus();
    const tasksResponse = await backend.call<ListManagedReviewTasksResponse>(
      'list_managed_review_tasks',
      {
        project_id: projects.currentProjectId,
        kind: props.kind,
      },
    );
    tasks.value = tasksResponse.tasks;
  } catch (err) {
    notifications.error(
      `${kindLabel.value} reconcile failed`,
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isLoading.value = false;
  }
}

async function switchToDev() {
  const switched = await git.switchBranch('dev');
  if (switched) {
    notifications.success('Switched to dev', 'Reconciliation runs from the dev branch.');
    await refreshData();
  }
}

function startReconciliation() {
  if (!canStartReconciliation.value) return;
  showWalkthrough.value = true;
}

function onWalkthroughClose() {
  showWalkthrough.value = false;
}

async function onWalkthroughApplied(_: ApplyReconciliationResponse) {
  showWalkthrough.value = false;
  await Promise.all([
    refreshData(),
    managedReview.refresh(),
    projects.refreshCurrentProject(),
  ]);
}

async function exportAudit(format: 'csv' | 'json') {
  if (!displayTask.value || !projects.currentProjectId) return;
  isExporting.value = true;
  try {
    const response = await backend.call<ExportReconciliationAuditResponse>(
      'export_reconciliation_audit',
      {
        project_id: projects.currentProjectId,
        task_id: displayTask.value.id,
        format,
      },
    );
    await window.fileOps.saveDialog({
      defaultName: response.filename,
      content: response.content,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
  } catch (err) {
    notifications.error(
      'Export failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isExporting.value = false;
  }
}

onMounted(async () => {
  if (!isOnDev.value) {
    await git.switchBranch('dev');
  }
  await refreshData();
});

defineExpose({ refreshData });
</script>

<template>
  <div class="h-full flex flex-col min-h-0" :class="showWalkthrough ? 'gap-0' : 'gap-6'">
    <div v-if="isLoading && !displayTask" class="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 class="h-4 w-4 animate-spin" />
      Loading task data...
    </div>

    <div v-else-if="!displayTask" class="text-sm text-muted-foreground">
      No {{ kindLabel.toLowerCase() }} task to reconcile. Launch a managed task first,
      then come back once both reviewers have finished.
    </div>

    <template v-else>
      <div v-if="!showWalkthrough" class="space-y-4 max-w-md shrink-0">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-medium">Reconcile {{ kindLabel.toLowerCase() }}</h3>
            <p class="text-xs text-muted-foreground">
              Created by {{ displayTask.created_by }} ·
              {{ prettyDate(displayTask.created_at) }}
            </p>
          </div>
          <Badge
            :variant="displayTask.state === 'completed' ? 'default' : 'secondary'"
            class="text-xs"
          >
            {{ displayTask.state }}
          </Badge>
        </div>

        <div class="border border-border rounded-md overflow-hidden">
          <div
            v-for="(reviewer, index) in displayTask.reviewer_progress"
            :key="reviewer.role"
            class="flex items-center justify-between py-2.5 px-3"
            :class="index > 0 ? 'border-t border-border' : ''"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ reviewer.github_login }}</span>
            </div>
            <span class="text-xs text-muted-foreground tabular-nums">
              {{ reviewer.completed_count }} / {{ displayTask.record_count }}
            </span>
          </div>
        </div>

        <div
          v-if="displayTask.reconciliation_summary"
          class="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
          <span>
            Reconciled by {{ displayTask.reconciliation_summary.resolved_by }} —
            {{ displayTask.reconciliation_summary.auto_resolved_count }} auto,
            {{ displayTask.reconciliation_summary.manual_conflict_count }} manual
          </span>
        </div>
      </div>

      <div
        v-if="!isOnDev && !showWalkthrough"
        class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 shrink-0"
      >
        <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
        <span>Reconciliation must run from the dev branch.</span>
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="switchToDev">
          Switch to dev
        </Button>
      </div>

      <div v-if="!showWalkthrough" class="flex items-center gap-2 shrink-0">
        <Button
          v-if="canStartReconciliation"
          size="sm"
          data-testid="reconcile-start-btn"
          @click="startReconciliation"
        >
          Start Reconciliation
        </Button>
        <Button
          v-if="displayTask.state === 'completed'"
          variant="outline"
          size="sm"
          :disabled="isExporting"
          @click="exportAudit('csv')"
        >
          <Download class="h-3.5 w-3.5" />
          Export CSV
        </Button>
        <Button
          v-if="displayTask.state === 'completed'"
          variant="outline"
          size="sm"
          :disabled="isExporting"
          @click="exportAudit('json')"
        >
          <Download class="h-3.5 w-3.5" />
          Export JSON
        </Button>
      </div>

      <template v-if="showWalkthrough">
        <div class="flex-1 min-h-0 flex flex-col">
          <ScreenReconcileWalkthrough
            v-if="kind === 'screen'"
            :task-id="displayTask.id"
            @close="onWalkthroughClose"
            @applied="onWalkthroughApplied"
          />
          <ReconcileWalkthrough
            v-else
            :task-id="displayTask.id"
            :kind="kind"
            @close="onWalkthroughClose"
            @applied="onWalkthroughApplied"
          />
        </div>
      </template>
    </template>
  </div>
</template>
