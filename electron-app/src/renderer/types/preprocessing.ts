// Preprocessing pipeline type definitions

import type { SuccessResponse } from './api';

// Preprocessing stage identifiers
export type PreprocessingStageId = 'load' | 'prep' | 'dedupe';

// Status of a preprocessing stage
export type PreprocessingStageStatus = 'pending' | 'running' | 'complete' | 'error';

// Individual preprocessing stage
export interface PreprocessingStage {
  id: PreprocessingStageId;
  label: string;
  description: string;
  status: PreprocessingStageStatus;
  affectedRecords: number;
  canRun: boolean;
}

// Source information for preprocessing visualization
export interface PreprocessingSource {
  platform: string;
  filename: string;
  searchRecordCount: number;
  loadedRecordCount: number;
}

// Pipeline counts at each stage
export interface PreprocessingPipelineCounts {
  mdRetrieved: number;
  mdImported: number;
  mdPrepared: number;
  mdProcessed: number;
}

// Stage completion status
export interface PreprocessingStageStatus {
  loadCompleted: boolean;
  prepCompleted: boolean;
  dedupeCompleted: boolean;
}

// Full preprocessing summary from backend
export interface PreprocessingSummary {
  sources: PreprocessingSource[];
  pipelineCounts: PreprocessingPipelineCounts;
  duplicatesRemoved: number;
  stageStatus: {
    loadCompleted: boolean;
    prepCompleted: boolean;
    dedupeCompleted: boolean;
  };
}

// API request/response types
export interface GetPreprocessingSummaryParams {
  project_id: string;
  base_path?: string;
}

export interface GetPreprocessingSummaryResponse extends SuccessResponse {
  project_id: string;
  sources: Array<{
    platform: string;
    filename: string;
    search_record_count: number;
    loaded_record_count: number;
  }>;
  pipeline_counts: {
    md_retrieved: number;
    md_imported: number;
    md_prepared: number;
    md_processed: number;
  };
  duplicates_removed: number;
  stage_status: {
    load_completed: boolean;
    prep_completed: boolean;
    dedupe_completed: boolean;
  };
}

// Helper to convert API response to frontend model
export function mapPreprocessingSummary(
  response: GetPreprocessingSummaryResponse,
): PreprocessingSummary {
  return {
    sources: response.sources.map((s) => ({
      platform: s.platform,
      filename: s.filename,
      searchRecordCount: s.search_record_count,
      loadedRecordCount: s.loaded_record_count,
    })),
    pipelineCounts: {
      mdRetrieved: response.pipeline_counts.md_retrieved,
      mdImported: response.pipeline_counts.md_imported,
      mdPrepared: response.pipeline_counts.md_prepared,
      mdProcessed: response.pipeline_counts.md_processed,
    },
    duplicatesRemoved: response.duplicates_removed,
    stageStatus: {
      loadCompleted: response.stage_status.load_completed,
      prepCompleted: response.stage_status.prep_completed,
      dedupeCompleted: response.stage_status.dedupe_completed,
    },
  };
}
