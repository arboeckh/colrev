import { describe, it, expect } from 'vitest';
import {
  canEnterReviewPhase,
  computeStepStatus,
  computeManagedStepStatus,
  computeReviewPhaseStatus,
  computePdfStages,
  derivePdfCounts,
  isReviewRoundComplete,
  pdfsAllDone,
  isReviewStepComplete,
  stepForOperation,
  stepsByOperation,
  type StepStatusContext,
  type StepsByOperation,
} from './stepStatus';
import { WORKFLOW_STEPS } from '../types/project';
import type { StatusStep, StatusStepState, WorkflowStepInfo } from '../types/project';

// ---------------------------------------------------------------------------
// Fixtures: payload steps as the engine ships them (status.steps)
// ---------------------------------------------------------------------------

const OPERATIONS = [
  'search',
  'load',
  'prep',
  'dedupe',
  'prescreen',
  'pdf_get',
  'pdf_prep',
  'screen',
  'data',
] as const;

function makeStep(operation: string, overrides: Partial<StatusStep> = {}): StatusStep {
  return {
    operation,
    state: 'locked',
    runnable: false,
    reason: null,
    needs_rerun: false,
    needs_rerun_reason: null,
    pending_records: 0,
    processed_records: 0,
    processed_ever: 0,
    input_states: [],
    output_states: [],
    state_counts: {},
    ...overrides,
  };
}

function makeSteps(
  overrides: Partial<Record<(typeof OPERATIONS)[number], Partial<StatusStep>>> = {},
): StepsByOperation {
  const map: StepsByOperation = {};
  for (const op of OPERATIONS) {
    map[op] = makeStep(op, overrides[op]);
  }
  return map;
}

function ctx(overrides: Partial<StepStatusContext> = {}): StepStatusContext {
  return {
    steps: makeSteps(),
    searchStale: false,
    totalRecords: 0,
    managedStepStatus: null,
    suppressCounts: false,
    ...overrides,
  };
}

const stepById = (id: string): WorkflowStepInfo => {
  const step = WORKFLOW_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`unknown step ${id}`);
  return step;
};

function statusFor(id: string, context: StepStatusContext) {
  const index = WORKFLOW_STEPS.findIndex((s) => s.id === id);
  return computeStepStatus(stepById(id), index, WORKFLOW_STEPS, context);
}

describe('stepsByOperation', () => {
  it('maps the payload array by operation and returns null when empty', () => {
    expect(stepsByOperation(null)).toBeNull();
    expect(stepsByOperation([])).toBeNull();
    const steps = stepsByOperation([makeStep('load', { pending_records: 2 })]);
    expect(steps?.load?.pending_records).toBe(2);
  });
});

describe('computeStepStatus', () => {
  describe('review_definition step', () => {
    it('always returns active regardless of payload', () => {
      expect(statusFor('review_definition', ctx({ steps: null }))).toBe('active');
    });
  });

  describe('search step', () => {
    it('returns active when the engine says search is not complete', () => {
      const context = ctx({
        steps: makeSteps({ search: { state: 'ready' } }),
      });
      expect(statusFor('search', context)).toBe('active');
    });

    it('returns active when search sources are stale', () => {
      // engine folds staleness into the search step state
      const context = ctx({
        steps: makeSteps({ search: { state: 'in_progress', needs_rerun: true } }),
        searchStale: true,
        totalRecords: 10,
      });
      expect(statusFor('search', context)).toBe('active');
    });

    it('returns complete when the engine says search is complete', () => {
      const context = ctx({
        steps: makeSteps({ search: { state: 'complete' } }),
        totalRecords: 10,
      });
      expect(statusFor('search', context)).toBe('complete');
    });
  });

  describe('search-staleness gating', () => {
    it('downstream step shows pending when search is stale', () => {
      const context = ctx({
        steps: makeSteps({
          search: { state: 'in_progress' },
          load: { state: 'in_progress', pending_records: 5, runnable: true },
        }),
        searchStale: true,
        totalRecords: 5,
      });
      expect(statusFor('preprocessing', context)).toBe('pending');
    });

    it('downstream step shows pending when total records is zero', () => {
      const context = ctx({ totalRecords: 0 });
      expect(statusFor('preprocessing', context)).toBe('pending');
    });
  });

  describe('processing steps', () => {
    it('returns active when any hosted operation has pending records', () => {
      const context = ctx({
        steps: makeSteps({
          search: { state: 'complete' },
          load: { state: 'in_progress', pending_records: 5 },
        }),
        totalRecords: 5,
      });
      expect(statusFor('preprocessing', context)).toBe('active');
    });

    it('returns complete when every hosted operation is complete', () => {
      const context = ctx({
        steps: makeSteps({
          search: { state: 'complete' },
          load: { state: 'complete', processed_ever: 10 },
          prep: { state: 'complete', processed_ever: 10 },
          dedupe: { state: 'complete', processed_ever: 10 },
        }),
        totalRecords: 10,
      });
      expect(statusFor('preprocessing', context)).toBe('complete');
    });

    it('returns pending when the engine reports the operation locked', () => {
      const context = ctx({
        steps: makeSteps({ data: { state: 'locked' } }),
        totalRecords: 10,
      });
      expect(statusFor('data', context)).toBe('pending');
    });

    it('returns complete when all included records are synthesized', () => {
      const context = ctx({
        steps: makeSteps({
          data: { state: 'complete', processed_ever: 4 },
        }),
        totalRecords: 4,
      });
      expect(statusFor('data', context)).toBe('complete');
    });

    it('returns active while included records still need extraction', () => {
      const context = ctx({
        steps: makeSteps({
          data: { state: 'in_progress', pending_records: 2 },
        }),
        totalRecords: 2,
      });
      expect(statusFor('data', context)).toBe('active');
    });

    it('mid-pipeline: later step not complete while earlier step pending', () => {
      // engine marks later ops locked when an earlier op is pending
      const context = ctx({
        steps: makeSteps({
          search: { state: 'complete' },
          load: { state: 'in_progress', pending_records: 3 },
          prescreen: { state: 'locked', processed_ever: 5 },
        }),
        totalRecords: 8,
      });
      expect(statusFor('prescreen', context)).toBe('pending');
    });

    it('records waiting behind an earlier pending step do not make a step active', () => {
      // engine: screen has records, but prescreen (earlier) still has pending
      const context = ctx({
        steps: makeSteps({
          search: { state: 'complete' },
          prescreen: { state: 'in_progress', pending_records: 28 },
          screen: { state: 'waiting', pending_records: 5, runnable: true },
        }),
        totalRecords: 40,
      });
      expect(statusFor('screen', context)).toBe('pending');
    });

    it('grouped pdfs step follows pdf_get/pdf_prep operations', () => {
      const active = ctx({
        steps: makeSteps({
          pdf_get: { state: 'complete', processed_ever: 8 },
          pdf_prep: { state: 'in_progress', pending_records: 3 },
        }),
        totalRecords: 8,
      });
      expect(statusFor('pdfs', active)).toBe('active');

      const complete = ctx({
        steps: makeSteps({
          pdf_get: { state: 'complete', processed_ever: 8 },
          pdf_prep: { state: 'complete', processed_ever: 8 },
        }),
        totalRecords: 8,
      });
      expect(statusFor('pdfs', complete)).toBe('complete');
    });
  });

  describe('managed-review-derived status', () => {
    it('managed status overrides payload-based logic', () => {
      const context = ctx({
        steps: makeSteps({ prescreen: { state: 'locked' } }),
        totalRecords: 10,
        managedStepStatus: 'active',
      });
      expect(statusFor('prescreen', context)).toBe('active');
    });

    it('returns complete from managed status', () => {
      expect(
        statusFor('screen', ctx({ totalRecords: 10, managedStepStatus: 'complete' })),
      ).toBe('complete');
    });

    it('returns pending from managed status even with pending records', () => {
      const context = ctx({
        steps: makeSteps({ prescreen: { state: 'in_progress', pending_records: 5 } }),
        totalRecords: 5,
        managedStepStatus: 'pending',
      });
      expect(statusFor('prescreen', context)).toBe('pending');
    });
  });

  describe('suppressCounts (reviewer branch, steps after active review)', () => {
    it('returns pending when suppressed and no managed status', () => {
      const context = ctx({
        steps: makeSteps({ screen: { state: 'in_progress', pending_records: 5 } }),
        totalRecords: 10,
        suppressCounts: true,
      });
      expect(statusFor('screen', context)).toBe('pending');
    });
  });

  describe('missing payload', () => {
    it('degrades to pending for pipeline steps and active for search', () => {
      const context = ctx({ steps: null, totalRecords: 0 });
      expect(statusFor('search', context)).toBe('active');
      expect(statusFor('preprocessing', context)).toBe('pending');
      expect(statusFor('data', context)).toBe('pending');
    });
  });
});

describe('computeManagedStepStatus', () => {
  it('active task wins', () => {
    expect(
      computeManagedStepStatus({
        hasActiveTask: true,
        hasCompletedTask: false,
        stepState: 'complete',
      }),
    ).toBe('active');
  });

  it('an active task stays in progress even while an earlier step has pending work', () => {
    expect(
      computeManagedStepStatus({
        hasActiveTask: true,
        hasCompletedTask: true,
        stepState: 'locked',
      }),
    ).toBe('active');
  });

  it('new eligible records reactivate a completed step', () => {
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: true,
        stepState: 'in_progress',
      }),
    ).toBe('active');
  });

  it('eligible records waiting behind an earlier pending step are not in progress', () => {
    // A second search batch reopened prescreen while the first batch's
    // records sit at screen: the pipeline is back at prescreen.
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: false,
        stepState: 'waiting',
      }),
    ).toBe('pending');
  });

  it('a finished round is not shown complete while new records are still upstream', () => {
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: true,
        stepState: 'locked',
      }),
    ).toBe('pending');
  });

  it('completed task with nothing eligible is complete', () => {
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: true,
        stepState: 'complete',
      }),
    ).toBe('complete');
  });

  it('no task and nothing eligible is pending', () => {
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: false,
        stepState: 'locked',
      }),
    ).toBe('pending');
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: false,
        stepState: null,
      }),
    ).toBe('pending');
  });
});

describe('isReviewRoundComplete', () => {
  it('is complete only once a task is reconciled and nothing new is eligible', () => {
    expect(
      isReviewRoundComplete({ hasActiveTask: false, hasCompletedTask: true, eligibleCount: 0 }),
    ).toBe(true);
    // A second search batch opened the next round.
    expect(
      isReviewRoundComplete({ hasActiveTask: false, hasCompletedTask: true, eligibleCount: 28 }),
    ).toBe(false);
    // The next round's task is in flight.
    expect(
      isReviewRoundComplete({ hasActiveTask: true, hasCompletedTask: true, eligibleCount: 28 }),
    ).toBe(false);
    expect(
      isReviewRoundComplete({ hasActiveTask: false, hasCompletedTask: false, eligibleCount: 0 }),
    ).toBe(false);
  });
});

describe('computeReviewPhaseStatus', () => {
  const base = {
    currentPhase: 'launch' as const,
    hasActiveTask: false,
    roundComplete: false,
    allReviewersDone: false,
    myProgressDone: null,
    onOwnBranchNothingEligible: false,
  };

  it('launch is active before any task, complete once a task exists', () => {
    expect(computeReviewPhaseStatus('launch', { ...base })).toBe('active');
    expect(
      computeReviewPhaseStatus('launch', { ...base, hasActiveTask: true }),
    ).toBe('complete');
    expect(
      computeReviewPhaseStatus('launch', { ...base, roundComplete: true }),
    ).toBe('complete');
  });

  it('a second round waiting to be launched starts over at launch', () => {
    // Round one was reconciled; a new search batch made records eligible.
    // Nothing of the new round has happened, so nothing is ticked.
    const roundTwo = { ...base, roundComplete: false };
    expect(computeReviewPhaseStatus('launch', roundTwo)).toBe('active');
    expect(computeReviewPhaseStatus('review', roundTwo)).toBe('pending');
    expect(computeReviewPhaseStatus('reconcile', roundTwo)).toBe('pending');
  });

  it('a reconciled earlier round does not tick reconcile for the round in flight', () => {
    const roundTwoLaunched = { ...base, hasActiveTask: true };
    expect(computeReviewPhaseStatus('launch', roundTwoLaunched)).toBe('complete');
    expect(computeReviewPhaseStatus('reconcile', roundTwoLaunched)).toBe('pending');
    expect(
      computeReviewPhaseStatus('reconcile', { ...roundTwoLaunched, allReviewersDone: true }),
    ).toBe('pending');
  });

  it('review is complete when all reviewers are done', () => {
    expect(
      computeReviewPhaseStatus('review', {
        ...base,
        hasActiveTask: true,
        allReviewersDone: true,
      }),
    ).toBe('complete');
  });

  it('review is complete for the user who finished their part (committed)', () => {
    expect(
      computeReviewPhaseStatus('review', {
        ...base,
        hasActiveTask: true,
        myProgressDone: true,
      }),
    ).toBe('complete');
  });

  it('review is complete on own branch with nothing eligible (uncommitted)', () => {
    expect(
      computeReviewPhaseStatus('review', {
        ...base,
        hasActiveTask: true,
        onOwnBranchNothingEligible: true,
      }),
    ).toBe('complete');
  });

  it('review is active only when it is the current phase', () => {
    expect(
      computeReviewPhaseStatus('review', {
        ...base,
        hasActiveTask: true,
        currentPhase: 'review',
      }),
    ).toBe('active');
    expect(
      computeReviewPhaseStatus('review', { ...base, hasActiveTask: true }),
    ).toBe('pending');
  });

  it('reconcile activates only when all reviewers done and phase selected', () => {
    expect(
      computeReviewPhaseStatus('reconcile', {
        ...base,
        hasActiveTask: true,
        allReviewersDone: true,
        currentPhase: 'reconcile',
      }),
    ).toBe('active');
    expect(
      computeReviewPhaseStatus('reconcile', {
        ...base,
        hasActiveTask: true,
        allReviewersDone: true,
      }),
    ).toBe('pending');
    expect(
      computeReviewPhaseStatus('reconcile', { ...base, roundComplete: true }),
    ).toBe('complete');
  });
});

describe('canEnterReviewPhase', () => {
  const none = { hasActiveTask: false, roundComplete: false, reconcileGateOpen: true };

  it('launch is always reachable', () => {
    expect(canEnterReviewPhase('launch', none)).toBe(true);
  });

  it('review needs a task in flight, or a finished round to look back on', () => {
    expect(canEnterReviewPhase('review', none)).toBe(false);
    expect(canEnterReviewPhase('review', { ...none, hasActiveTask: true })).toBe(true);
    expect(canEnterReviewPhase('review', { ...none, roundComplete: true })).toBe(true);
  });

  it('reconcile of a round in flight waits for the user’s work to be shared', () => {
    const inFlight = { ...none, hasActiveTask: true };
    expect(canEnterReviewPhase('reconcile', inFlight)).toBe(true);
    expect(canEnterReviewPhase('reconcile', { ...inFlight, reconcileGateOpen: false })).toBe(false);
  });

  it('an earlier reconciled round does not open reconcile past the gate', () => {
    // Before: any completed task made reconcile clickable, so a reviewer with
    // unsaved decisions could head there — straight into the save-or-discard
    // dialog, whose save never pushed.
    expect(canEnterReviewPhase('reconcile', none)).toBe(false);
    expect(
      canEnterReviewPhase('reconcile', { ...none, hasActiveTask: true, reconcileGateOpen: false }),
    ).toBe(false);
    expect(canEnterReviewPhase('reconcile', { ...none, roundComplete: true })).toBe(true);
  });
});

describe('isReviewStepComplete', () => {
  it('requires zero pending and at least one decided record', () => {
    expect(isReviewStepComplete(undefined)).toBe(false);
    expect(isReviewStepComplete(makeStep('prescreen'))).toBe(false);
    expect(
      isReviewStepComplete(
        makeStep('prescreen', { pending_records: 2, processed_records: 3 }),
      ),
    ).toBe(false);
    expect(
      isReviewStepComplete(
        makeStep('prescreen', { pending_records: 0, processed_records: 3 }),
      ),
    ).toBe(true);
  });
});

describe('PDF stage machine', () => {
  function pdfSteps(counts: {
    prescreenIncluded?: number;
    needsRetrieval?: number;
    notAvailable?: number;
    imported?: number;
    needsPrep?: number;
    prepared?: number;
  }): StepsByOperation {
    return makeSteps({
      pdf_get: {
        state_counts: {
          rev_prescreen_included: counts.prescreenIncluded ?? 0,
          pdf_needs_manual_retrieval: counts.needsRetrieval ?? 0,
          pdf_not_available: counts.notAvailable ?? 0,
          pdf_imported: counts.imported ?? 0,
        },
      },
      pdf_prep: {
        state_counts: {
          pdf_imported: counts.imported ?? 0,
          pdf_needs_manual_preparation: counts.needsPrep ?? 0,
          pdf_prepared: counts.prepared ?? 0,
        },
      },
    });
  }

  it('derives counts from the payload state_counts', () => {
    const counts = derivePdfCounts(
      pdfSteps({ prescreenIncluded: 4, needsRetrieval: 2, prepared: 1 }),
    );
    expect(counts.prescreenIncluded).toBe(4);
    expect(counts.needsRetrieval).toBe(2);
    expect(counts.prepared).toBe(1);
  });

  it('no activity: only retrieve is active', () => {
    const stages = computePdfStages(
      derivePdfCounts(pdfSteps({ prescreenIncluded: 5 })),
      0,
    );
    expect(stages).toEqual({
      retrieve: 'active',
      upload: 'locked',
      prepare: 'locked',
      fix: 'locked',
      summary: 'locked',
    });
  });

  it('needs-retrieval records activate upload', () => {
    const stages = computePdfStages(
      derivePdfCounts(pdfSteps({ needsRetrieval: 3, imported: 1 })),
      0,
    );
    expect(stages.retrieve).toBe('complete');
    expect(stages.upload).toBe('active');
    expect(stages.prepare).toBe('locked');
  });

  it('imported records activate prepare once upload is done', () => {
    const stages = computePdfStages(derivePdfCounts(pdfSteps({ imported: 2 })), 0);
    expect(stages.upload).toBe('complete');
    expect(stages.prepare).toBe('active');
    expect(stages.fix).toBe('locked');
  });

  it('defect records activate fix; missing files gate the summary', () => {
    const withDefects = computePdfStages(
      derivePdfCounts(pdfSteps({ needsPrep: 2, prepared: 1 })),
      0,
    );
    expect(withDefects.fix).toBe('active');

    const withMissing = computePdfStages(
      derivePdfCounts(pdfSteps({ prepared: 3 })),
      2,
    );
    expect(withMissing.summary).toBe('active');

    const done = computePdfStages(derivePdfCounts(pdfSteps({ prepared: 3 })), 0);
    expect(done.summary).toBe('complete');
  });

  it('pdfsAllDone requires prepared records and no leftovers', () => {
    expect(pdfsAllDone(derivePdfCounts(pdfSteps({ prepared: 3 })), 0)).toBe(true);
    expect(pdfsAllDone(derivePdfCounts(pdfSteps({ prepared: 3 })), 1)).toBe(false);
    expect(
      pdfsAllDone(derivePdfCounts(pdfSteps({ prepared: 3, needsRetrieval: 1 })), 0),
    ).toBe(false);
    expect(pdfsAllDone(derivePdfCounts(pdfSteps({})), 0)).toBe(false);
  });
});

describe('stepForOperation', () => {
  it('maps engine operations to their hosting UI step', () => {
    expect(stepForOperation('load', WORKFLOW_STEPS)?.id).toBe('preprocessing');
    expect(stepForOperation('prep', WORKFLOW_STEPS)?.id).toBe('preprocessing');
    expect(stepForOperation('dedupe', WORKFLOW_STEPS)?.id).toBe('preprocessing');
    expect(stepForOperation('pdf_get', WORKFLOW_STEPS)?.id).toBe('pdfs');
    expect(stepForOperation('pdf_prep', WORKFLOW_STEPS)?.id).toBe('pdfs');
    expect(stepForOperation('prescreen', WORKFLOW_STEPS)?.id).toBe('prescreen');
    expect(stepForOperation('data', WORKFLOW_STEPS)?.id).toBe('data');
    expect(stepForOperation(null, WORKFLOW_STEPS)).toBeNull();
  });
});

describe('agreement by construction', () => {
  it('sidebar status, page completion, and stepper all read the same payload step', () => {
    // One payload where prescreen is finished.
    const steps = makeSteps({
      search: { state: 'complete' },
      load: { state: 'complete', processed_ever: 10 },
      prep: { state: 'complete', processed_ever: 10 },
      dedupe: { state: 'complete', processed_ever: 10 },
      prescreen: {
        state: 'complete',
        pending_records: 0,
        processed_records: 10,
        processed_ever: 10,
      },
    });
    const context = ctx({ steps, totalRecords: 10 });

    // Sidebar verdict...
    expect(statusFor('prescreen', context)).toBe('complete');
    // ...page completion verdict...
    expect(isReviewStepComplete(steps.prescreen)).toBe(true);
    // ...and managed-review sidebar verdict cannot disagree because it reads
    // the same engine state.
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: true,
        stepState: steps.prescreen.state,
      }),
    ).toBe('complete');
  });

  it('a step with pending work is active everywhere', () => {
    const steps = makeSteps({
      search: { state: 'complete' },
      prescreen: {
        state: 'in_progress',
        pending_records: 4,
        processed_records: 6,
        processed_ever: 6,
      },
    });
    const context = ctx({ steps, totalRecords: 10 });

    expect(statusFor('prescreen', context)).toBe('active');
    expect(isReviewStepComplete(steps.prescreen)).toBe(false);
    expect(
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: true,
        stepState: steps.prescreen.state,
      }),
    ).toBe('active');
  });

  it('a second search batch puts the whole pipeline back at prescreen', () => {
    // The engine payload after round one (prescreen reconciled, PDFs
    // prepared) plus a new batch preprocessed: prescreen has pending records,
    // and so does screen, from round one.
    const steps = makeSteps({
      search: { state: 'complete' },
      load: { state: 'complete', processed_ever: 40 },
      prep: { state: 'complete', processed_ever: 40 },
      dedupe: { state: 'complete', processed_ever: 40 },
      prescreen: { state: 'in_progress', pending_records: 28, processed_ever: 12 },
      pdf_get: { state: 'locked', processed_ever: 5 },
      pdf_prep: { state: 'locked', processed_ever: 5 },
      screen: { state: 'waiting', pending_records: 5, runnable: true },
      data: { state: 'locked' },
    });
    const context = ctx({ steps, totalRecords: 40 });
    const managed = (kind: 'prescreen' | 'screen') =>
      computeManagedStepStatus({
        hasActiveTask: false,
        hasCompletedTask: kind === 'prescreen',
        stepState: steps[kind].state,
      });

    expect(statusFor('search', context)).toBe('complete');
    expect(statusFor('preprocessing', context)).toBe('complete');
    expect(statusFor('prescreen', ctx({ steps, totalRecords: 40, managedStepStatus: managed('prescreen') }))).toBe('active');
    expect(statusFor('pdfs', context)).toBe('pending');
    expect(statusFor('screen', ctx({ steps, totalRecords: 40, managedStepStatus: managed('screen') }))).toBe('pending');
    expect(statusFor('data', context)).toBe('pending');
  });
});

describe('every WORKFLOW_STEPS operation exists in the payload contract', () => {
  it('operations metadata only references engine operations', () => {
    const engineOps = new Set<string>(OPERATIONS);
    for (const step of WORKFLOW_STEPS) {
      for (const op of step.operations ?? []) {
        expect(engineOps.has(op)).toBe(true);
      }
    }
  });
});
