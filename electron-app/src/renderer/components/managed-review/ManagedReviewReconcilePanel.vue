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
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/auth';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectsStore } from '@/stores/projects';
import type {
  ApplyReconciliationResponse,
  ExportReconciliationAuditResponse,
  ListManagedReviewTasksResponse,
  ManagedReviewTask,
  ReconciliationPreviewResponse,
} from '@/types/api';

const props = defineProps<{
  kind: 'prescreen' | 'screen';
}>();

const auth = useAuthStore();
const backend = useBackendStore();
const git = useGitStore();
const notifications = useNotificationsStore();
const projects = useProjectsStore();

const isLoading = ref(false);
const isApplying = ref(false);
const isExporting = ref(false);
const tasks = ref<ManagedReviewTask[]>([]);
const preview = ref<ReconciliationPreviewResponse | null>(null);
const selectedResolutions = ref<Record<string, 'reviewer_a' | 'reviewer_b'>>({});

const kindLabel = computed(() => (props.kind === 'screen' ? 'Screen' : 'Prescreen'));
const activeTask = computed(() => tasks.value.find((task) => ['active', 'reconciling'].includes(task.state)) ?? null);
const displayTask = computed(() => activeTask.value ?? tasks.value[0] ?? null);
const isOnDev = computed(() => git.currentBranch === 'dev');
const hasMissingManualChoices = computed(() => {
  if (!preview.value) return false;
  const conflicts = preview.value.items.filter((item) => item.status === 'conflict');
  return conflicts.some((item) => !selectedResolutions.value[item.id]);
});
const canApplyReconciliation = computed(() => {
  if (!preview.value || !displayTask.value || !isOnDev.value) return false;
  return preview.value.summary.blocked_count === 0
    && preview.value.summary.pending_count === 0
    && !hasMissingManualChoices.value
    && displayTask.value.state !== 'completed';
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
    const tasksResponse = await backend.call<ListManagedReviewTasksResponse>('list_managed_review_tasks', {
      project_id: projects.currentProjectId,
      kind: props.kind,
    });
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

async function loadPreview() {
  if (!displayTask.value || !projects.currentProjectId || !isOnDev.value) return;
  try {
    const response = await backend.call<ReconciliationPreviewResponse>('get_reconciliation_preview', {
      project_id: projects.currentProjectId,
      task_id: displayTask.value.id,
    });
    preview.value = response;
    selectedResolutions.value = {};
  } catch (err) {
    notifications.error('Preview failed', err instanceof Error ? err.message : 'Unknown error');
  }
}

async function applyReconciliation() {
  if (!displayTask.value || !projects.currentProjectId || !preview.value) return;

  isApplying.value = true;
  try {
    const resolutions = Object.entries(selectedResolutions.value).map(([record_id, selected_reviewer]) => ({
      record_id,
      selected_reviewer,
    }));
    const response = await backend.call<ApplyReconciliationResponse>('apply_reconciliation', {
      project_id: projects.currentProjectId,
      task_id: displayTask.value.id,
      resolutions,
      resolved_by: auth.user?.login ?? 'local-user',
    });
    notifications.success('Reconciliation applied', response.commit_sha.slice(0, 8));
    preview.value = null;
    selectedResolutions.value = {};
    await refreshData();
  } catch (err) {
    notifications.error('Reconciliation failed', err instanceof Error ? err.message : 'Unknown error');
  } finally {
    isApplying.value = false;
  }
}

async function exportAudit(format: 'csv' | 'json') {
  if (!displayTask.value || !projects.currentProjectId) return;

  isExporting.value = true;
  try {
    const response = await backend.call<ExportReconciliationAuditResponse>('export_reconciliation_audit', {
      project_id: projects.currentProjectId,
      task_id: displayTask.value.id,
      format,
    });
    await window.fileOps.saveDialog({
      defaultName: response.filename,
      content: response.content,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
  } catch (err) {
    notifications.error('Export failed', err instanceof Error ? err.message : 'Unknown error');
  } finally {
    isExporting.value = false;
  }
}

onMounted(async () => {
  // Auto-switch to dev if not already there (reconciliation runs on dev)
  if (!isOnDev.value) {
    await git.switchBranch('dev');
  }
  await refreshData();
});

defineExpose({ refreshData });
</script>

<template>
  <div class="space-y-6">
    <!-- Loading -->
    <div v-if="isLoading && !displayTask" class="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 class="h-4 w-4 animate-spin" />
      Loading task data...
    </div>

    <!-- No task -->
    <div v-else-if="!displayTask" class="text-sm text-muted-foreground">
      No {{ kindLabel.toLowerCase() }} task to reconcile. Launch a managed task first, then come back once both reviewers have finished.
    </div>

    <!-- Task display -->
    <template v-else>
      <!-- Task header -->
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium">{{ displayTask.id }}</h3>
          <p class="text-xs text-muted-foreground">Created by {{ displayTask.created_by }} · {{ prettyDate(displayTask.created_at) }}</p>
        </div>
        <Badge :variant="displayTask.state === 'completed' ? 'default' : 'secondary'" class="text-xs">
          {{ displayTask.state }}
        </Badge>
      </div>

      <!-- Reviewer progress -->
      <div class="border border-border rounded-md overflow-hidden">
        <div
          v-for="(reviewer, index) in displayTask.reviewer_progress"
          :key="reviewer.role"
          class="flex items-center justify-between py-2.5 px-3"
          :class="index > 0 ? 'border-t border-border' : ''"
        >
          <div class="flex items-center gap-2">
            <span class="h-2 w-2 rounded-full shrink-0" :class="reviewer.available ? 'bg-green-500' : 'bg-muted-foreground/30'" />
            <span class="text-sm font-medium">{{ reviewer.github_login }}</span>
          </div>
          <span class="text-xs text-muted-foreground tabular-nums">{{ reviewer.completed_count }} / {{ displayTask.record_count }}</span>
        </div>
      </div>

      <!-- Reconciliation summary (if completed) -->
      <div v-if="displayTask.reconciliation_summary" class="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
        <span>Reconciled by {{ displayTask.reconciliation_summary.resolved_by }} — {{ displayTask.reconciliation_summary.auto_resolved_count }} auto, {{ displayTask.reconciliation_summary.manual_conflict_count }} manual</span>
      </div>

      <!-- Not on dev warning -->
      <div v-if="!isOnDev" class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
        <span>Reconciliation must run from the dev branch.</span>
        <Button variant="outline" size="sm" class="h-7 text-xs" @click="switchToDev">
          Switch to dev
        </Button>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <Button
          v-if="displayTask.state !== 'completed' && displayTask.state !== 'aborted'"
          size="sm"
          @click="loadPreview"
        >
          Load Preview
        </Button>
        <Button
          v-if="displayTask.state === 'completed'"
          variant="outline"
          size="sm"
          :disabled="isExporting"
          @click="exportAudit('csv')"
        >
          <Download class="h-3.5 w-3.5 mr-1.5" />
          Export CSV
        </Button>
        <Button
          v-if="displayTask.state === 'completed'"
          variant="outline"
          size="sm"
          :disabled="isExporting"
          @click="exportAudit('json')"
        >
          <Download class="h-3.5 w-3.5 mr-1.5" />
          Export JSON
        </Button>
      </div>

      <!-- Reconciliation preview -->
      <template v-if="preview">
        <Separator />

        <div class="space-y-2">
          <h3 class="text-sm font-medium">Reconciliation Preview</h3>
          <div class="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{{ preview.summary.auto_resolved_count }} auto-resolved</span>
            <span>{{ preview.summary.manual_conflict_count }} conflict{{ preview.summary.manual_conflict_count === 1 ? '' : 's' }}</span>
            <span>{{ preview.summary.pending_count }} pending</span>
            <span v-if="preview.summary.blocked_count > 0" class="text-amber-600">{{ preview.summary.blocked_count }} blocked</span>
          </div>
        </div>

        <!-- Record items -->
        <div class="border border-border rounded-md overflow-hidden">
          <div
            v-for="(item, index) in preview.items"
            :key="item.id"
            class="p-3"
            :class="index > 0 ? 'border-t border-border' : ''"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="text-sm font-medium truncate">{{ item.title || item.id }}</div>
                <div class="text-xs text-muted-foreground">{{ item.author }} · {{ item.year }}</div>
              </div>
              <Badge :variant="item.status === 'auto' ? 'default' : item.status === 'conflict' ? 'destructive' : 'secondary'" class="text-xs shrink-0">
                {{ item.status }}
              </Badge>
            </div>

            <!-- Reviewer decisions side by side -->
            <div class="mt-2 grid gap-2 grid-cols-2">
              <div
                v-for="reviewer in item.reviewers"
                :key="`${item.id}-${reviewer.role}`"
                class="text-xs"
              >
                <span class="font-medium">{{ reviewer.github_login }}</span>
                <span class="text-muted-foreground ml-1">{{ reviewer.status || 'pending' }}</span>
                <span v-if="reviewer.criteria_string" class="block text-muted-foreground/70 truncate">{{ reviewer.criteria_string }}</span>
              </div>
            </div>

            <!-- Blocked reasons -->
            <div v-if="item.blocked_reasons.length" class="mt-2 space-y-1">
              <div
                v-for="reason in item.blocked_reasons"
                :key="reason"
                class="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle class="h-3 w-3 mt-0.5 shrink-0" />
                <span>{{ reason }}</span>
              </div>
            </div>

            <!-- Conflict resolution -->
            <div v-if="item.status === 'conflict'" class="mt-2">
              <select
                v-model="selectedResolutions[item.id]"
                class="w-full max-w-xs rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="">Choose reviewer...</option>
                <option
                  v-for="reviewer in item.reviewers"
                  :key="reviewer.role"
                  :value="reviewer.role"
                >
                  {{ reviewer.github_login }} · {{ reviewer.status }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Apply button -->
        <Button size="sm" :disabled="!canApplyReconciliation || isApplying" @click="applyReconciliation">
          {{ isApplying ? 'Applying...' : 'Apply Reconciliation' }}
        </Button>
      </template>
    </template>
  </div>
</template>
