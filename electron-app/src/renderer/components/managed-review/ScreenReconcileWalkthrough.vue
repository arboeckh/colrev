<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectsStore } from '@/stores/projects';
import ProgressTrack from '@/components/prescreen/ProgressTrack.vue';
import PdfViewerPanel from '@/components/screen/PdfViewerPanel.vue';
import ScreenSplitPanel from '@/components/screen/ScreenSplitPanel.vue';
import ScreenReconcileCriteriaPanel from './ScreenReconcileCriteriaPanel.vue';
import { deriveScreenDecision, formatCriteriaString, type CriterionDecision } from '@/lib/screen-decision';
import type {
  ApplyReconciliationResponse,
  GetRecordsResponse,
  GetScreenQueueResponse,
  ReconciliationPreviewItem,
  ReconciliationPreviewResponse,
  ScreenCriterionDefinition,
} from '@/types/api';

const props = defineProps<{
  taskId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'applied', result: ApplyReconciliationResponse): void;
}>();

const auth = useAuthStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const projects = useProjectsStore();

type StagedRecord = {
  criteria: Record<string, CriterionDecision>;
  confirmed: 'include' | 'exclude' | null;
};

const isLoading = ref(false);
const isApplying = ref(false);
const preview = ref<ReconciliationPreviewResponse | null>(null);
const criteriaDefs = ref<Record<string, ScreenCriterionDefinition>>({});
const pdfPaths = ref<Record<string, string>>({});
const stagedRecords = ref<Record<string, StagedRecord>>({});
const currentIndex = ref(0);

const conflictItems = computed<ReconciliationPreviewItem[]>(() =>
  preview.value ? preview.value.items.filter((item) => item.status === 'conflict') : [],
);

const blockedItems = computed<ReconciliationPreviewItem[]>(() =>
  preview.value ? preview.value.items.filter((item) => item.status === 'blocked') : [],
);

const pendingItems = computed<ReconciliationPreviewItem[]>(() =>
  preview.value ? preview.value.items.filter((item) => item.status === 'pending') : [],
);

const currentItem = computed<ReconciliationPreviewItem | null>(
  () => conflictItems.value[currentIndex.value] ?? null,
);

const currentStaged = computed<StagedRecord | null>(() => {
  if (!currentItem.value) return null;
  return stagedRecords.value[currentItem.value.id] ?? null;
});

const currentDerivedDecision = computed<'include' | 'exclude' | null>(() => {
  if (!currentStaged.value) return null;
  return deriveScreenDecision(criteriaDefs.value, currentStaged.value.criteria);
});

function confirmedDecisionFor(item: ReconciliationPreviewItem): 'include' | 'exclude' | null {
  const staged = stagedRecords.value[item.id];
  if (!staged) return null;
  const derived = deriveScreenDecision(criteriaDefs.value, staged.criteria);
  return staged.confirmed && staged.confirmed === derived ? staged.confirmed : null;
}

const decidedCount = computed(
  () => conflictItems.value.filter((item) => confirmedDecisionFor(item) !== null).length,
);

const allDecided = computed(
  () => conflictItems.value.length > 0 && decidedCount.value === conflictItems.value.length,
);

const progressItems = computed(() =>
  conflictItems.value.map((item) => {
    const d = confirmedDecisionFor(item);
    return {
      id: item.id,
      decision:
        d === 'include'
          ? ('included' as const)
          : d === 'exclude'
            ? ('excluded' as const)
            : ('undecided' as const),
    };
  }),
);

const nextUndecidedIndex = computed(() => {
  for (let i = currentIndex.value + 1; i < conflictItems.value.length; i++) {
    if (confirmedDecisionFor(conflictItems.value[i]) === null) return i;
  }
  for (let i = 0; i < currentIndex.value; i++) {
    if (confirmedDecisionFor(conflictItems.value[i]) === null) return i;
  }
  return -1;
});

const currentPdfPath = computed(() =>
  currentItem.value ? pdfPaths.value[currentItem.value.id] : undefined,
);

function buildDefaultDecisions(item: ReconciliationPreviewItem): Record<string, CriterionDecision> {
  const decisions: Record<string, CriterionDecision> = {};
  const names = Object.keys(criteriaDefs.value);
  for (const name of names) {
    const answers = item.reviewers.map((reviewer) => {
      const v = reviewer.criteria?.[name];
      return v === 'in' || v === 'out' ? v : 'TODO';
    });
    const [first, ...rest] = answers;
    if (first && first !== 'TODO' && rest.every((v) => v === first)) {
      decisions[name] = first;
    } else {
      decisions[name] = 'TODO';
    }
  }
  return decisions;
}

async function loadCriteria() {
  if (!projects.currentProjectId) return;
  try {
    const response = await backend.call<GetScreenQueueResponse>('get_screen_queue', {
      project_id: projects.currentProjectId,
      limit: 1,
    });
    criteriaDefs.value = response.criteria || {};
  } catch (err) {
    notifications.error(
      'Failed to load criteria',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
}

async function loadPdfPaths(ids: string[]) {
  if (!projects.currentProjectId || ids.length === 0) return;
  try {
    const response = await backend.call<GetRecordsResponse>('get_records', {
      project_id: projects.currentProjectId,
      filters: {},
      pagination: { offset: 0, limit: 1000 },
      fields: ['ID', 'file'],
    });
    const wanted = new Set(ids);
    const paths: Record<string, string> = {};
    for (const record of response.records) {
      const rid = (record as any).ID ?? (record as any).id;
      if (!rid || !wanted.has(rid)) continue;
      const file = (record as any).file;
      if (typeof file === 'string' && file) paths[rid] = file;
    }
    pdfPaths.value = paths;
  } catch {
    // Non-fatal — the PDF panel will show "No PDF available" if missing.
  }
}

async function loadPreview() {
  if (!projects.currentProjectId) return;
  isLoading.value = true;
  try {
    await loadCriteria();
    const response = await backend.call<ReconciliationPreviewResponse>(
      'get_reconciliation_preview',
      {
        project_id: projects.currentProjectId,
        task_id: props.taskId,
      },
    );
    preview.value = response;
    currentIndex.value = 0;
    const items = response.items.filter((item) => item.status === 'conflict');
    const next: Record<string, StagedRecord> = {};
    for (const item of items) {
      next[item.id] = { criteria: buildDefaultDecisions(item), confirmed: null };
    }
    stagedRecords.value = next;
    if (items.length > 0) {
      await loadPdfPaths(items.map((item) => item.id));
    }
  } catch (err) {
    notifications.error(
      'Preview failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isLoading.value = false;
  }
}

function onToggleCriterion(name: string, value: CriterionDecision) {
  const item = currentItem.value;
  if (!item) return;
  const staged = stagedRecords.value[item.id];
  if (!staged) return;
  const nextCriteria = { ...staged.criteria, [name]: value };
  const nextDerived = deriveScreenDecision(criteriaDefs.value, nextCriteria);
  stagedRecords.value = {
    ...stagedRecords.value,
    [item.id]: {
      criteria: nextCriteria,
      confirmed: staged.confirmed === nextDerived ? staged.confirmed : null,
    },
  };
}

function onConfirmDecision(decision: 'include' | 'exclude') {
  const item = currentItem.value;
  if (!item) return;
  const staged = stagedRecords.value[item.id];
  if (!staged) return;
  const derived = deriveScreenDecision(criteriaDefs.value, staged.criteria);
  if (derived !== decision) return;
  stagedRecords.value = {
    ...stagedRecords.value,
    [item.id]: { ...staged, confirmed: decision },
  };
  const next = nextUndecidedIndex.value;
  if (next !== -1) currentIndex.value = next;
}

function goTo(index: number) {
  if (index >= 0 && index < conflictItems.value.length) {
    currentIndex.value = index;
  }
}

async function applyReconciliation() {
  if (!projects.currentProjectId || !preview.value) return;
  if (blockedItems.value.length > 0 || pendingItems.value.length > 0) return;
  if (conflictItems.value.length > 0 && !allDecided.value) return;

  isApplying.value = true;
  try {
    const resolutions = conflictItems.value.map((item) => {
      const staged = stagedRecords.value[item.id];
      return {
        record_id: item.id,
        resolved_status: staged.confirmed === 'include' ? 'rev_included' : 'rev_excluded',
        resolved_criteria_string: formatCriteriaString(staged.criteria),
      };
    });
    const response = await backend.call<ApplyReconciliationResponse>('apply_reconciliation', {
      project_id: projects.currentProjectId,
      task_id: props.taskId,
      resolutions,
      resolved_by: auth.user?.login ?? 'local-user',
    });
    notifications.success(
      'Reconciliation applied',
      `${response.resolved_count} record(s) · ${response.commit_sha.slice(0, 8)}`,
    );
    emit('applied', response);
  } catch (err) {
    notifications.error(
      'Reconciliation failed',
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isApplying.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (!currentItem.value) return;
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      goTo(currentIndex.value - 1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      goTo(currentIndex.value + 1);
      break;
  }
}

watch(
  () => props.taskId,
  () => loadPreview(),
);

onMounted(() => {
  loadPreview();
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="h-full flex flex-col min-h-0" data-testid="screen-reconcile-walkthrough">
    <div
      v-if="isLoading && !preview"
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground"
    >
      <Loader2 class="h-4 w-4 animate-spin mr-2" />
      Loading reconciliation preview...
    </div>

    <div
      v-else-if="blockedItems.length > 0"
      class="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto text-center gap-4"
      data-testid="reconcile-blocked"
    >
      <div class="rounded-full bg-amber-500/15 p-3">
        <AlertTriangle class="h-6 w-6 text-amber-600 dark:text-amber-400" />
      </div>
      <div class="space-y-1">
        <h3 class="text-lg font-medium">Blocked records prevent reconciliation</h3>
        <p class="text-sm text-muted-foreground">
          Resolve the issues below before reconciling this task.
        </p>
      </div>
      <ul class="w-full space-y-2 text-left">
        <li
          v-for="item in blockedItems"
          :key="item.id"
          class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
        >
          <div class="text-sm font-medium">{{ item.title || item.id }}</div>
          <ul class="mt-1 space-y-1">
            <li
              v-for="reason in item.blocked_reasons"
              :key="reason"
              class="text-xs text-amber-700 dark:text-amber-300"
            >
              {{ reason }}
            </li>
          </ul>
        </li>
      </ul>
    </div>

    <div
      v-else-if="pendingItems.length > 0"
      class="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto text-center gap-4"
      data-testid="reconcile-pending"
    >
      <div class="rounded-full bg-muted p-3">
        <Loader2 class="h-6 w-6 text-muted-foreground" />
      </div>
      <div class="space-y-1">
        <h3 class="text-lg font-medium">Waiting on reviewers</h3>
        <p class="text-sm text-muted-foreground">
          Both reviewers must finish all records before reconciliation can begin.
          {{ pendingItems.length }} record{{ pendingItems.length === 1 ? '' : 's' }} still pending.
        </p>
      </div>
    </div>

    <div
      v-else-if="preview && conflictItems.length === 0"
      class="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto text-center gap-4"
      data-testid="reconcile-no-conflicts"
    >
      <div class="rounded-full bg-green-600/15 p-3">
        <CheckCircle2 class="h-6 w-6 text-green-600 dark:text-green-500" />
      </div>
      <div class="space-y-1">
        <h3 class="text-lg font-medium">No conflicts to resolve</h3>
        <p class="text-sm text-muted-foreground">
          Both reviewers agreed on every record. Apply reconciliation to finalize
          {{ preview.summary.auto_resolved_count }} auto-resolved decision{{ preview.summary.auto_resolved_count === 1 ? '' : 's' }}.
        </p>
      </div>
      <Button
        :disabled="isApplying"
        data-testid="reconcile-apply-btn"
        @click="applyReconciliation"
      >
        <Loader2 v-if="isApplying" class="h-4 w-4 animate-spin" />
        {{ isApplying ? 'Applying...' : 'Apply Reconciliation' }}
      </Button>
    </div>

    <template v-else-if="currentItem">
      <div class="flex items-center gap-3 shrink-0 mb-2">
        <Button
          variant="ghost"
          size="sm"
          :disabled="isApplying"
          data-testid="reconcile-back-btn"
          @click="emit('close')"
        >
          <ArrowLeft class="h-4 w-4" />
          Back
        </Button>
        <div class="flex-1 min-w-0">
          <ProgressTrack
            :items="progressItems"
            :current-index="currentIndex"
            :decided-count="decidedCount"
            :total-count="conflictItems.length"
            :show-counter="false"
            test-id-prefix="reconcile"
            @seek="goTo"
          />
        </div>
        <Button
          v-if="allDecided"
          :disabled="isApplying"
          data-testid="reconcile-apply-btn"
          @click="applyReconciliation"
        >
          <Loader2 v-if="isApplying" class="h-4 w-4 animate-spin" />
          {{ isApplying ? 'Applying...' : 'Apply Reconciliation' }}
        </Button>
      </div>

      <ScreenSplitPanel class="flex-1 min-h-0">
        <template #left>
          <PdfViewerPanel :pdf-path="currentPdfPath" />
        </template>
        <template #right>
          <div class="h-full flex flex-col min-h-0">
            <div class="shrink-0 px-4 pt-3 pb-2 border-b border-border">
              <div class="text-[11px] uppercase tracking-wide text-muted-foreground">
                Record {{ currentIndex + 1 }} of {{ conflictItems.length }}
              </div>
              <div class="text-sm font-medium truncate" :title="currentItem.title || currentItem.id">
                {{ currentItem.title || currentItem.id }}
              </div>
              <div class="text-xs text-muted-foreground truncate">
                {{ currentItem.author }}<span v-if="currentItem.year"> · {{ currentItem.year }}</span>
              </div>
            </div>
            <div class="flex-1 min-h-0">
              <ScreenReconcileCriteriaPanel
                v-if="currentStaged"
                :criteria="criteriaDefs"
                :decisions="currentStaged.criteria"
                :reviewers="currentItem.reviewers"
                :derived-decision="currentDerivedDecision"
                :confirmed-decision="currentStaged.confirmed"
                @toggle="onToggleCriterion"
                @confirm="onConfirmDecision"
              />
            </div>
          </div>
        </template>
      </ScreenSplitPanel>
    </template>
  </div>
</template>
