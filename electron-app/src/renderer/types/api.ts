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
  git_status: GitStatus;
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
  search_parameters?: Record<string, unknown>;
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

// PDF Get
export interface PdfGetParams {
  project_id: string;
  base_path?: string;
}

export interface PdfGetResponse extends SuccessResponse {}

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
  abstract: string;
  pdf_path?: string;
  current_criteria?: Record<string, string>;
}

export interface ScreenCriterionDefinition {
  explanation: string;
  comment?: string;
}

export interface GetScreenQueueResponse extends SuccessResponse {
  records: ScreenQueueRecord[];
  criteria: Record<string, ScreenCriterionDefinition>;
  total_count: number;
}

export interface ScreenRecordParams {
  project_id: string;
  record_id: string;
  decision: 'include' | 'exclude';
  criteria_decisions?: Record<string, 'in' | 'out'>;
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
