<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  Search,
  Download,
  FileEdit,
  Copy,
  Filter,
  FileDown,
  FileCheck,
  CheckSquare,
  Database,
  ArrowRight,
  BookOpen,
  Layers,
  Files,
  Circle,
  CheckCircle2,
  AlertCircle,
} from 'lucide-vue-next';
import { useProjectsStore } from '@/stores/projects';
import { WORKFLOW_STEPS, type WorkflowStep } from '@/types/project';

const router = useRouter();
const projects = useProjectsStore();

const stepIcons: Partial<Record<WorkflowStep, typeof Search>> = {
  review_definition: BookOpen,
  search: Search,
  preprocessing: Layers,
  load: Download,
  prep: FileEdit,
  dedupe: Copy,
  prescreen: Filter,
  pdfs: Files,
  pdf_get: FileDown,
  pdf_prep: FileCheck,
  screen: CheckSquare,
  data: Database,
};

function calculateStepProgress(stepId: WorkflowStep): number {
  const records = projects.currentStatus?.currently;
  if (!records) return 0;

  const step = WORKFLOW_STEPS.find((s) => s.id === stepId);
  if (!step) return 0;

  const pending = step.inputStates.reduce((sum, state) => {
    return sum + (records[state] ?? 0);
  }, 0);

  const processed = step.outputStates.reduce((sum, state) => {
    return sum + (records[state] ?? 0);
  }, 0);

  if (pending === 0 && processed === 0) return 0;
  if (pending === 0 && processed > 0) return 100;

  const total = pending + processed;
  return Math.round((processed / total) * 100);
}

const workflowProgress = computed(() => {
  return WORKFLOW_STEPS.map((step) => ({
    ...step,
    percentage: calculateStepProgress(step.id),
    canRun: projects.operationInfo[step.id]?.can_run ?? false,
    affectedRecords: projects.operationInfo[step.id]?.affected_records ?? 0,
  }));
});

const nextStep = computed(() => {
  const next = projects.nextOperation;
  if (!next) return null;
  return WORKFLOW_STEPS.find((s) => s.id === next) || null;
});

const totalRecords = computed(() => projects.currentStatus?.total_records ?? 0);

function navigateToStep(stepRoute: string) {
  if (projects.currentProjectId) {
    router.push(`/project/${projects.currentProjectId}/${stepRoute}`);
  }
}

function stepStatus(step: (typeof workflowProgress.value)[number]) {
  if (step.percentage === 100) return 'complete';
  if (step.affectedRecords > 0 || step.percentage > 0) return 'active';
  return 'pending';
}
</script>

<template>
  <div class="p-6 max-w-2xl">
    <!-- Page header -->
    <div class="mb-8">
      <h2 class="text-2xl font-bold">
        {{ projects.currentSettings?.project?.title || 'Literature Review Project' }}
      </h2>
      <p class="text-sm text-muted-foreground mt-1">
        {{ totalRecords }} records
      </p>
    </div>

    <!-- Workflow steps list -->
    <div class="space-y-1">
      <div
        v-for="step in workflowProgress"
        :key="step.id"
        class="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors hover:bg-muted/50"
        :class="nextStep?.id === step.id ? 'bg-muted/30' : ''"
        @click="navigateToStep(step.route)"
      >
        <!-- Status indicator -->
        <CheckCircle2
          v-if="stepStatus(step) === 'complete'"
          class="h-4 w-4 shrink-0 text-green-500"
        />
        <AlertCircle
          v-else-if="stepStatus(step) === 'active'"
          class="h-4 w-4 shrink-0 text-primary"
        />
        <Circle
          v-else
          class="h-4 w-4 shrink-0 text-muted-foreground/40"
        />

        <!-- Step icon and label -->
        <component :is="stepIcons[step.id]" class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="font-medium text-sm flex-1">{{ step.label }}</span>

        <!-- Pending count or completion -->
        <span
          v-if="step.affectedRecords > 0"
          class="text-xs text-muted-foreground tabular-nums"
        >
          {{ step.affectedRecords }} pending
        </span>
        <span
          v-else-if="step.percentage === 100"
          class="text-xs text-green-500"
        >
          done
        </span>

        <!-- Next step arrow -->
        <ArrowRight
          v-if="nextStep?.id === step.id"
          class="h-3.5 w-3.5 text-primary shrink-0"
        />
      </div>
    </div>
  </div>
</template>
