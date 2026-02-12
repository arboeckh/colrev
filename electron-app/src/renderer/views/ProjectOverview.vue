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
} from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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

// Record counts by category - use 'currently' for current record states
const recordStats = computed(() => {
  const records = projects.currentStatus?.currently;
  if (!records) return null;

  return {
    total: projects.currentStatus?.total_records ?? 0,
    imported: records.md_imported + records.md_retrieved,
    prepared: records.md_prepared + records.md_processed,
    prescreened: records.rev_prescreen_included,
    prescreenExcluded: records.rev_prescreen_excluded,
    withPdf: records.pdf_prepared + records.pdf_imported,
    screened: records.rev_included,
    screenExcluded: records.rev_excluded,
    synthesized: records.rev_synthesized,
  };
});

// Calculate step completion percentage based on record states
// A step is "complete" when no records are pending for it
function calculateStepProgress(stepId: WorkflowStep): number {
  const records = projects.currentStatus?.currently;
  if (!records) return 0;

  const step = WORKFLOW_STEPS.find((s) => s.id === stepId);
  if (!step) return 0;

  // Get pending records for this step
  const pending = step.inputStates.reduce((sum, state) => {
    return sum + (records[state] ?? 0);
  }, 0);

  // Get processed records for this step
  const processed = step.outputStates.reduce((sum, state) => {
    return sum + (records[state] ?? 0);
  }, 0);

  // If no records have reached this step yet, 0%
  if (pending === 0 && processed === 0) return 0;

  // If all records processed (none pending), 100%
  if (pending === 0 && processed > 0) return 100;

  // Otherwise, percentage of processed vs total
  const total = pending + processed;
  return Math.round((processed / total) * 100);
}

// Current workflow progress
const workflowProgress = computed(() => {
  return WORKFLOW_STEPS.map((step) => ({
    ...step,
    percentage: calculateStepProgress(step.id),
    canRun: projects.operationInfo[step.id]?.can_run ?? false,
    affectedRecords: projects.operationInfo[step.id]?.affected_records ?? 0,
  }));
});

// Next recommended step
const nextStep = computed(() => {
  const next = projects.nextOperation;
  if (!next) return null;

  return WORKFLOW_STEPS.find((s) => s.id === next) || null;
});

function navigateToStep(stepRoute: string) {
  if (projects.currentProjectId) {
    router.push(`/project/${projects.currentProjectId}/${stepRoute}`);
  }
}
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page header -->
    <div>
      <h2 class="text-2xl font-bold">Project Overview</h2>
      <p class="text-muted-foreground">
        {{ projects.currentSettings?.project?.title || 'Literature Review Project' }}
      </p>
    </div>

    <!-- Quick stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Total Records</CardDescription>
          <CardTitle class="text-3xl tabular-nums">
            {{ recordStats?.total ?? 0 }}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Included (Prescreen)</CardDescription>
          <CardTitle class="text-3xl tabular-nums text-green-500">
            {{ recordStats?.prescreened ?? 0 }}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>With PDF</CardDescription>
          <CardTitle class="text-3xl tabular-nums">
            {{ recordStats?.withPdf ?? 0 }}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Final Included</CardDescription>
          <CardTitle class="text-3xl tabular-nums text-green-500">
            {{ recordStats?.screened ?? 0 }}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>

    <!-- Next step suggestion -->
    <Card v-if="nextStep" class="border-primary/50 bg-primary/5">
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardDescription>Suggested Next Step</CardDescription>
            <CardTitle class="flex items-center gap-2">
              <component :is="stepIcons[nextStep.id]" class="h-5 w-5" />
              {{ nextStep.label }}
            </CardTitle>
          </div>
          <Button @click="navigateToStep(nextStep.route)">
            Go to {{ nextStep.label }}
            <ArrowRight class="h-4 w-4 ml-2" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground">{{ nextStep.description }}</p>
      </CardContent>
    </Card>

    <!-- Workflow progress -->
    <Card>
      <CardHeader>
        <CardTitle>Workflow Progress</CardTitle>
        <CardDescription>Status of each step in the review process</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div
            v-for="step in workflowProgress"
            :key="step.id"
            class="flex items-center gap-4 cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-2 rounded-md transition-colors"
            @click="navigateToStep(step.route)"
          >
            <!-- Step icon -->
            <div
              class="flex items-center justify-center w-10 h-10 rounded-full"
              :class="step.percentage === 100 ? 'bg-green-500/20 text-green-500' : 'bg-muted text-muted-foreground'"
            >
              <component :is="stepIcons[step.id]" class="h-5 w-5" />
            </div>

            <!-- Step info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium">{{ step.label }}</span>
                <Badge v-if="step.canRun && step.affectedRecords > 0" variant="secondary" class="text-xs">
                  {{ step.affectedRecords }} pending
                </Badge>
              </div>
              <p class="text-sm text-muted-foreground truncate">{{ step.description }}</p>
            </div>

            <!-- Progress bar -->
            <div class="w-24">
              <div class="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="step.percentage === 100 ? 'bg-green-500' : 'bg-primary'"
                  :style="{ width: `${step.percentage}%` }"
                />
              </div>
              <span class="text-xs text-muted-foreground tabular-nums">{{ step.percentage }}%</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Record status breakdown -->
    <Card>
      <CardHeader>
        <CardTitle>Record Status</CardTitle>
        <CardDescription>Breakdown of records by current status</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div class="space-y-1">
            <span class="text-sm text-muted-foreground">Imported</span>
            <p class="text-xl font-semibold tabular-nums">{{ recordStats?.imported ?? 0 }}</p>
          </div>
          <div class="space-y-1">
            <span class="text-sm text-muted-foreground">Prepared</span>
            <p class="text-xl font-semibold tabular-nums">{{ recordStats?.prepared ?? 0 }}</p>
          </div>
          <div class="space-y-1">
            <span class="text-sm text-muted-foreground">Pre-Included</span>
            <p class="text-xl font-semibold tabular-nums text-green-500">{{ recordStats?.prescreened ?? 0 }}</p>
          </div>
          <div class="space-y-1">
            <span class="text-sm text-muted-foreground">Pre-Excluded</span>
            <p class="text-xl font-semibold tabular-nums text-red-500">{{ recordStats?.prescreenExcluded ?? 0 }}</p>
          </div>
          <div class="space-y-1">
            <span class="text-sm text-muted-foreground">Final Included</span>
            <p class="text-xl font-semibold tabular-nums text-green-500">{{ recordStats?.screened ?? 0 }}</p>
          </div>
          <div class="space-y-1">
            <span class="text-sm text-muted-foreground">Final Excluded</span>
            <p class="text-xl font-semibold tabular-nums text-red-500">{{ recordStats?.screenExcluded ?? 0 }}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
