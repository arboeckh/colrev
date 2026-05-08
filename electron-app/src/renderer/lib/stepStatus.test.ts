import { describe, it, expect } from 'vitest';
import { computeStepStatus } from './stepStatus';
import type { WorkflowStepInfo, RecordCounts, OverallRecordCounts } from '../types/project';

// Minimal step definitions for tests
const stepDefinition = (
  id: string,
  inputStates: string[],
  outputStates: string[],
  terminalOutputStates?: string[],
  managedReviewKind?: 'prescreen' | 'screen',
): WorkflowStepInfo =>
  ({
    id,
    label: id,
    description: '',
    route: id,
    inputStates: inputStates as (keyof RecordCounts)[],
    outputStates: outputStates as (keyof RecordCounts)[],
    terminalOutputStates: terminalOutputStates as (keyof RecordCounts)[] | undefined,
    managedReviewKind,
  }) as WorkflowStepInfo;

const REVIEW_DEFINITION = stepDefinition('review_definition', [], []);
const SEARCH = stepDefinition('search', [], ['md_retrieved']);
const PREPROCESSING = stepDefinition(
  'preprocessing',
  ['md_retrieved', 'md_imported', 'md_needs_manual_preparation', 'md_prepared'],
  ['md_processed'],
);
const PRESCREEN = stepDefinition(
  'prescreen',
  ['md_processed'],
  ['rev_prescreen_included', 'rev_prescreen_excluded'],
  ['rev_prescreen_excluded'],
  'prescreen',
);
const SCREEN = stepDefinition(
  'screen',
  ['pdf_prepared'],
  ['rev_included', 'rev_excluded'],
  ['rev_excluded'],
  'screen',
);
const DATA = stepDefinition('data', ['rev_included'], ['rev_synthesized'], ['rev_synthesized']);

const ALL_STEPS = [REVIEW_DEFINITION, SEARCH, PREPROCESSING, PRESCREEN, SCREEN, DATA];

function emptyCounts(): RecordCounts & { total: number } {
  return {
    md_retrieved: 0,
    md_imported: 0,
    md_needs_manual_preparation: 0,
    md_prepared: 0,
    md_processed: 0,
    rev_prescreen_excluded: 0,
    rev_prescreen_included: 0,
    pdf_needs_manual_retrieval: 0,
    pdf_imported: 0,
    pdf_not_available: 0,
    pdf_needs_manual_preparation: 0,
    pdf_prepared: 0,
    rev_excluded: 0,
    rev_included: 0,
    rev_synthesized: 0,
    total: 0,
  };
}

function emptyOverall(): OverallRecordCounts {
  return {
    md_retrieved: 0,
    md_imported: 0,
    md_prepared: 0,
    md_processed: 0,
    rev_prescreen_excluded: 0,
    rev_prescreen_included: 0,
    pdf_not_available: 0,
    pdf_imported: 0,
    pdf_prepared: 0,
    rev_excluded: 0,
    rev_included: 0,
    rev_synthesized: 0,
  };
}

describe('computeStepStatus', () => {
  describe('review_definition step', () => {
    it('always returns active regardless of record state', () => {
      const result = computeStepStatus(REVIEW_DEFINITION, 0, ALL_STEPS, {
        counts: null,
        overall: null,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('active');
    });
  });

  describe('search step', () => {
    it('returns active when there are no records', () => {
      const counts = { ...emptyCounts(), total: 0 };
      const result = computeStepStatus(SEARCH, 1, ALL_STEPS, {
        counts,
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('active');
    });

    it('returns active when search sources are stale', () => {
      const counts = { ...emptyCounts(), md_retrieved: 10, total: 10 };
      const overall = { ...emptyOverall(), md_retrieved: 10 };
      const result = computeStepStatus(SEARCH, 1, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: true,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('active');
    });

    it('returns complete when records exist and sources are not stale', () => {
      const counts = { ...emptyCounts(), md_retrieved: 10, total: 10 };
      const overall = { ...emptyOverall(), md_retrieved: 10 };
      const result = computeStepStatus(SEARCH, 1, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('complete');
    });

    it('returns complete when records moved past search (everProcessed > 0)', () => {
      const counts = { ...emptyCounts(), md_imported: 10, total: 10 };
      const overall = { ...emptyOverall(), md_retrieved: 10, md_imported: 10 };
      const result = computeStepStatus(SEARCH, 1, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('complete');
    });
  });

  describe('search-staleness gating', () => {
    it('downstream step shows pending when search is stale', () => {
      const counts = { ...emptyCounts(), md_retrieved: 5, total: 5 };
      const result = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts,
        overall: emptyOverall(),
        hasStaleSearchSources: true, // search is stale
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('pending');
    });

    it('downstream step shows pending when total records is zero', () => {
      const result = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts: { ...emptyCounts(), total: 0 },
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('pending');
    });
  });

  describe('processing steps', () => {
    it('returns active when step has pending records', () => {
      const counts = { ...emptyCounts(), md_retrieved: 5, total: 5 };
      const result = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts,
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('active');
    });

    it('returns complete when step has processed records and search is done', () => {
      const counts = { ...emptyCounts(), md_processed: 10, total: 10 };
      const overall = { ...emptyOverall(), md_processed: 10 };
      const result = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('complete');
    });

    it('returns complete when records moved downstream (everProcessed > 0)', () => {
      const counts = {
        ...emptyCounts(),
        rev_prescreen_included: 8,
        rev_prescreen_excluded: 2,
        total: 10,
      };
      const overall = { ...emptyOverall(), md_processed: 10 };
      const result = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('complete');
    });

    it('returns pending when no records exist', () => {
      const counts = { ...emptyCounts(), total: 10 };
      const result = computeStepStatus(DATA, 5, ALL_STEPS, {
        counts,
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('pending');
    });
  });

  describe('prior-step-pending rule', () => {
    it('shows pending (not complete) when prior step still has work', () => {
      // Preprocessing is complete but search still has md_retrieved records
      const counts = {
        ...emptyCounts(),
        md_retrieved: 3, // search still has pending input
        md_processed: 7,
        total: 10,
      };
      const overall = { ...emptyOverall(), md_processed: 7 };
      const result = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      // md_retrieved is in preprocessing's inputStates, so those 3 records ARE pending for it
      expect(result).toBe('active');
    });

    it('shows pending for later step when earlier step has pending records', () => {
      const counts = {
        ...emptyCounts(),
        md_retrieved: 3,
        rev_prescreen_included: 5,
        total: 8,
      };
      const overall = {
        ...emptyOverall(),
        md_processed: 5,
        rev_prescreen_included: 5,
      };
      const result = computeStepStatus(PRESCREEN, 3, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('pending');
    });

    it('shows complete when prior steps have no pending records', () => {
      const counts = {
        ...emptyCounts(),
        rev_prescreen_included: 8,
        rev_prescreen_excluded: 2,
        total: 10,
      };
      const overall = {
        ...emptyOverall(),
        md_processed: 10,
        rev_prescreen_included: 8,
        rev_prescreen_excluded: 2,
      };
      const result = computeStepStatus(PRESCREEN, 3, ALL_STEPS, {
        counts,
        overall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(result).toBe('complete');
    });
  });

  describe('managed-review-derived status', () => {
    it('returns managed status when provided, overriding record-based logic', () => {
      // Even with no records, managed status controls the output
      const result = computeStepStatus(PRESCREEN, 3, ALL_STEPS, {
        counts: { ...emptyCounts(), total: 10 },
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: 'active',
        suppressCounts: false,
      });
      expect(result).toBe('active');
    });

    it('returns complete from managed status', () => {
      const result = computeStepStatus(SCREEN, 4, ALL_STEPS, {
        counts: { ...emptyCounts(), total: 10 },
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: 'complete',
        suppressCounts: false,
      });
      expect(result).toBe('complete');
    });

    it('returns pending from managed status', () => {
      const result = computeStepStatus(PRESCREEN, 3, ALL_STEPS, {
        counts: { ...emptyCounts(), md_processed: 5, total: 5 },
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: 'pending',
        suppressCounts: false,
      });
      expect(result).toBe('pending');
    });
  });

  describe('suppressCounts', () => {
    it('returns pending when counts are suppressed and no managed status', () => {
      const counts = { ...emptyCounts(), pdf_prepared: 5, total: 10 };
      const result = computeStepStatus(SCREEN, 4, ALL_STEPS, {
        counts,
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: true, // suppress: counts zeroed out for status
      });
      expect(result).toBe('pending');
    });
  });

  describe('freeze-on-branch-switch', () => {
    it('returns snapshot status rather than live when frozen counts are provided', () => {
      const frozenCounts = { ...emptyCounts(), md_processed: 10, total: 10 };
      const frozenOverall = { ...emptyOverall(), md_processed: 10 };

      const resultWithFrozen = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts: frozenCounts,
        overall: frozenOverall,
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(resultWithFrozen).toBe('complete');

      const resultWithEmpty = computeStepStatus(PREPROCESSING, 2, ALL_STEPS, {
        counts: { ...emptyCounts(), total: 0 },
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(resultWithEmpty).toBe('pending');
    });

    it('returns frozen managed status during branch switch', () => {
      const resultFrozen = computeStepStatus(PRESCREEN, 3, ALL_STEPS, {
        counts: { ...emptyCounts(), total: 10 },
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: 'active',
        suppressCounts: false,
      });
      expect(resultFrozen).toBe('active');

      const resultLive = computeStepStatus(PRESCREEN, 3, ALL_STEPS, {
        counts: { ...emptyCounts(), total: 10 },
        overall: emptyOverall(),
        hasStaleSearchSources: false,
        managedStepStatus: null,
        suppressCounts: false,
      });
      expect(resultLive).toBe('pending');
    });
  });
});
