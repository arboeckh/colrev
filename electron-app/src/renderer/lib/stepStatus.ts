import type { StatusStep, WorkflowStepInfo } from '../types/project';

/**
 * The ONLY renderer status module.
 *
 * The engine derives per-operation status once (Python:
 * colrev/ui_jsonrpc/framework/operation_graph.py) and ships it in the
 * get_status payload (`status.steps`, `status.search_stale`,
 * `status.next_operation`). Everything here is a pure presentation mapping
 * from that payload plus UI-only inputs (managed-review task role, freeze,
 * reviewer-branch suppression). No view or store may re-derive step status
 * from raw record counts.
 */

export type StepStatus = 'complete' | 'active' | 'warning' | 'pending';

export type StepsByOperation = Record<string, StatusStep>;

export function stepsByOperation(steps: StatusStep[] | null | undefined): StepsByOperation | null {
  if (!steps || steps.length === 0) return null;
  const map: StepsByOperation = {};
  for (const step of steps) map[step.operation] = step;
  return map;
}

export interface StepStatusContext {
  /** Per-operation payload from get_status (`stepsByOperation(status.steps)`). */
  steps: StepsByOperation | null;
  /** From the payload: `status.search_stale`. The renderer stores no independent flag. */
  searchStale: boolean;
  /** From the payload: `status.total_records`. */
  totalRecords: number;
  /** Managed review task-role override (UI-only input). */
  managedStepStatus: StepStatus | null;
  /** Reviewer-branch: steps after the active review step render as pending. */
  suppressCounts: boolean;
}

// Pure function: no Vue reactivity or store access.
export function computeStepStatus(
  step: WorkflowStepInfo,
  _stepIndex: number,
  _allSteps: WorkflowStepInfo[],
  ctx: StepStatusContext,
): StepStatus {
  const { steps, searchStale, totalRecords, managedStepStatus, suppressCounts } = ctx;

  // Managed review steps take precedence (task-derived status)
  if (managedStepStatus != null) {
    return managedStepStatus;
  }

  if (step.id === 'review_definition') {
    return 'active';
  }

  if (step.id === 'search') {
    return steps?.search?.state === 'complete' ? 'complete' : 'active';
  }

  if (!steps) return 'pending';
  // Search must be complete before any downstream step can show progress.
  if (searchStale || totalRecords === 0) return 'pending';
  if (suppressCounts) return 'pending';

  const operations = step.operations ?? [step.id];
  const opSteps = operations.map((op) => steps[op]).filter(Boolean) as StatusStep[];
  if (opSteps.length === 0) return 'pending';

  if (opSteps.some((s) => s.pending_records > 0)) return 'active';
  if (opSteps.every((s) => s.state === 'complete')) return 'complete';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Managed review: sidebar status for prescreen/screen from task state
// ---------------------------------------------------------------------------

export interface ManagedStepInput {
  hasActiveTask: boolean;
  hasCompletedTask: boolean;
  /** Records currently eligible for this review kind (payload: steps[kind].pending_records). */
  eligibleCount: number;
}

export function computeManagedStepStatus(input: ManagedStepInput): StepStatus {
  // Active task — step is in progress
  if (input.hasActiveTask) return 'active';
  // New eligible records take precedence over a past completed task:
  // if records are waiting to be screened, the step is active again.
  if (input.eligibleCount > 0) return 'active';
  // Completed task and no eligible records — step is done
  if (input.hasCompletedTask) return 'complete';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Managed review: workflow page phase stepper (launch → review → reconcile)
// ---------------------------------------------------------------------------

export type ReviewPhase = 'launch' | 'review' | 'reconcile';

export interface ReviewPhaseContext {
  currentPhase: ReviewPhase;
  hasActiveTask: boolean;
  hasCompletedTask: boolean;
  /** Every reviewer's committed pending_count is zero. */
  allReviewersDone: boolean;
  /** The current user's committed pending_count is zero (null if unknown). */
  myProgressDone: boolean | null;
  /**
   * The user sits on their own reviewer branch and the payload shows no
   * eligible records left in the working tree (decisions not yet committed
   * are visible here before reviewer_progress catches up).
   */
  onOwnBranchNothingEligible: boolean;
}

export function computeReviewPhaseStatus(
  phaseId: ReviewPhase,
  ctx: ReviewPhaseContext,
): 'complete' | 'active' | 'pending' {
  const {
    currentPhase,
    hasActiveTask,
    hasCompletedTask,
    allReviewersDone,
    myProgressDone,
    onOwnBranchNothingEligible,
  } = ctx;

  if (phaseId === 'launch') {
    if (hasActiveTask || hasCompletedTask) return 'complete';
    return currentPhase === 'launch' ? 'active' : 'pending';
  }

  if (phaseId === 'review') {
    if (hasCompletedTask && !hasActiveTask) return 'complete';
    if (hasActiveTask) {
      if (allReviewersDone) return 'complete';
      if (myProgressDone) return 'complete';
      if (onOwnBranchNothingEligible) return 'complete';
      return currentPhase === 'review' ? 'active' : 'pending';
    }
    return 'pending';
  }

  // reconcile
  if (hasCompletedTask) return 'complete';
  if (hasActiveTask && allReviewersDone && currentPhase === 'reconcile') return 'active';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Prescreen / Screen page completion
// ---------------------------------------------------------------------------

/**
 * A review step is finished when nothing is pending for it and at least one
 * record has been decided (sits in its output states).
 */
export function isReviewStepComplete(step: StatusStep | null | undefined): boolean {
  return !!step && step.pending_records === 0 && step.processed_records > 0;
}

// ---------------------------------------------------------------------------
// PDFs page stage machine (retrieve → upload → prepare → fix → summary)
// ---------------------------------------------------------------------------

export type PdfStageId = 'retrieve' | 'upload' | 'prepare' | 'fix' | 'summary';
export type PdfStageState = 'locked' | 'active' | 'complete';

export interface PdfCounts {
  prescreenIncluded: number;
  needsRetrieval: number;
  imported: number;
  needsPrep: number;
  prepared: number;
  notAvailable: number;
}

export function derivePdfCounts(steps: StepsByOperation | null): PdfCounts {
  const count = (op: string, state: string) => steps?.[op]?.state_counts?.[state] ?? 0;
  return {
    prescreenIncluded: count('pdf_get', 'rev_prescreen_included'),
    needsRetrieval: count('pdf_get', 'pdf_needs_manual_retrieval'),
    imported: count('pdf_prep', 'pdf_imported'),
    needsPrep: count('pdf_prep', 'pdf_needs_manual_preparation'),
    prepared: count('pdf_prep', 'pdf_prepared'),
    notAvailable: count('pdf_get', 'pdf_not_available'),
  };
}

export function pdfAnyActivity(counts: PdfCounts): boolean {
  return (
    counts.needsRetrieval +
      counts.imported +
      counts.prepared +
      counts.needsPrep +
      counts.notAvailable >
    0
  );
}

export function computePdfStages(
  counts: PdfCounts,
  missingOnDiskCount: number,
): Record<PdfStageId, PdfStageState> {
  if (!pdfAnyActivity(counts)) {
    return {
      retrieve: 'active',
      upload: 'locked',
      prepare: 'locked',
      fix: 'locked',
      summary: 'locked',
    };
  }
  const uploadDone = counts.needsRetrieval === 0;
  const prepareDone = uploadDone && counts.imported === 0;
  const fixDone = prepareDone && counts.needsPrep === 0;
  return {
    retrieve: 'complete',
    upload: uploadDone ? 'complete' : 'active',
    prepare: !uploadDone ? 'locked' : counts.imported === 0 ? 'complete' : 'active',
    fix: !prepareDone ? 'locked' : counts.needsPrep === 0 ? 'complete' : 'active',
    summary: !fixDone ? 'locked' : missingOnDiskCount === 0 ? 'complete' : 'active',
  };
}

export function pdfsAllDone(counts: PdfCounts, missingOnDiskCount: number): boolean {
  return (
    pdfAnyActivity(counts) &&
    counts.needsRetrieval === 0 &&
    counts.imported === 0 &&
    counts.needsPrep === 0 &&
    missingOnDiskCount === 0 &&
    counts.prepared > 0
  );
}

// ---------------------------------------------------------------------------
// Preprocessing page stage completion (load → prep → dedupe)
// ---------------------------------------------------------------------------

export interface PreprocessingStages {
  loadCompleted: boolean;
  prepCompleted: boolean;
  dedupeCompleted: boolean;
}

export function computePreprocessingStages(
  steps: StepsByOperation | null,
  totalRecords: number,
): PreprocessingStages {
  if (!steps) {
    return { loadCompleted: false, prepCompleted: false, dedupeCompleted: false };
  }
  const count = (op: string, state: string) => steps[op]?.state_counts?.[state] ?? 0;
  const loadCompleted = count('load', 'md_retrieved') === 0 && totalRecords > 0;
  // md_needs_manual_preparation is a valid prep outcome (surfaced in a
  // separate "needs attention" bucket) — only md_imported gates prep here.
  const prepCompleted = loadCompleted && count('prep', 'md_imported') === 0;
  const dedupeCompleted = prepCompleted && count('dedupe', 'md_prepared') === 0;
  return { loadCompleted, prepCompleted, dedupeCompleted };
}

// ---------------------------------------------------------------------------
// Next-step routing from the engine's next_operation
// ---------------------------------------------------------------------------

/**
 * Map the engine's `next_operation` (a pipeline operation name) to the UI
 * workflow step that hosts it, using the steps' `operations` metadata.
 */
export function stepForOperation(
  operation: string | null,
  allSteps: WorkflowStepInfo[],
): WorkflowStepInfo | null {
  if (!operation) return null;
  return allSteps.find((s) => (s.operations ?? [s.id]).includes(operation)) ?? null;
}
