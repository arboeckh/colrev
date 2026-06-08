import type { WorkflowStepInfo, RecordCounts, OverallRecordCounts } from '../types/project';

export type StepStatus = 'complete' | 'active' | 'warning' | 'pending';

export interface StepStatusContext {
  counts: (RecordCounts & { total: number }) | null;
  overall: OverallRecordCounts | null;
  hasStaleSearchSources: boolean;
  managedStepStatus: StepStatus | null;
  suppressCounts: boolean;
}

// Pure function: no Vue reactivity or store access.
export function computeStepStatus(
  step: WorkflowStepInfo,
  stepIndex: number,
  allSteps: WorkflowStepInfo[],
  ctx: StepStatusContext,
): StepStatus {
  const { counts, overall, hasStaleSearchSources, managedStepStatus, suppressCounts } = ctx;

  // Managed review steps take precedence (task-derived status)
  if (managedStepStatus != null) {
    return managedStepStatus;
  }

  if (step.id === 'review_definition') {
    return 'active';
  }

  const totalRecords = counts?.total ?? 0;
  const isSearchComplete = totalRecords > 0 && !hasStaleSearchSources;

  const pendingRecords = suppressCounts
    ? 0
    : step.inputStates.reduce((sum, state) => sum + (counts?.[state] ?? 0), 0);

  const processedRecords = suppressCounts
    ? 0
    : step.outputStates.reduce((sum, state) => sum + (counts?.[state] ?? 0), 0);

  const everProcessedRecords = suppressCounts
    ? 0
    : step.outputStates.reduce((sum, state) => {
        const key = state as keyof OverallRecordCounts;
        return sum + (overall?.[key] ?? 0);
      }, 0);

  // Any prior step still has records waiting — this step can't be "complete" yet
  let hasPriorPending = false;
  for (let i = 0; i < stepIndex; i++) {
    const priorPending = allSteps[i].inputStates.reduce(
      (sum, state) => sum + (counts?.[state] ?? 0),
      0,
    );
    if (priorPending > 0) {
      hasPriorPending = true;
      break;
    }
  }

  if (step.id === 'search') {
    if (isSearchComplete && (processedRecords > 0 || everProcessedRecords > 0)) {
      return 'complete';
    }
    return 'active';
  }

  if (!isSearchComplete) {
    return 'pending';
  }

  if (pendingRecords > 0) {
    return 'active';
  }

  if (step.id === 'data') {
    const synthesizedNow = counts?.rev_synthesized ?? 0;
    const synthesizedEver = overall?.rev_synthesized ?? 0;
    if (synthesizedNow > 0 || synthesizedEver > 0) {
      return hasPriorPending ? 'pending' : 'complete';
    }
  }

  if (processedRecords > 0 || everProcessedRecords > 0) {
    return hasPriorPending ? 'pending' : 'complete';
  }

  return 'pending';
}
