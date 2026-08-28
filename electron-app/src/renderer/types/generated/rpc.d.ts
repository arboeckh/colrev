/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate via `npm run gen-types:full` after backend handler changes.
 * Source: src/renderer/types/generated/rpc-schemas.json
 */
/**
 * Top-level discriminator for structured progress events (Phase E).
 */
export type ProgressEventKind =
  | "search_progress"
  | "load_progress"
  | "prep_progress"
  | "dedupe_progress"
  | "pdf_get_progress"
  | "pdf_prep_progress"
  | "generic";

/**
 * Structured progress event emitted by long-running handlers.
 *
 * Emitted as a JSON-RPC notification on stdout (no ``id`` field). The
 * frontend subscribes via ``window.colrev.onProgress`` (Phase E) instead
 * of regex-parsing stderr.
 *
 * ``kind`` discriminates event type; ``details`` carries kind-specific
 * data (``extra="allow"`` lets handlers attach arbitrary structured
 * context without a schema change).
 */

export interface ProgressEvent {
  current?: number | null;
  kind: ProgressEventKind;
  level?: "info" | "warning" | "error";
  message: string;
  source?: string | null;
  total?: number | null;
  [k: string]: unknown;
}

export type RecordStateName =
  | "md_retrieved"
  | "md_imported"
  | "md_needs_manual_preparation"
  | "md_prepared"
  | "md_processed"
  | "rev_prescreen_excluded"
  | "rev_prescreen_included"
  | "pdf_needs_manual_retrieval"
  | "pdf_imported"
  | "pdf_not_available"
  | "pdf_needs_manual_preparation"
  | "pdf_prepared"
  | "rev_excluded"
  | "rev_included"
  | "rev_synthesized";

/**
 * A CoLRev record as returned over JSON-RPC.
 *
 * Known fields are typed. Additional bib fields (author, journal, doi,
 * pubmedid, abstract, etc.) pass through via ``extra="allow"``. The
 * frontend still gets IntelliSense on the known subset without losing
 * the ability to render arbitrary metadata.
 */

export interface RecordPayload {
  ENTRYTYPE?: string;
  ID: string;
  colrev_status?: RecordStateName | null;
  [k: string]: unknown;
}

/**
 * Lightweight record view used by queue endpoints.
 *
 * Used by ``get_prescreen_queue``, ``get_screen_queue``, and similar —
 * where the frontend needs just enough to render a list item. Extra
 * fields are allowed so endpoints can tack on e.g. ``pdf_path`` or
 * ``current_criteria`` without a schema change.
 */
export interface RecordSummary {
  author?: string;
  id: string;
  title?: string;
  year?: string;
  [k: string]: unknown;
}

export interface AddScreeningCriterionRequest {
  base_path?: string | null;
  comment?: string | null;
  criterion_type: string;
  explanation: string;
  name: string;
  project_id: string;
  verbose?: boolean;
}

export interface AddScreeningCriterionResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface AddSourceRequest {
  base_path?: string | null;
  endpoint?: string | null;
  filename?: string | null;
  project_id: string;
  run_date?: string | null;
  search_parameters?: {
    [k: string]: unknown;
  } | null;
  search_string?: string;
  search_type?: string | null;
  verbose?: boolean;
}

export interface AddSourceResponse {
  details: AddSourceDetails;
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface AddSourceDetails {
  message: string;
  source: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface ApplyReconciliationRequest {
  base_path?: string | null;
  override_blocks?: boolean;
  project_id: string;
  resolutions?: unknown[];
  resolved_by?: string;
  task_id: string;
  verbose?: boolean;
}

export interface ApplyReconciliationResponse {
  commit_sha: string;
  project_id: string;
  resolved_count: number;
  success?: true;
  task_id: string;
  [k: string]: unknown;
}

export interface BatchEnrichRecordsRequest {
  base_path?: string | null;
  fields?: string[] | null;
  project_id: string;
  record_ids: string[];
  verbose?: boolean;
}

export interface BatchEnrichRecordsResponse {
  enriched_count: number;
  failed_count: number;
  project_id: string;
  records: BatchEnrichItem[];
  success?: true;
  [k: string]: unknown;
}

export interface BatchEnrichItem {
  enriched_fields?: string[] | null;
  error?: string | null;
  id: string;
  message?: string | null;
  record?: PrescreenQueueRecord | null;
  source?: string | null;
  success: boolean;
  [k: string]: unknown;
}

export interface PrescreenQueueRecord {
  abstract?: string | null;
  author?: string;
  booktitle?: string | null;
  can_enrich?: boolean;
  doi?: string | null;
  id: string;
  journal?: string | null;
  pubmedid?: string | null;
  title?: string;
  year?: string;
  [k: string]: unknown;
}

export interface CancelManagedReviewTaskRequest {
  base_path?: string | null;
  canceled_by?: string;
  project_id: string;
  task_id: string;
  verbose?: boolean;
}

export interface CancelManagedReviewTaskResponse {
  project_id: string;
  success?: true;
  task: ManagedReviewTask;
  [k: string]: unknown;
}

export interface ManagedReviewTask {
  base_branch: string;
  base_commit: string;
  canceled_at?: string | null;
  canceled_by?: string | null;
  completed_at?: string | null;
  created_at: string;
  created_by: string;
  eligible_state: string;
  id: string;
  kind: "prescreen" | "screen";
  mode: string;
  reconciliation_summary?: ManagedReviewReconciliationSummary | null;
  record_count: number;
  record_ids: string[];
  reviewer_progress: ManagedReviewReviewerProgress[];
  reviewers: ManagedReviewReviewer[];
  state: "active" | "reconciling" | "completed" | "aborted";
  [k: string]: unknown;
}

export interface ManagedReviewReconciliationSummary {
  auto_resolved_count: number;
  manual_conflict_count: number;
  record_count: number;
  resolved_at: string;
  resolved_by: string;
  [k: string]: unknown;
}

export interface ManagedReviewReviewerProgress {
  available: boolean;
  branch_name: string;
  branch_ref?: string | null;
  completed_count: number;
  github_login: string;
  last_seen_commit?: string | null;
  pending_count: number;
  role: "reviewer_a" | "reviewer_b";
  [k: string]: unknown;
}

export interface ManagedReviewReviewer {
  branch_name: string;
  github_login: string;
  last_seen_commit?: string | null;
  role: "reviewer_a" | "reviewer_b";
  [k: string]: unknown;
}

export interface CommitChangesRequest {
  base_path?: string | null;
  message: string;
  project_id: string;
  verbose?: boolean;
}

export interface CommitChangesResponse {
  changed_files?: string[];
  commit_sha?: string | null;
  committed: boolean;
  message: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface ConfigureStructuredEndpointRequest {
  base_path?: string | null;
  fields: StructuredFieldSpec[];
  project_id: string;
  verbose?: boolean;
}
/**
 * Field spec accepted by ``configure_structured_endpoint``. Mirrors
 * ``FieldDefinition`` (the read-side shape) so the renderer can round-trip
 * fields from ``get_data_extraction_queue`` without casts.
 */

export interface StructuredFieldSpec {
  data_type?: string;
  explanation?: string;
  name: string;
  optional?: boolean | null;
  options?: unknown[] | null;
  [k: string]: unknown;
}

export interface ConfigureStructuredEndpointResponse {
  fields: {
    [k: string]: unknown;
  }[];
  message: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface CreateManagedReviewTaskRequest {
  base_path?: string | null;
  created_by?: string;
  kind: "prescreen" | "screen";
  project_id: string;
  reviewer_logins: string[];
  verbose?: boolean;
}

export interface CreateManagedReviewTaskResponse {
  enriched_count: number;
  enrichment_failed_count: number;
  enrichment_skipped_count: number;
  launch_ref: string;
  project_id: string;
  success?: true;
  task: ManagedReviewTask;
  [k: string]: unknown;
}

export interface DataRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface DataResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface DedupeRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface DedupeResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface DeleteProjectRequest {
  base_path?: string;
  project_id: string;
}

export interface DeleteProjectResponse {
  message: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface DiscardChangesRequest {
  base_path?: string | null;
  confirm?: boolean;
  paths?: string[] | null;
  project_id: string;
  verbose?: boolean;
}

export interface DiscardChangesResponse {
  discarded_files?: string[];
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface EnrichRecordMetadataRequest {
  base_path?: string | null;
  fields?: string[] | null;
  project_id: string;
  record_id: string;
  verbose?: boolean;
}

export interface EnrichRecordMetadataResponse {
  enriched_fields: string[];
  message?: string | null;
  project_id: string;
  record: PrescreenQueueRecord;
  source?: string | null;
  success?: true;
  [k: string]: unknown;
}

export interface ExportDataCsvRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface ExportDataCsvResponse {
  csv_content: string;
  filename: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface ExportPdfsRequest {
  base_path?: string | null;
  output_path: string;
  project_id: string;
  verbose?: boolean;
}

export interface ExportPdfsResponse {
  file_count: number;
  path: string;
  project_id: string;
  success?: true;
  total_bytes: number;
  [k: string]: unknown;
}

export interface ExportReconciliationAuditRequest {
  base_path?: string | null;
  format: string;
  project_id: string;
  task_id: string;
  verbose?: boolean;
}

export interface ExportReconciliationAuditResponse {
  content: string;
  filename: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface GetBranchDeltaRequest {
  base_branch?: string;
  base_path?: string | null;
  project_id: string;
  source_branch?: string | null;
  verbose?: boolean;
}

export interface GetBranchDeltaResponse {
  base_branch: string;
  changed_record_count: number;
  current_branch: string;
  delta_by_state: {
    [k: string]: number;
  };
  new_record_count: number;
  project_id: string;
  removed_record_count: number;
  source_branch: string;
  source_branch_counts: {
    [k: string]: number;
  };
  success?: true;
  [k: string]: unknown;
}

export interface GetConnectorApiKeyStatusRequest {
  base_path?: string | null;
}

export interface GetConnectorApiKeyStatusResponse {
  openalex: boolean;
  success?: true;
  [k: string]: unknown;
}

export interface GetCsvSourceTemplatesRequest {
  base_path?: string | null;
}

export interface GetCsvSourceTemplatesResponse {
  success?: true;
  templates: {
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}

export interface GetCurrentManagedReviewTaskRequest {
  base_path?: string | null;
  kind: "prescreen" | "screen";
  project_id: string;
  verbose?: boolean;
}

export interface GetCurrentManagedReviewTaskResponse {
  current_branch: string;
  kind: "prescreen" | "screen";
  project_id: string;
  success?: true;
  task?: ManagedReviewTask | null;
  [k: string]: unknown;
}

export interface GetDataExtractionQueueRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface GetDataExtractionQueueResponse {
  completed_count: number;
  configured: boolean;
  fields: FieldDefinition[];
  project_id: string;
  records: ExtractionRecord[];
  success?: true;
  total_count: number;
  [k: string]: unknown;
}

export interface FieldDefinition {
  data_type?: string;
  explanation?: string;
  name: string;
  optional?: boolean | null;
  options?: string[] | null;
  [k: string]: unknown;
}

export interface ExtractionRecord {
  author?: string;
  booktitle?: string;
  extraction_values?: {
    [k: string]: string;
  };
  id: string;
  journal?: string;
  pdf_path?: string;
  title?: string;
  year?: string;
  [k: string]: unknown;
}

export interface GetGitStatusRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface GetGitStatusResponse {
  git: GitStatus;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface GitStatus {
  ahead: number;
  behind: number;
  branch: string;
  is_clean: boolean;
  last_commit?: LastCommitInfo | null;
  main_ahead?: number;
  main_behind?: number;
  modified_files: string[];
  remote_url?: string | null;
  staged_files: string[];
  staged_record_changes?: StagedRecordChange[];
  uncommitted_changes: number;
  untracked_files: string[];
  [k: string]: unknown;
}

export interface LastCommitInfo {
  author: string;
  email: string;
  hash: string;
  message: string;
  short_hash: string;
  timestamp: string;
  [k: string]: unknown;
}

export interface StagedRecordChange {
  change_type: string;
  record_id: string;
  [k: string]: unknown;
}

export interface GetManagedReviewTaskQueueRequest {
  base_path?: string | null;
  project_id: string;
  task_id: string;
  verbose?: boolean;
}

export interface GetManagedReviewTaskQueueResponse {
  kind: "prescreen" | "screen";
  project_id: string;
  records: ManagedReviewQueueRecord[];
  success?: true;
  task_id: string;
  total_count: number;
  [k: string]: unknown;
}

export interface ManagedReviewQueueRecord {
  author: string;
  id: string;
  status: string;
  title: string;
  year: string;
  [k: string]: unknown;
}

export interface GetManagedReviewTaskReadinessRequest {
  base_path?: string | null;
  kind: "prescreen" | "screen";
  project_id: string;
  verbose?: boolean;
}

export interface GetManagedReviewTaskReadinessResponse {
  current_branch: string;
  eligible_count: number;
  eligible_record_ids: string[];
  eligible_state: string;
  issues: string[];
  kind: "prescreen" | "screen";
  project_id: string;
  ready: boolean;
  success?: true;
  tracking: ManagedReviewTracking;
  [k: string]: unknown;
}

export interface ManagedReviewTracking {
  ahead: number;
  behind: number;
  has_remote: boolean;
  tracking_branch?: string | null;
  [k: string]: unknown;
}

export interface GetOperationInfoRequest {
  base_path?: string | null;
  operation: string;
  project_id: string;
  verbose?: boolean;
}

export interface GetOperationInfoResponse {
  affected_records: number;
  can_run: boolean;
  description: string;
  needs_rerun: boolean;
  needs_rerun_reason?: string | null;
  operation: string;
  project_id: string;
  reason?: string | null;
  success?: true;
  [k: string]: unknown;
}

export interface GetPreprocessingSummaryRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface GetPreprocessingSummaryResponse {
  duplicates_removed: number;
  pipeline_counts: {
    [k: string]: number;
  };
  project_id: string;
  sources: unknown[];
  stage_status: {
    [k: string]: boolean;
  };
  success?: true;
  [k: string]: unknown;
}

export interface GetPrescreenQueueRequest {
  base_path?: string | null;
  limit?: number;
  project_id: string;
  task_id?: string | null;
  verbose?: boolean;
}

export interface GetPrescreenQueueResponse {
  project_id: string;
  records: PrescreenQueueRecord[];
  success?: true;
  total_count: number;
  [k: string]: unknown;
}

export interface GetReconciliationPreviewRequest {
  base_path?: string | null;
  project_id: string;
  task_id: string;
  verbose?: boolean;
}

export interface GetReconciliationPreviewResponse {
  items: ReconciliationPreviewItem[];
  project_id: string;
  success?: true;
  summary: ReconciliationSummaryCounts;
  task: ManagedReviewTask;
  [k: string]: unknown;
}

export interface ReconciliationPreviewItem {
  author: string;
  auto_resolution?: ReconciliationAutoResolution | null;
  blocked_reasons: string[];
  id: string;
  reviewers: ReconciliationReviewerEntry[];
  status: "auto" | "conflict" | "pending" | "blocked";
  title: string;
  year: string;
  [k: string]: unknown;
}

export interface ReconciliationAutoResolution {
  criteria_string: string;
  selected_reviewer: "reviewer_a" | "reviewer_b";
  status: string;
  [k: string]: unknown;
}

export interface ReconciliationReviewerEntry {
  branch_name: string;
  criteria: {
    [k: string]: string;
  };
  criteria_string: string;
  github_login: string;
  last_seen_commit?: string | null;
  role: "reviewer_a" | "reviewer_b";
  status: string;
  [k: string]: unknown;
}

export interface ReconciliationSummaryCounts {
  auto_resolved_count: number;
  blocked_count: number;
  manual_conflict_count: number;
  pending_count: number;
  total_count: number;
  [k: string]: unknown;
}

export interface GetRecordRequest {
  base_path?: string | null;
  project_id: string;
  record_id?: string | null;
  verbose?: boolean;
}

export interface GetRecordResponse {
  project_id: string;
  record: FormattedRecord;
  success?: true;
  [k: string]: unknown;
}
/**
 * A record dict formatted for the API.
 *
 * Accepts arbitrary bibliographic fields. ``_format_record`` always includes
 * identity/status (even under a ``fields`` projection), so those are
 * declared; everything else rides along via ``extra="allow"``.
 */

export interface FormattedRecord {
  ENTRYTYPE?: string | null;
  ID: string;
  colrev_status?: string | null;
  file_on_disk?: boolean | null;
  [k: string]: unknown;
}

export interface GetRecordsRequest {
  base_path?: string | null;
  fields?: string[] | null;
  filters?: RecordFilters | null;
  pagination?: Pagination | null;
  project_id: string;
  sort?: SortConfig | null;
  verbose?: boolean;
}

export interface RecordFilters {
  entrytype?: unknown;
  has_pdf?: boolean | null;
  is_merged_duplicate?: boolean | null;
  search_source?: string | null;
  search_text?: string | null;
  status?: unknown;
  year_from?: number | null;
  year_to?: number | null;
  [k: string]: unknown;
}

export interface Pagination {
  limit?: number;
  offset?: number;
}

export interface SortConfig {
  direction?: string;
  field?: string;
}

export interface GetRecordsResponse {
  pagination: PaginationInfo;
  project_id: string;
  records: FormattedRecord[];
  success?: true;
  total_count: number;
  [k: string]: unknown;
}

export interface PaginationInfo {
  has_more: boolean;
  limit: number;
  offset: number;
}
/**
 * A record dict formatted for the API.
 *
 * Accepts arbitrary bibliographic fields. ``_format_record`` always includes
 * identity/status (even under a ``fields`` projection), so those are
 * declared; everything else rides along via ``extra="allow"``.
 */

export interface GetReviewDefinitionRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface GetReviewDefinitionResponse {
  criteria: {
    [k: string]: CriterionInfo;
  };
  keywords: string[];
  objectives: string;
  project_id: string;
  protocol_url: string;
  review_type: string;
  success?: true;
  title: string;
  [k: string]: unknown;
}

export interface CriterionInfo {
  comment?: string | null;
  criterion_type: string;
  explanation: string;
  [k: string]: unknown;
}

export interface GetScreenQueueRequest {
  base_path?: string | null;
  limit?: number;
  project_id: string;
  task_id?: string | null;
  verbose?: boolean;
}

export interface GetScreenQueueResponse {
  criteria: {
    [k: string]: ScreenCriterionInfo;
  };
  project_id: string;
  records: ScreenQueueRecord[];
  success?: true;
  total_count: number;
  [k: string]: unknown;
}

export interface ScreenCriterionInfo {
  comment?: string;
  criterion_type?: string;
  explanation?: string;
  [k: string]: unknown;
}

export interface ScreenQueueRecord {
  abstract?: string | null;
  author?: string;
  booktitle?: string | null;
  current_criteria?: {
    [k: string]: string;
  } | null;
  id: string;
  journal?: string | null;
  pdf_path?: string | null;
  title?: string;
  year?: string;
  [k: string]: unknown;
}

export interface GetScreeningCriteriaRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface GetScreeningCriteriaResponse {
  criteria: {
    [k: string]: CriterionInfo;
  };
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface GetSettingsRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface GetSettingsResponse {
  project_id: string;
  settings: {
    [k: string]: unknown;
  };
  success?: true;
  [k: string]: unknown;
}

export interface GetSourceRecordsRequest {
  base_path?: string | null;
  filename?: string | null;
  pagination?: PaginationRequest | null;
  project_id: string;
  verbose?: boolean;
}

export interface PaginationRequest {
  limit?: number;
  offset?: number;
}

export interface GetSourceRecordsResponse {
  filename: string;
  pagination: PaginationInfo;
  project_id: string;
  records: SourceRecord[];
  success?: true;
  total_count: number;
  [k: string]: unknown;
}

export interface SourceRecord {
  [k: string]: unknown;
}

export interface GetSourcesRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface GetSourcesResponse {
  project_id: string;
  sources: SourceInfo[];
  success?: true;
  [k: string]: unknown;
}
/**
 * The wire shape built in ``get_sources``: ``ExtendedSearchFile.model_dump()``
 * plus the staleness metadata. Extra fields ride along via ``extra="allow"``.
 */

export interface SourceInfo {
  is_stale?: boolean | null;
  last_run_timestamp?: string | null;
  platform?: string | null;
  record_count?: number | null;
  search_results_path?: string | null;
  search_string?: string | null;
  search_type?: string | null;
  stale_reason?: string | null;
  [k: string]: unknown;
}

export interface GetStatusRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

/**
 * Nested ``status`` payload is deliberately an untyped dict.
 */
export interface GetStatusResponse {
  path: string;
  project_id: string;
  status: {
    [k: string]: unknown;
  };
  success?: true;
  [k: string]: unknown;
}

export interface ImportPdfsRequest {
  base_path?: string | null;
  on_conflict?: "skip" | "overwrite";
  project_id: string;
  verbose?: boolean;
  zip_path: string;
}

export interface ImportPdfsResponse {
  conflicts: string[];
  imported_count: number;
  manifest_mismatch?: boolean;
  manifest_project_id?: string | null;
  overwritten_count: number;
  project_id: string;
  skipped_count: number;
  success?: true;
  [k: string]: unknown;
}

export interface IncludeAllScreenRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface IncludeAllScreenResponse {
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface InitProjectRequest {
  base_path?: string;
  example?: boolean;
  force_mode?: boolean;
  light?: boolean;
  project_id: string;
  review_type?: string;
  title?: string | null;
}

export interface InitProjectResponse {
  message: string;
  path: string;
  project_id: string;
  review_type: string;
  success?: true;
  [k: string]: unknown;
}

export interface ListManagedReviewTasksRequest {
  base_path?: string | null;
  kind: "prescreen" | "screen";
  project_id: string;
  verbose?: boolean;
}

export interface ListManagedReviewTasksResponse {
  kind: "prescreen" | "screen";
  project_id: string;
  success?: true;
  tasks: ManagedReviewTask[];
  [k: string]: unknown;
}

export interface ListProjectsRequest {
  base_path?: string;
}

export interface ListProjectsResponse {
  projects: ProjectListItem[];
  success?: true;
  [k: string]: unknown;
}

export interface ProjectListItem {
  id: string;
  path: string;
  title: string;
  [k: string]: unknown;
}

export interface LoadRequest {
  base_path?: string | null;
  keep_ids?: boolean;
  project_id: string;
  verbose?: boolean;
}

export interface LoadResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface MarkPdfNotAvailableRequest {
  base_path?: string | null;
  project_id: string;
  record_id: string;
  verbose?: boolean;
}

export interface MarkPdfNotAvailableResponse {
  new_status: string;
  project_id: string;
  record_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface MatchPdfToRecordsRequest {
  base_path?: string | null;
  content: string;
  filename: string;
  project_id: string;
  verbose?: boolean;
}

export interface MatchPdfToRecordsResponse {
  best_match?: BestMatch | null;
  extracted_metadata?: ExtractedMetadata | null;
  extraction_method: "pdf_metadata" | "filename_only" | "none";
  filename: string;
  matches: PDFMatchCandidate[];
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface BestMatch {
  record_id: string;
  similarity: number;
  [k: string]: unknown;
}

export interface ExtractedMetadata {
  author?: string;
  doi?: string;
  title?: string;
  year?: string;
  [k: string]: unknown;
}

export interface PDFMatchCandidate {
  author?: string;
  record_id: string;
  similarity: number;
  title?: string;
  year?: string;
  [k: string]: unknown;
}

export interface PdfGetRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface PdfGetResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface PdfPrepRequest {
  base_path?: string | null;
  batch_size?: number;
  project_id: string;
  reprocess?: boolean;
  verbose?: boolean;
}

export interface PdfPrepResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface PingRequest {
  base_path?: string | null;
}

/**
 * Readiness probe response. Lives here (not in system_handler) so the
 * fast path in ``handler.py`` can construct it without importing
 * ``framework_handlers`` (which would defeat the lazy-load design).
 */
export interface PingResponse {
  status?: "pong";
  success?: true;
  [k: string]: unknown;
}

export interface PrepRequest {
  base_path?: string | null;
  project_id: string;
  use_minimal_prep?: boolean;
  verbose?: boolean;
}

export interface PrepResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface PrepManUpdateRecordRequest {
  base_path?: string | null;
  fields: {
    [k: string]: unknown;
  };
  project_id: string;
  record_id: string;
  verbose?: boolean;
}

export interface PrepManUpdateRecordResponse {
  details: PrepManUpdateDetails;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface PrepManUpdateDetails {
  message: string;
  new_status: string;
  record: {
    [k: string]: unknown;
  };
  remaining_defects?: {
    [k: string]: string[];
  } | null;
  [k: string]: unknown;
}

export interface PrescreenRequest {
  base_path?: string | null;
  project_id: string;
  split_str?: string;
  verbose?: boolean;
}

export interface PrescreenResponse {
  message: string;
  operation: string;
  project_id: string;
  split_str: string;
  success?: true;
  [k: string]: unknown;
}

export interface PrescreenRecordRequest {
  base_path?: string | null;
  decision: "include" | "exclude";
  project_id: string;
  record_id: string;
  task_id?: string | null;
  verbose?: boolean;
}

export interface PrescreenRecordResponse {
  already_decided?: boolean;
  project_id: string;
  record: PrescreenedRecord;
  remaining_count: number;
  success?: true;
  [k: string]: unknown;
}

export interface PrescreenedRecord {
  decision: "include" | "exclude";
  id: string;
  new_status: string;
}

export interface RemoveScreeningCriterionRequest {
  base_path?: string | null;
  criterion_name: string;
  project_id: string;
  verbose?: boolean;
}

export interface RemoveScreeningCriterionResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface RemoveSourceRequest {
  base_path?: string | null;
  delete_file?: boolean;
  filename?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface RemoveSourceResponse {
  details: RemoveSourceDetails;
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface RemoveSourceDetails {
  message: string;
  [k: string]: unknown;
}

export interface ResetToRemoteRequest {
  base_path?: string | null;
  confirm?: boolean;
  project_id: string;
  verbose?: boolean;
}

export interface ResetToRemoteResponse {
  discarded_commits: number;
  discarded_files?: string[];
  message: string;
  project_id: string;
  reset: boolean;
  success?: true;
  target_ref: string;
  [k: string]: unknown;
}

export interface RestorePdfFileRequest {
  base_path?: string | null;
  content: string;
  project_id: string;
  record_id: string;
  verbose?: boolean;
}

export interface RestorePdfFileResponse {
  bytes_written: number;
  path: string;
  project_id: string;
  record_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface SaveDataExtractionRequest {
  base_path?: string | null;
  project_id: string;
  record_id: string;
  values: {
    [k: string]: unknown;
  };
  verbose?: boolean;
}

export interface SaveDataExtractionResponse {
  message: string;
  project_id: string;
  record_id: string;
  remaining_count: number;
  success?: true;
  [k: string]: unknown;
}

export interface ScreenRequest {
  base_path?: string | null;
  project_id: string;
  split_str?: string;
  verbose?: boolean;
}

export interface ScreenResponse {
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface ScreenRecordRequest {
  base_path?: string | null;
  criteria_decisions?: {
    [k: string]: "in" | "out" | "TODO";
  };
  decision: "include" | "exclude";
  project_id: string;
  record_id: string;
  task_id?: string | null;
  verbose?: boolean;
}

export interface ScreenRecordResponse {
  already_decided?: boolean;
  project_id: string;
  record: ScreenedRecord;
  remaining_count: number;
  success?: true;
  [k: string]: unknown;
}

export interface ScreenedRecord {
  criteria_decisions: {
    [k: string]: "in" | "out" | "TODO";
  };
  decision: "include" | "exclude";
  id: string;
  new_status: string;
}

export interface SearchRequest {
  base_path?: string | null;
  project_id: string;
  rerun?: boolean;
  source?: string;
  verbose?: boolean;
}

export interface SearchResponse {
  details: SearchDetails;
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface SearchDetails {
  message: string;
  rerun: boolean;
  source: string;
  [k: string]: unknown;
}

export interface SetConnectorApiKeyRequest {
  api_key: string;
  base_path?: string | null;
  connector: string;
}

export interface SetConnectorApiKeyResponse {
  configured: boolean;
  connector: string;
  success?: true;
  [k: string]: unknown;
}

export interface StatusRequest {
  base_path?: string | null;
  project_id: string;
  verbose?: boolean;
}

/**
 * Nested ``status`` payload is deliberately an untyped dict.
 */
export interface StatusResponse {
  path: string;
  project_id: string;
  status: {
    [k: string]: unknown;
  };
  success?: true;
  [k: string]: unknown;
}

export interface UndoPdfNotAvailableRequest {
  base_path?: string | null;
  project_id: string;
  record_id: string;
  verbose?: boolean;
}

export interface UndoPdfNotAvailableResponse {
  new_status: string;
  project_id: string;
  record_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface UpdatePrescreenDecisionsRequest {
  base_path?: string | null;
  changes: PrescreenDecisionChange[];
  project_id: string;
  verbose?: boolean;
}

export interface PrescreenDecisionChange {
  decision: "include" | "exclude";
  record_id: string;
}

export interface UpdatePrescreenDecisionsResponse {
  changes_count: number;
  message: string;
  project_id: string;
  skipped: SkippedChange[];
  success?: true;
  updated_records: string[];
  [k: string]: unknown;
}

export interface SkippedChange {
  reason: string;
  record_id: string;
}

export interface UpdateRecordRequest {
  base_path?: string | null;
  fields?: {
    [k: string]: unknown;
  } | null;
  project_id: string;
  record_id?: string | null;
  verbose?: boolean;
}

export interface UpdateRecordResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface UpdateReviewDefinitionRequest {
  base_path?: string | null;
  keywords?: string[] | null;
  objectives?: string | null;
  project_id: string;
  protocol_url?: string | null;
  verbose?: boolean;
}

export interface UpdateReviewDefinitionResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface UpdateScreenDecisionsRequest {
  base_path?: string | null;
  changes: ScreenDecisionChange[];
  project_id: string;
  verbose?: boolean;
}

export interface ScreenDecisionChange {
  decision: "include" | "exclude";
  record_id: string;
}

export interface UpdateScreenDecisionsResponse {
  changes_count: number;
  message: string;
  project_id: string;
  skipped: SkippedChange[];
  success?: true;
  updated_records: string[];
  [k: string]: unknown;
}

export interface UpdateScreeningCriterionRequest {
  base_path?: string | null;
  comment?: string | null;
  criterion_name: string;
  criterion_type?: string | null;
  explanation?: string | null;
  project_id: string;
  verbose?: boolean;
}

export interface UpdateScreeningCriterionResponse {
  details: {
    [k: string]: unknown;
  };
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface UpdateSettingsRequest {
  base_path?: string | null;
  project_id: string;
  settings: {
    [k: string]: unknown;
  };
  verbose?: boolean;
}

export interface UpdateSettingsResponse {
  details: {
    [k: string]: unknown;
  };
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface UpdateSourceRequest {
  base_path?: string | null;
  filename?: string | null;
  project_id: string;
  run_date?: string | null;
  search_parameters?: {
    [k: string]: unknown;
  } | null;
  search_string?: string | null;
  verbose?: boolean;
}

export interface UpdateSourceResponse {
  details: UpdateSourceDetails;
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface UpdateSourceDetails {
  message: string;
  source: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface UploadPdfRequest {
  base_path?: string | null;
  content: string;
  filename: string;
  project_id: string;
  record_id: string;
  verbose?: boolean;
}

export interface UploadPdfResponse {
  file_path: string;
  new_status: string;
  prep_message?: string | null;
  prep_status?: string;
  project_id: string;
  record_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface UploadSearchFileRequest {
  base_path?: string | null;
  content?: string | null;
  encoding?: string;
  filename?: string | null;
  project_id: string;
  source_template?: string | null;
  verbose?: boolean;
}

export interface UploadSearchFileResponse {
  detected_format: string;
  message: string;
  path: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

export interface ValidateRequest {
  base_path?: string | null;
  filter_setting?: string;
  project_id: string;
  scope?: string;
  verbose?: boolean;
}

export interface ValidateResponse {
  details: {
    [k: string]: unknown;
  };
  message: string;
  operation: string;
  project_id: string;
  success?: true;
  [k: string]: unknown;
}

/** Discriminated map: method name → request/response types. */
export interface RPCMethods {
  "add_screening_criterion": {
    params: AddScreeningCriterionRequest;
    result: AddScreeningCriterionResponse;
  };
  "add_source": {
    params: AddSourceRequest;
    result: AddSourceResponse;
  };
  "apply_reconciliation": {
    params: ApplyReconciliationRequest;
    result: ApplyReconciliationResponse;
  };
  "batch_enrich_records": {
    params: BatchEnrichRecordsRequest;
    result: BatchEnrichRecordsResponse;
  };
  "cancel_managed_review_task": {
    params: CancelManagedReviewTaskRequest;
    result: CancelManagedReviewTaskResponse;
  };
  "commit_changes": {
    params: CommitChangesRequest;
    result: CommitChangesResponse;
  };
  "configure_structured_endpoint": {
    params: ConfigureStructuredEndpointRequest;
    result: ConfigureStructuredEndpointResponse;
  };
  "create_managed_review_task": {
    params: CreateManagedReviewTaskRequest;
    result: CreateManagedReviewTaskResponse;
  };
  "data": {
    params: DataRequest;
    result: DataResponse;
  };
  "dedupe": {
    params: DedupeRequest;
    result: DedupeResponse;
  };
  "delete_project": {
    params: DeleteProjectRequest;
    result: DeleteProjectResponse;
  };
  "discard_changes": {
    params: DiscardChangesRequest;
    result: DiscardChangesResponse;
  };
  "enrich_record_metadata": {
    params: EnrichRecordMetadataRequest;
    result: EnrichRecordMetadataResponse;
  };
  "export_data_csv": {
    params: ExportDataCsvRequest;
    result: ExportDataCsvResponse;
  };
  "export_pdfs": {
    params: ExportPdfsRequest;
    result: ExportPdfsResponse;
  };
  "export_reconciliation_audit": {
    params: ExportReconciliationAuditRequest;
    result: ExportReconciliationAuditResponse;
  };
  "get_branch_delta": {
    params: GetBranchDeltaRequest;
    result: GetBranchDeltaResponse;
  };
  "get_connector_api_key_status": {
    params: GetConnectorApiKeyStatusRequest;
    result: GetConnectorApiKeyStatusResponse;
  };
  "get_csv_source_templates": {
    params: GetCsvSourceTemplatesRequest;
    result: GetCsvSourceTemplatesResponse;
  };
  "get_current_managed_review_task": {
    params: GetCurrentManagedReviewTaskRequest;
    result: GetCurrentManagedReviewTaskResponse;
  };
  "get_data_extraction_queue": {
    params: GetDataExtractionQueueRequest;
    result: GetDataExtractionQueueResponse;
  };
  "get_git_status": {
    params: GetGitStatusRequest;
    result: GetGitStatusResponse;
  };
  "get_managed_review_task_queue": {
    params: GetManagedReviewTaskQueueRequest;
    result: GetManagedReviewTaskQueueResponse;
  };
  "get_managed_review_task_readiness": {
    params: GetManagedReviewTaskReadinessRequest;
    result: GetManagedReviewTaskReadinessResponse;
  };
  "get_operation_info": {
    params: GetOperationInfoRequest;
    result: GetOperationInfoResponse;
  };
  "get_preprocessing_summary": {
    params: GetPreprocessingSummaryRequest;
    result: GetPreprocessingSummaryResponse;
  };
  "get_prescreen_queue": {
    params: GetPrescreenQueueRequest;
    result: GetPrescreenQueueResponse;
  };
  "get_reconciliation_preview": {
    params: GetReconciliationPreviewRequest;
    result: GetReconciliationPreviewResponse;
  };
  "get_record": {
    params: GetRecordRequest;
    result: GetRecordResponse;
  };
  "get_records": {
    params: GetRecordsRequest;
    result: GetRecordsResponse;
  };
  "get_review_definition": {
    params: GetReviewDefinitionRequest;
    result: GetReviewDefinitionResponse;
  };
  "get_screen_queue": {
    params: GetScreenQueueRequest;
    result: GetScreenQueueResponse;
  };
  "get_screening_criteria": {
    params: GetScreeningCriteriaRequest;
    result: GetScreeningCriteriaResponse;
  };
  "get_settings": {
    params: GetSettingsRequest;
    result: GetSettingsResponse;
  };
  "get_source_records": {
    params: GetSourceRecordsRequest;
    result: GetSourceRecordsResponse;
  };
  "get_sources": {
    params: GetSourcesRequest;
    result: GetSourcesResponse;
  };
  "get_status": {
    params: GetStatusRequest;
    result: GetStatusResponse;
  };
  "import_pdfs": {
    params: ImportPdfsRequest;
    result: ImportPdfsResponse;
  };
  "include_all_screen": {
    params: IncludeAllScreenRequest;
    result: IncludeAllScreenResponse;
  };
  "init_project": {
    params: InitProjectRequest;
    result: InitProjectResponse;
  };
  "list_managed_review_tasks": {
    params: ListManagedReviewTasksRequest;
    result: ListManagedReviewTasksResponse;
  };
  "list_projects": {
    params: ListProjectsRequest;
    result: ListProjectsResponse;
  };
  "load": {
    params: LoadRequest;
    result: LoadResponse;
  };
  "mark_pdf_not_available": {
    params: MarkPdfNotAvailableRequest;
    result: MarkPdfNotAvailableResponse;
  };
  "match_pdf_to_records": {
    params: MatchPdfToRecordsRequest;
    result: MatchPdfToRecordsResponse;
  };
  "pdf_get": {
    params: PdfGetRequest;
    result: PdfGetResponse;
  };
  "pdf_prep": {
    params: PdfPrepRequest;
    result: PdfPrepResponse;
  };
  "ping": {
    params: PingRequest;
    result: PingResponse;
  };
  "prep": {
    params: PrepRequest;
    result: PrepResponse;
  };
  "prep_man_update_record": {
    params: PrepManUpdateRecordRequest;
    result: PrepManUpdateRecordResponse;
  };
  "prescreen": {
    params: PrescreenRequest;
    result: PrescreenResponse;
  };
  "prescreen_record": {
    params: PrescreenRecordRequest;
    result: PrescreenRecordResponse;
  };
  "remove_screening_criterion": {
    params: RemoveScreeningCriterionRequest;
    result: RemoveScreeningCriterionResponse;
  };
  "remove_source": {
    params: RemoveSourceRequest;
    result: RemoveSourceResponse;
  };
  "reset_to_remote": {
    params: ResetToRemoteRequest;
    result: ResetToRemoteResponse;
  };
  "restore_pdf_file": {
    params: RestorePdfFileRequest;
    result: RestorePdfFileResponse;
  };
  "save_data_extraction": {
    params: SaveDataExtractionRequest;
    result: SaveDataExtractionResponse;
  };
  "screen": {
    params: ScreenRequest;
    result: ScreenResponse;
  };
  "screen_record": {
    params: ScreenRecordRequest;
    result: ScreenRecordResponse;
  };
  "search": {
    params: SearchRequest;
    result: SearchResponse;
  };
  "set_connector_api_key": {
    params: SetConnectorApiKeyRequest;
    result: SetConnectorApiKeyResponse;
  };
  "status": {
    params: StatusRequest;
    result: StatusResponse;
  };
  "undo_pdf_not_available": {
    params: UndoPdfNotAvailableRequest;
    result: UndoPdfNotAvailableResponse;
  };
  "update_prescreen_decisions": {
    params: UpdatePrescreenDecisionsRequest;
    result: UpdatePrescreenDecisionsResponse;
  };
  "update_record": {
    params: UpdateRecordRequest;
    result: UpdateRecordResponse;
  };
  "update_review_definition": {
    params: UpdateReviewDefinitionRequest;
    result: UpdateReviewDefinitionResponse;
  };
  "update_screen_decisions": {
    params: UpdateScreenDecisionsRequest;
    result: UpdateScreenDecisionsResponse;
  };
  "update_screening_criterion": {
    params: UpdateScreeningCriterionRequest;
    result: UpdateScreeningCriterionResponse;
  };
  "update_settings": {
    params: UpdateSettingsRequest;
    result: UpdateSettingsResponse;
  };
  "update_source": {
    params: UpdateSourceRequest;
    result: UpdateSourceResponse;
  };
  "upload_pdf": {
    params: UploadPdfRequest;
    result: UploadPdfResponse;
  };
  "upload_search_file": {
    params: UploadSearchFileRequest;
    result: UploadSearchFileResponse;
  };
  "validate": {
    params: ValidateRequest;
    result: ValidateResponse;
  };
}

export type RPCMethodName = keyof RPCMethods;
export type RPCParams<M extends RPCMethodName> = RPCMethods[M]["params"];
export type RPCResult<M extends RPCMethodName> = RPCMethods[M]["result"];
