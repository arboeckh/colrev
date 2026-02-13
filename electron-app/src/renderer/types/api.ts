// JSON-RPC API type definitions

import type { GitStatus, ProjectStatus, Record, SearchSource, ProjectSettings } from './project';

// Base response types
export interface SuccessResponse {
  success: boolean;
  message?: string;
}

// Ping
export interface PingResponse {
  status: 'pong';
}

// List Projects
export interface ListProjectsParams {
  base_path?: string;
}

export interface ListProjectsResponse extends SuccessResponse {
  projects: Array<{
    id: string;
    path: string;
    title?: string;
  }>;
}

// Delete Project
export interface DeleteProjectParams {
  project_id: string;
  base_path?: string;
}

export interface DeleteProjectResponse extends SuccessResponse {
  project_id: string;
}

// Init Project
export interface InitProjectParams {
  project_id: string;
  title?: string;
  review_type?: string;
  example?: boolean;
  force_mode?: boolean;
  light?: boolean;
  base_path?: string;
}

export interface InitProjectResponse extends SuccessResponse {
  project_id: string;
  path: string;
  review_type: string;
}

// Status
export interface GetStatusParams {
  project_id: string;
  base_path?: string;
}

export interface GetStatusResponse extends SuccessResponse {
  project_id: string;
  path: string;
  status: ProjectStatus;
}

// Git Status
export interface GetGitStatusParams {
  project_id: string;
  base_path?: string;
}

export interface GetGitStatusResponse extends SuccessResponse {
  project_id: string;
  git: GitStatus;
}

// Settings
export interface GetSettingsParams {
  project_id: string;
  base_path?: string;
}

export interface GetSettingsResponse extends SuccessResponse {
  project_id: string;
  settings: ProjectSettings;
}

export interface UpdateSettingsParams {
  project_id: string;
  settings: Partial<ProjectSettings>;
  skip_commit?: boolean;
  base_path?: string;
}

export interface UpdateSettingsResponse extends SuccessResponse {
  updated_fields: string[];
}

// Records
export interface GetRecordsParams {
  project_id: string;
  base_path?: string;
  filters?: {
    status?: string | string[];
    search_source?: string;
    entrytype?: string;
    search_text?: string;
    has_pdf?: boolean;
    year_from?: number;
    year_to?: number;
  };
  sort?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  pagination?: {
    offset: number;
    limit: number;
  };
  fields?: string[];
}

export interface GetRecordsResponse extends SuccessResponse {
  records: Record[];
  total_count: number;
  pagination: {
    offset: number;
    limit: number;
    has_more: boolean;
  };
}

export interface GetRecordParams {
  project_id: string;
  record_id: string;
  base_path?: string;
}

export interface GetRecordResponse extends SuccessResponse {
  record: Record;
}

export interface UpdateRecordParams {
  project_id: string;
  record_id: string;
  fields: Partial<Record>;
  skip_commit?: boolean;
  base_path?: string;
}

export interface UpdateRecordResponse extends SuccessResponse {
  record: Record;
}

// Search
export interface GetSourcesParams {
  project_id: string;
  base_path?: string;
}

export interface GetSourcesResponse extends SuccessResponse {
  sources: SearchSource[];
}

export interface AddSourceParams {
  project_id: string;
  endpoint: string;
  search_type: string;
  search_string?: string;
  filename?: string;
  skip_commit?: boolean;
  base_path?: string;
}

export interface AddSourceResponse extends SuccessResponse {
  source: SearchSource;
}

export interface UploadSearchFileParams {
  project_id: string;
  filename: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  base_path?: string;
}

export interface UploadSearchFileResponse extends SuccessResponse {
  path: string;
  detected_format: string;
}

export interface SearchParams {
  project_id: string;
  source?: string;
  rerun?: boolean;
  skip_commit?: boolean;
  base_path?: string;
}

export interface SearchResponse extends SuccessResponse {
  source: string;
  rerun: boolean;
}

// Remove Source
export interface RemoveSourceParams {
  project_id: string;
  filename: string;
  delete_file?: boolean;
  skip_commit?: boolean;
  base_path?: string;
}

export interface RemoveSourceResponse extends SuccessResponse {
  message: string;
}

// Update Source
export interface UpdateSourceParams {
  project_id: string;
  filename: string;
  search_string?: string;
  search_parameters?: globalThis.Record<string, unknown>;
  skip_commit?: boolean;
  base_path?: string;
}

export interface UpdateSourceResponse extends SuccessResponse {
  source: SearchSource;
  message: string;
}

// Get Source Records
export interface GetSourceRecordsParams {
  project_id: string;
  filename: string;
  pagination?: {
    offset: number;
    limit: number;
  };
  base_path?: string;
}

export interface SourceRecord {
  ID: string;
  ENTRYTYPE: string;
  title: string;
  author: string;
  year: string;
  journal?: string;
  booktitle?: string;
  doi?: string;
  abstract?: string;
  colrev_status?: string;
}

export interface GetSourceRecordsResponse extends SuccessResponse {
  filename: string;
  records: SourceRecord[];
  total_count: number;
  pagination: {
    offset: number;
    limit: number;
    has_more: boolean;
  };
}

// Load
export interface LoadParams {
  project_id: string;
  keep_ids?: boolean;
  base_path?: string;
}

export interface LoadResponse extends SuccessResponse {
  keep_ids: boolean;
}

// Prep
export interface PrepParams {
  project_id: string;
  base_path?: string;
}

export interface PrepResponse extends SuccessResponse {}

// Dedupe
export interface DedupeParams {
  project_id: string;
  base_path?: string;
}

export interface DedupeResponse extends SuccessResponse {}

// Prescreen
export interface GetPrescreenQueueParams {
  project_id: string;
  limit?: number;
  base_path?: string;
}

export interface PrescreenQueueRecord {
  id: string;
  title: string;
  author: string;
  year: string;
  abstract?: string;
  journal?: string;
  booktitle?: string;
  doi?: string;
  pubmedid?: string;
  can_enrich?: boolean;
}

export interface GetPrescreenQueueResponse extends SuccessResponse {
  records: PrescreenQueueRecord[];
  total_count: number;
}

export interface PrescreenRecordParams {
  project_id: string;
  record_id: string;
  decision: 'include' | 'exclude';
  skip_commit?: boolean;
  base_path?: string;
}

export interface PrescreenRecordResponse extends SuccessResponse {
  record: Record;
  remaining_count: number;
}

export interface PrescreenParams {
  project_id: string;
  split_str?: string;
  base_path?: string;
}

export interface PrescreenResponse extends SuccessResponse {
  split_str: string;
}

// Enrich Record Metadata
export interface EnrichRecordMetadataParams {
  project_id: string;
  record_id: string;
  fields?: string[];
  skip_commit?: boolean;
  base_path?: string;
}

export interface EnrichRecordMetadataResponse extends SuccessResponse {
  record: PrescreenQueueRecord;
  enriched_fields: string[];
  source?: string;
}

// Batch Enrich Records
export interface BatchEnrichRecordsParams {
  project_id: string;
  record_ids: string[];
  fields?: string[];
  skip_commit?: boolean;
  base_path?: string;
}

export interface BatchEnrichRecordResult {
  id: string;
  success: boolean;
  enriched_fields?: string[];
  source?: string;
  record?: PrescreenQueueRecord;
  error?: string;
  message?: string;
}

export interface BatchEnrichRecordsResponse extends SuccessResponse {
  enriched_count: number;
  failed_count: number;
  records: BatchEnrichRecordResult[];
}

// Update Prescreen Decisions
export interface UpdatePrescreenDecisionsParams {
  project_id: string;
  changes: Array<{
    record_id: string;
    decision: 'include' | 'exclude';
  }>;
  base_path?: string;
}

export interface UpdatePrescreenDecisionsResponse extends SuccessResponse {
  changes_count: number;
  skipped: Array<{
    record_id: string;
    reason: string;
  }>;
  updated_records: string[];
}

// PDF Get
export interface PdfGetParams {
  project_id: string;
  base_path?: string;
}

export interface PdfGetResponse extends SuccessResponse {}

// Upload PDF
export interface UploadPdfParams {
  project_id: string;
  record_id: string;
  filename: string;
  content: string;
  skip_commit?: boolean;
  base_path?: string;
}

export interface UploadPdfResponse extends SuccessResponse {
  record_id: string;
  file_path: string;
  new_status: string;
  prep_status?: string;
  prep_message?: string;
}

// Match PDF to Records
export interface MatchCandidate {
  record_id: string;
  similarity: number;
  title: string;
  author: string;
  year: string;
}

export interface MatchPdfToRecordsResponse extends SuccessResponse {
  filename: string;
  extraction_method: 'pdf_metadata' | 'filename_only' | 'none';
  extracted_metadata: {
    title?: string;
    author?: string;
    year?: string;
    doi?: string;
    journal?: string;
    booktitle?: string;
  } | null;
  matches: MatchCandidate[];
  best_match: { record_id: string; similarity: number } | null;
}

// Mark PDF Not Available
export interface MarkPdfNotAvailableParams {
  project_id: string;
  record_id: string;
  skip_commit?: boolean;
  base_path?: string;
}

export interface MarkPdfNotAvailableResponse extends SuccessResponse {
  record_id: string;
  new_status: string;
}

// PDF Prep
export interface PdfPrepParams {
  project_id: string;
  reprocess?: boolean;
  batch_size?: number;
  base_path?: string;
}

export interface PdfPrepResponse extends SuccessResponse {
  reprocess: boolean;
  batch_size: number;
}

// Screen
export interface GetScreenQueueParams {
  project_id: string;
  limit?: number;
  base_path?: string;
}

export interface ScreenQueueRecord {
  id: string;
  title: string;
  author: string;
  year: string;
  abstract?: string;
  journal?: string;
  booktitle?: string;
  pdf_path?: string;
  current_criteria?: globalThis.Record<string, string>;
}

export interface ScreenCriterionDefinition {
  explanation: string;
  comment?: string;
  criterion_type?: 'inclusion_criterion' | 'exclusion_criterion';
}

export interface GetScreenQueueResponse extends SuccessResponse {
  records: ScreenQueueRecord[];
  criteria: globalThis.Record<string, ScreenCriterionDefinition>;
  total_count: number;
}

export interface ScreenRecordParams {
  project_id: string;
  record_id: string;
  decision: 'include' | 'exclude';
  criteria_decisions?: globalThis.Record<string, 'in' | 'out'>;
  skip_commit?: boolean;
  base_path?: string;
}

export interface ScreenRecordResponse extends SuccessResponse {
  record: Record;
  remaining_count: number;
}

export interface ScreenParams {
  project_id: string;
  split_str?: string;
  base_path?: string;
}

export interface ScreenResponse extends SuccessResponse {
  split_str: string;
}

// Data
export interface DataParams {
  project_id: string;
  base_path?: string;
}

export interface DataResponse extends SuccessResponse {}

// Data Extraction
export interface DataField {
  name: string;
  explanation: string;
  data_type: 'str' | 'int' | 'double' | 'select' | 'multi_select';
  options?: string[];
  optional?: boolean;
}

export interface DataExtractionRecord {
  id: string;
  title: string;
  author: string;
  year: string;
  journal?: string;
  booktitle?: string;
  pdf_path?: string;
  extraction_values: globalThis.Record<string, string>;
}

export interface GetDataExtractionQueueResponse extends SuccessResponse {
  configured: boolean;
  fields: DataField[];
  records: DataExtractionRecord[];
  total_count: number;
  completed_count: number;
}

export interface SaveDataExtractionResponse extends SuccessResponse {
  record_id: string;
  remaining_count: number;
}

export interface ConfigureStructuredEndpointResponse extends SuccessResponse {
  fields: DataField[];
}

// Prep Man Update Record
export interface PrepManUpdateRecordResponse extends SuccessResponse {
  operation: string;
  project_id: string;
  details: {
    record: Record;
    new_status: string;
    remaining_defects?: globalThis.Record<string, string[]>;
    message: string;
  };
}

// Review Definition
export interface GetReviewDefinitionParams {
  project_id: string;
  base_path?: string;
}

export interface ReviewDefinitionData {
  review_type: string;
  title: string;
  protocol_url: string;
  keywords: string[];
  objectives: string;
  criteria: globalThis.Record<string, ScreenCriterionDefinition>;
}

export interface GetReviewDefinitionResponse extends SuccessResponse {
  project_id: string;
  review_type: string;
  title: string;
  protocol_url: string;
  keywords: string[];
  objectives: string;
  criteria: globalThis.Record<string, ScreenCriterionDefinition>;
}

export interface UpdateReviewDefinitionParams {
  project_id: string;
  protocol_url?: string;
  keywords?: string[];
  objectives?: string;
  skip_commit?: boolean;
  base_path?: string;
}

export interface UpdateReviewDefinitionResponse extends SuccessResponse {
  updated_fields: string[];
}

export interface AddScreeningCriterionParams {
  project_id: string;
  name: string;
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
  skip_commit?: boolean;
  base_path?: string;
}

export interface AddScreeningCriterionResponse extends SuccessResponse {
  criterion_name: string;
}

export interface UpdateScreeningCriterionParams {
  project_id: string;
  criterion_name: string;
  explanation?: string;
  comment?: string;
  criterion_type?: 'inclusion_criterion' | 'exclusion_criterion';
  skip_commit?: boolean;
  base_path?: string;
}

export interface UpdateScreeningCriterionResponse extends SuccessResponse {
  criterion_name: string;
}

export interface RemoveScreeningCriterionParams {
  project_id: string;
  criterion_name: string;
  skip_commit?: boolean;
  base_path?: string;
}

export interface RemoveScreeningCriterionResponse extends SuccessResponse {
  criterion_name: string;
}

// Update Screen Decisions
export interface UpdateScreenDecisionsParams {
  project_id: string;
  changes: Array<{
    record_id: string;
    decision: 'include' | 'exclude';
  }>;
  base_path?: string;
}

export interface UpdateScreenDecisionsResponse extends SuccessResponse {
  changes_count: number;
  skipped: Array<{
    record_id: string;
    reason: string;
  }>;
  updated_records: string[];
}

// Include All Screen
export interface IncludeAllScreenParams {
  project_id: string;
  skip_commit?: boolean;
  base_path?: string;
}

export interface IncludeAllScreenResponse extends SuccessResponse {}

// Operation Info
export interface GetOperationInfoParams {
  project_id: string;
  operation: 'search' | 'load' | 'prep' | 'dedupe' | 'prescreen' | 'pdf_get' | 'pdf_prep' | 'screen' | 'data';
  base_path?: string;
}

export interface GetOperationInfoResponse extends SuccessResponse {
  operation: string;
  can_run: boolean;
  reason?: string;
  needs_rerun: boolean;
  needs_rerun_reason?: string;
  affected_records: number;
  description: string;
}

// Validate
export interface ValidateParams {
  project_id: string;
  scope?: 'HEAD' | 'all' | string;
  filter_setting?: 'general' | 'prep' | string;
  base_path?: string;
}

export interface ValidateResponse extends SuccessResponse {
  message: string;
  details?: unknown;
}
