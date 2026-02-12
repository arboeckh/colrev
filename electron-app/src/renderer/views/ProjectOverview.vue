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
  Check,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useProjectsStore } from '@/stores/projects';
import { WORKFLOW_STEPS, type WorkflowStep } from '@/types/project';

const router = useRouter();
const projects = useProjectsStore();

// Step icons mapping
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

const totalRecords = computed(() => projects.currentStatus?.total_records ?? 0);

// Determine step status: 'complete', 'active', or 'pending'
function getStepStatus(step: (typeof WORKFLOW_STEPS)[number]): 'complete' | 'active' | 'pending' {
  const records = projects.currentStatus?.currently;
  const overall = projects.currentStatus?.overall;
  if (!records) return 'pending';

  const next = projects.nextOperation;

  // Definition is always accessible
  if (step.id === 'review_definition') {
    return next === 'review_definition' ? 'active' : 'complete';
  }

  // Check if this is the next operation
  if (step.id === next) return 'active';

  // Check if step has pending input records
  const pending = step.inputStates.reduce((sum, state) => sum + (records[state] ?? 0), 0);
  if (pending > 0) return 'active';

  // Check if step has ever produced output
  const processed = step.outputStates.reduce((sum, state) => sum + (records[state] ?? 0), 0);
  const everProcessed = step.outputStates.reduce(
    (sum, state) => sum + ((overall as any)?.[state] ?? 0),
    0,
  );
  if (processed > 0 || everProcessed > 0) return 'complete';

  return 'pending';
}

// Workflow steps with their status
const workflowSteps = computed(() => {
  return WORKFLOW_STEPS.map((step) => ({
    ...step,
    status: getStepStatus(step),
  }));
});

// Next recommended step
const nextStep = computed(() => {
  const next = projects.nextOperation;
  if (!next) return null;
  return WORKFLOW_STEPS.find((s) => s.id === next) || null;
});

// Completed steps count for summary text
const completedCount = computed(() => workflowSteps.value.filter((s) => s.status === 'complete').length);

function navigateToStep(stepRoute: string) {
  if (projects.currentProjectId) {
    router.push(`/project/${projects.currentProjectId}/${stepRoute}`);
  }
}
</script>

<template>
  <div class="p-6 space-y-8 max-w-2xl">
    <!-- Project heading and summary -->
    <div>
      <h2 class="text-2xl font-bold">
        {{ projects.currentSettings?.project?.title || 'Literature Review Project' }}
      </h2>
      <p class="text-muted-foreground mt-1">
        <span v-if="totalRecords > 0">{{ totalRecords }} records</span>
        <span v-if="totalRecords > 0 && nextStep"> · </span>
        <span v-if="nextStep">Next step: <span class="font-medium text-foreground">{{ nextStep.label }}</span></span>
        <span v-if="!nextStep && totalRecords === 0">No records yet — start by adding a search source.</span>
      </p>
    </div>

    <!-- Step progress -->
    <div class="space-y-1">
      <div class="flex items-center justify-between text-sm text-muted-foreground mb-3">
        <span>Progress</span>
        <span>{{ completedCount }} / {{ workflowSteps.length }} steps</span>
      </div>
      <div class="space-y-0">
        <div
          v-for="(step, index) in workflowSteps"
          :key="step.id"
          class="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
          @click="navigateToStep(step.route)"
        >
          <!-- Step status indicator -->
          <div
            class="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-xs font-medium"
            :class="{
              'bg-green-500/20 text-green-500': step.status === 'complete',
              'bg-primary/20 text-primary ring-2 ring-primary/30': step.status === 'active',
              'bg-muted text-muted-foreground': step.status === 'pending',
            }"
          >
            <Check v-if="step.status === 'complete'" class="h-3.5 w-3.5" />
            <span v-else>{{ index + 1 }}</span>
          </div>

          <!-- Step label -->
          <span
            class="text-sm"
            :class="{
              'text-foreground font-medium': step.status === 'active',
              'text-foreground': step.status === 'complete',
              'text-muted-foreground': step.status === 'pending',
            }"
          >
            {{ step.label }}
          </span>
        </div>
      </div>
    </div>

    <!-- Next step action -->
    <div v-if="nextStep">
      <Button @click="navigateToStep(nextStep.route)">
        Go to {{ nextStep.label }}
        <ArrowRight class="h-4 w-4 ml-2" />
      </Button>
    </div>
  </div>
</template>
