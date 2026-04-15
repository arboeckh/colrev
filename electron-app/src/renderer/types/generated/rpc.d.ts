/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate via `npm run gen-types` after backend handler changes.
 * Source: src/renderer/types/generated/rpc-schemas.json
 */

// shared: ProgressEvent
export type Current = number | null;
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
export type Level = "info" | "warning" | "error";
export type Message = string;
export type Source = string | null;
export type Total = number | null;

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
  current?: Current;
  kind: ProgressEventKind;
  level?: Level;
  message: Message;
  source?: Source;
  total?: Total;
  [k: string]: unknown;
}

// shared: RecordPayload
export type Entrytype = string;
export type Id = string;
/**
 * RecordState as a string-valued enum for JSON Schema export.
 *
 * Mirrors :class:`colrev.constants.RecordState` but uses string values
 * so JSON Schema sees it as an ``enum`` of strings rather than integers.
 * Frontend (via codegen) gets a proper string-literal union.
 */
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
  ENTRYTYPE?: Entrytype;
  ID: Id;
  colrev_status?: RecordStateName | null;
  [k: string]: unknown;
}

// shared: RecordStateName
/**
 * CoLRev record workflow state (mirrors RecordState).
 */
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

// shared: RecordSummary
export type Author = string;
export type Id = string;
export type Title = string;
export type Year = string;

/**
 * Lightweight record view used by queue endpoints.
 *
 * Used by ``get_prescreen_queue``, ``get_screen_queue``, and similar —
 * where the frontend needs just enough to render a list item. Extra
 * fields are allowed so endpoints can tack on e.g. ``pdf_path`` or
 * ``current_criteria`` without a schema change.
 */
export interface RecordSummary {
  author?: Author;
  id: Id;
  title?: Title;
  year?: Year;
  [k: string]: unknown;
}

// add_screening_criterion
export type BasePath = string | null;
export type Comment = string | null;
export type CriterionType = string;
export type Explanation = string;
export type Name = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface AddScreeningCriterionRequest {
  base_path?: BasePath;
  comment?: Comment;
  criterion_type: CriterionType;
  explanation: Explanation;
  name: Name;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface AddScreeningCriterionResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// add_source
export type BasePath = string | null;
export type Endpoint = string | null;
export type Filename = string | null;
export type ProjectId = string;
export type RunDate = string | null;
export type SearchString = string;
export type SearchType = string | null;
export type Verbose = boolean;

export interface AddSourceRequest {
  base_path?: BasePath;
  endpoint?: Endpoint;
  filename?: Filename;
  project_id: ProjectId;
  run_date?: RunDate;
  search_string?: SearchString;
  search_type?: SearchType;
  verbose?: Verbose;
}

export type Message = string;
export type Message1 = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface AddSourceResponse {
  details: AddSourceDetails;
  message: Message1;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface AddSourceDetails {
  message: Message;
  source: Source;
  [k: string]: unknown;
}
export interface Source {}

// apply_reconciliation
export type BasePath = string | null;
export type ProjectId = string;
export type Resolutions = unknown[];
export type ResolvedBy = string;
export type TaskId = string;
export type Verbose = boolean;

export interface ApplyReconciliationRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  resolutions?: Resolutions;
  resolved_by?: ResolvedBy;
  task_id: TaskId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// batch_enrich_records
export type BasePath = string | null;
export type Fields = string[] | null;
export type ProjectId = string;
export type RecordIds = string[];
export type Verbose = boolean;

export interface BatchEnrichRecordsRequest {
  base_path?: BasePath;
  fields?: Fields;
  project_id: ProjectId;
  record_ids: RecordIds;
  verbose?: Verbose;
}

export type EnrichedCount = number;
export type FailedCount = number;
export type ProjectId = string;
export type Id = string;
export type Success = boolean;
export type Records = BatchEnrichItem[];
export type Success1 = true;

export interface BatchEnrichRecordsResponse {
  enriched_count: EnrichedCount;
  failed_count: FailedCount;
  project_id: ProjectId;
  records: Records;
  success?: Success1;
  [k: string]: unknown;
}
export interface BatchEnrichItem {
  id: Id;
  success: Success;
  [k: string]: unknown;
}

// cancel_managed_review_task
export type BasePath = string | null;
export type CanceledBy = string;
export type ProjectId = string;
export type TaskId = string;
export type Verbose = boolean;

export interface CancelManagedReviewTaskRequest {
  base_path?: BasePath;
  canceled_by?: CanceledBy;
  project_id: ProjectId;
  task_id: TaskId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// commit_changes
export type BasePath = string | null;
export type Message = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface CommitChangesRequest {
  base_path?: BasePath;
  message: Message;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type ChangedFiles = string[];
export type CommitSha = string | null;
export type Committed = boolean;
export type Message = string;
export type ProjectId = string;
export type Success = true;

export interface CommitChangesResponse {
  changed_files?: ChangedFiles;
  commit_sha?: CommitSha;
  committed: Committed;
  message: Message;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// configure_structured_endpoint
export type BasePath = string | null;
export type DataType = string;
export type Explanation = string;
export type Name = string;
export type Optional = boolean | null;
export type Options = unknown[] | null;
export type Fields = StructuredFieldSpec[];
export type ProjectId = string;
export type Verbose = boolean;

export interface ConfigureStructuredEndpointRequest {
  base_path?: BasePath;
  fields: Fields;
  project_id: ProjectId;
  verbose?: Verbose;
}
export interface StructuredFieldSpec {
  data_type?: DataType;
  explanation: Explanation;
  name: Name;
  optional?: Optional;
  options?: Options;
  [k: string]: unknown;
}

export type Fields = {}[];
export type Message = string;
export type ProjectId = string;
export type Success = true;

export interface ConfigureStructuredEndpointResponse {
  fields: Fields;
  message: Message;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// create_managed_review_task
export type BasePath = string | null;
export type CreatedBy = string;
export type Kind = string;
export type ProjectId = string;
export type ReviewerLogins = string[];
export type Verbose = boolean;

export interface CreateManagedReviewTaskRequest {
  base_path?: BasePath;
  created_by?: CreatedBy;
  kind: Kind;
  project_id: ProjectId;
  reviewer_logins: ReviewerLogins;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// data
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface DataRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface DataResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// dedupe
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface DedupeRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface DedupeResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// delete_project
export type BasePath = string;
export type ProjectId = string;

export interface DeleteProjectRequest {
  base_path?: BasePath;
  project_id: ProjectId;
}

export type Message = string;
export type ProjectId = string;
export type Success = true;

export interface DeleteProjectResponse {
  message: Message;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// discard_changes
export type BasePath = string | null;
export type Confirm = boolean;
export type Paths = string[] | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface DiscardChangesRequest {
  base_path?: BasePath;
  confirm?: Confirm;
  paths?: Paths;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type DiscardedFiles = string[];
export type ProjectId = string;
export type Success = true;

export interface DiscardChangesResponse {
  discarded_files?: DiscardedFiles;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// enrich_record_metadata
export type BasePath = string | null;
export type Fields = string[] | null;
export type ProjectId = string;
export type RecordId = string;
export type Verbose = boolean;

export interface EnrichRecordMetadataRequest {
  base_path?: BasePath;
  fields?: Fields;
  project_id: ProjectId;
  record_id: RecordId;
  verbose?: Verbose;
}

export type EnrichedFields = string[];
export type Message = string | null;
export type ProjectId = string;
export type Author = string;
export type CanEnrich = boolean;
export type Id = string;
export type Title = string;
export type Year = string;
export type Source = string | null;
export type Success = true;

export interface EnrichRecordMetadataResponse {
  enriched_fields: EnrichedFields;
  message?: Message;
  project_id: ProjectId;
  record: EnrichedRecord;
  source?: Source;
  success?: Success;
  [k: string]: unknown;
}
export interface EnrichedRecord {
  author?: Author;
  can_enrich?: CanEnrich;
  id: Id;
  title?: Title;
  year?: Year;
  [k: string]: unknown;
}

// export_data_csv
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface ExportDataCsvRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type CsvContent = string;
export type Filename = string;
export type ProjectId = string;
export type Success = true;

export interface ExportDataCsvResponse {
  csv_content: CsvContent;
  filename: Filename;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// export_reconciliation_audit
export type BasePath = string | null;
export type Format = string;
export type ProjectId = string;
export type TaskId = string;
export type Verbose = boolean;

export interface ExportReconciliationAuditRequest {
  base_path?: BasePath;
  format: Format;
  project_id: ProjectId;
  task_id: TaskId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// get_branch_delta
export type BaseBranch = string;
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetBranchDeltaRequest {
  base_branch?: BaseBranch;
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type BaseBranch = string;
export type ChangedRecordCount = number;
export type CurrentBranch = string;
export type NewRecordCount = number;
export type ProjectId = string;
export type RemovedRecordCount = number;
export type Success = true;

export interface GetBranchDeltaResponse {
  base_branch: BaseBranch;
  changed_record_count: ChangedRecordCount;
  current_branch: CurrentBranch;
  delta_by_state: DeltaByState;
  new_record_count: NewRecordCount;
  project_id: ProjectId;
  removed_record_count: RemovedRecordCount;
  success?: Success;
  [k: string]: unknown;
}
export interface DeltaByState {
  [k: string]: number;
}

// get_csv_source_templates
export type BasePath = string | null;

export interface GetCSVSourceTemplatesRequest {
  base_path?: BasePath;
}

export type Success = true;
export type Templates = {}[];

export interface GetCSVSourceTemplatesResponse {
  success?: Success;
  templates: Templates;
  [k: string]: unknown;
}

// get_current_managed_review_task
export type BasePath = string | null;
export type Kind = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetCurrentManagedReviewTaskRequest {
  base_path?: BasePath;
  kind: Kind;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// get_data_extraction_queue
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetDataExtractionQueueRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type CompletedCount = number;
export type Configured = boolean;
export type DataType = string;
export type Explanation = string;
export type Name = string;
export type Fields = FieldDefinition[];
export type ProjectId = string;
export type Author = string;
export type Booktitle = string;
export type Id = string;
export type Journal = string;
export type PdfPath = string;
export type Title = string;
export type Year = string;
export type Records = ExtractionRecord[];
export type Success = true;
export type TotalCount = number;

export interface GetDataExtractionQueueResponse {
  completed_count: CompletedCount;
  configured: Configured;
  fields: Fields;
  project_id: ProjectId;
  records: Records;
  success?: Success;
  total_count: TotalCount;
  [k: string]: unknown;
}
export interface FieldDefinition {
  data_type?: DataType;
  explanation?: Explanation;
  name: Name;
  [k: string]: unknown;
}
export interface ExtractionRecord {
  author?: Author;
  booktitle?: Booktitle;
  extraction_values?: ExtractionValues;
  id: Id;
  journal?: Journal;
  pdf_path?: PdfPath;
  title?: Title;
  year?: Year;
  [k: string]: unknown;
}
export interface ExtractionValues {
  [k: string]: string;
}

// get_git_status
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetGitStatusRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Ahead = number;
export type Behind = number;
export type Branch = string;
export type IsClean = boolean;
export type Author = string;
export type Email = string;
export type Hash = string;
export type Message = string;
export type ShortHash = string;
export type Timestamp = string;
export type ModifiedFiles = string[];
export type RemoteUrl = string | null;
export type StagedFiles = string[];
export type ChangeType = string;
export type RecordId = string;
export type StagedRecordChanges = StagedRecordChange[];
export type UncommittedChanges = number;
export type UntrackedFiles = string[];
export type ProjectId = string;
export type Success = true;

export interface GetGitStatusResponse {
  git: GitStatus;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface GitStatus {
  ahead: Ahead;
  behind: Behind;
  branch: Branch;
  is_clean: IsClean;
  last_commit?: LastCommitInfo | null;
  modified_files: ModifiedFiles;
  remote_url?: RemoteUrl;
  staged_files: StagedFiles;
  staged_record_changes?: StagedRecordChanges;
  uncommitted_changes: UncommittedChanges;
  untracked_files: UntrackedFiles;
  [k: string]: unknown;
}
export interface LastCommitInfo {
  author: Author;
  email: Email;
  hash: Hash;
  message: Message;
  short_hash: ShortHash;
  timestamp: Timestamp;
  [k: string]: unknown;
}
export interface StagedRecordChange {
  change_type: ChangeType;
  record_id: RecordId;
  [k: string]: unknown;
}

// get_managed_review_task_queue
export type BasePath = string | null;
export type ProjectId = string;
export type TaskId = string;
export type Verbose = boolean;

export interface GetManagedReviewTaskQueueRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  task_id: TaskId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// get_managed_review_task_readiness
export type BasePath = string | null;
export type Kind = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetManagedReviewTaskReadinessRequest {
  base_path?: BasePath;
  kind: Kind;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// get_operation_info
export type BasePath = string | null;
export type Operation = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetOperationInfoRequest {
  base_path?: BasePath;
  operation: Operation;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type AffectedRecords = number;
export type CanRun = boolean;
export type Description = string;
export type NeedsRerun = boolean;
export type NeedsRerunReason = string | null;
export type Operation = string;
export type ProjectId = string;
export type Reason = string | null;
export type Success = true;

export interface GetOperationInfoResponse {
  affected_records: AffectedRecords;
  can_run: CanRun;
  description: Description;
  needs_rerun: NeedsRerun;
  needs_rerun_reason?: NeedsRerunReason;
  operation: Operation;
  project_id: ProjectId;
  reason?: Reason;
  success?: Success;
  [k: string]: unknown;
}

// get_preprocessing_summary
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetPreprocessingSummaryRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type DuplicatesRemoved = number;
export type ProjectId = string;
export type Sources = unknown[];
export type Success = true;

export interface GetPreprocessingSummaryResponse {
  duplicates_removed: DuplicatesRemoved;
  pipeline_counts: PipelineCounts;
  project_id: ProjectId;
  sources: Sources;
  stage_status: StageStatus;
  success?: Success;
  [k: string]: unknown;
}
export interface PipelineCounts {
  [k: string]: number;
}
export interface StageStatus {
  [k: string]: boolean;
}

// get_prescreen_queue
export type BasePath = string | null;
export type Limit = number;
export type ProjectId = string;
export type TaskId = string | null;
export type Verbose = boolean;

export interface GetPrescreenQueueRequest {
  base_path?: BasePath;
  limit?: Limit;
  project_id: ProjectId;
  task_id?: TaskId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Author = string;
export type CanEnrich = boolean;
export type Id = string;
export type Title = string;
export type Year = string;
export type Records = QueueRecord[];
export type Success = true;
export type TotalCount = number;

export interface GetPrescreenQueueResponse {
  project_id: ProjectId;
  records: Records;
  success?: Success;
  total_count: TotalCount;
  [k: string]: unknown;
}
export interface QueueRecord {
  author?: Author;
  can_enrich?: CanEnrich;
  id: Id;
  title?: Title;
  year?: Year;
  [k: string]: unknown;
}

// get_reconciliation_preview
export type BasePath = string | null;
export type ProjectId = string;
export type TaskId = string;
export type Verbose = boolean;

export interface GetReconciliationPreviewRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  task_id: TaskId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// get_record
export type BasePath = string | null;
export type ProjectId = string;
export type RecordId = string | null;
export type Verbose = boolean;

export interface GetRecordRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  record_id?: RecordId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

export interface GetRecordResponse {
  project_id: ProjectId;
  record: FormattedRecord;
  success?: Success;
  [k: string]: unknown;
}
/**
 * A record dict formatted for the API.
 *
 * Accepts arbitrary bibliographic fields; identity/status are always present
 * after formatting.
 */
export interface FormattedRecord {
  [k: string]: unknown;
}

// get_records
export type BasePath = string | null;
export type Fields = string[] | null;
export type HasPdf = boolean | null;
export type IsMergedDuplicate = boolean | null;
export type SearchSource = string | null;
export type SearchText = string | null;
export type YearFrom = number | null;
export type YearTo = number | null;
export type Limit = number;
export type Offset = number;
export type ProjectId = string;
export type Direction = string;
export type Field = string;
export type Verbose = boolean;

export interface GetRecordsRequest {
  base_path?: BasePath;
  fields?: Fields;
  filters?: RecordFilters | null;
  pagination?: Pagination | null;
  project_id: ProjectId;
  sort?: SortConfig | null;
  verbose?: Verbose;
}
export interface RecordFilters {
  entrytype?: unknown;
  has_pdf?: HasPdf;
  is_merged_duplicate?: IsMergedDuplicate;
  search_source?: SearchSource;
  search_text?: SearchText;
  status?: unknown;
  year_from?: YearFrom;
  year_to?: YearTo;
  [k: string]: unknown;
}
export interface Pagination {
  limit?: Limit;
  offset?: Offset;
}
export interface SortConfig {
  direction?: Direction;
  field?: Field;
}

export type HasMore = boolean;
export type Limit = number;
export type Offset = number;
export type ProjectId = string;
export type Records = FormattedRecord[];
export type Success = true;
export type TotalCount = number;

export interface GetRecordsResponse {
  pagination: PaginationInfo;
  project_id: ProjectId;
  records: Records;
  success?: Success;
  total_count: TotalCount;
  [k: string]: unknown;
}
export interface PaginationInfo {
  has_more: HasMore;
  limit: Limit;
  offset: Offset;
}
/**
 * A record dict formatted for the API.
 *
 * Accepts arbitrary bibliographic fields; identity/status are always present
 * after formatting.
 */
export interface FormattedRecord {
  [k: string]: unknown;
}

// get_review_definition
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetReviewDefinitionRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Comment = string | null;
export type CriterionType = string;
export type Explanation = string;
export type Keywords = string[];
export type Objectives = string;
export type ProjectId = string;
export type ProtocolUrl = string;
export type ReviewType = string;
export type Success = true;
export type Title = string;

export interface GetReviewDefinitionResponse {
  criteria: Criteria;
  keywords: Keywords;
  objectives: Objectives;
  project_id: ProjectId;
  protocol_url: ProtocolUrl;
  review_type: ReviewType;
  success?: Success;
  title: Title;
  [k: string]: unknown;
}
export interface Criteria {
  [k: string]: CriterionInfo;
}
export interface CriterionInfo {
  comment?: Comment;
  criterion_type: CriterionType;
  explanation: Explanation;
  [k: string]: unknown;
}

// get_screen_queue
export type BasePath = string | null;
export type Limit = number;
export type ProjectId = string;
export type TaskId = string | null;
export type Verbose = boolean;

export interface GetScreenQueueRequest {
  base_path?: BasePath;
  limit?: Limit;
  project_id: ProjectId;
  task_id?: TaskId;
  verbose?: Verbose;
}

export type Comment = string;
export type CriterionType = string;
export type Explanation = string;
export type ProjectId = string;
export type Author = string;
export type Id = string;
export type Title = string;
export type Year = string;
export type Records = ScreenQueueRecord[];
export type Success = true;
export type TotalCount = number;

export interface GetScreenQueueResponse {
  criteria: Criteria;
  project_id: ProjectId;
  records: Records;
  success?: Success;
  total_count: TotalCount;
  [k: string]: unknown;
}
export interface Criteria {
  [k: string]: ScreenCriterionInfo;
}
export interface ScreenCriterionInfo {
  comment?: Comment;
  criterion_type?: CriterionType;
  explanation?: Explanation;
  [k: string]: unknown;
}
export interface ScreenQueueRecord {
  author?: Author;
  id: Id;
  title?: Title;
  year?: Year;
  [k: string]: unknown;
}

// get_screening_criteria
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetScreeningCriteriaRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Comment = string | null;
export type CriterionType = string;
export type Explanation = string;
export type ProjectId = string;
export type Success = true;

export interface GetScreeningCriteriaResponse {
  criteria: Criteria;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Criteria {
  [k: string]: CriterionInfo;
}
export interface CriterionInfo {
  comment?: Comment;
  criterion_type: CriterionType;
  explanation: Explanation;
  [k: string]: unknown;
}

// get_settings
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetSettingsRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

export interface GetSettingsResponse {
  project_id: ProjectId;
  settings: Settings;
  success?: Success;
  [k: string]: unknown;
}
export interface Settings {}

// get_source_records
export type BasePath = string | null;
export type Filename = string | null;
export type Limit = number;
export type Offset = number;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetSourceRecordsRequest {
  base_path?: BasePath;
  filename?: Filename;
  pagination?: PaginationRequest | null;
  project_id: ProjectId;
  verbose?: Verbose;
}
export interface PaginationRequest {
  limit?: Limit;
  offset?: Offset;
}

export type Filename = string;
export type HasMore = boolean;
export type Limit = number;
export type Offset = number;
export type ProjectId = string;
export type Records = SourceRecord[];
export type Success = true;
export type TotalCount = number;

export interface GetSourceRecordsResponse {
  filename: Filename;
  pagination: PaginationInfo;
  project_id: ProjectId;
  records: Records;
  success?: Success;
  total_count: TotalCount;
  [k: string]: unknown;
}
export interface PaginationInfo {
  has_more: HasMore;
  limit: Limit;
  offset: Offset;
}
export interface SourceRecord {
  [k: string]: unknown;
}

// get_sources
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetSourcesRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Sources = SourceInfo[];
export type Success = true;

export interface GetSourcesResponse {
  project_id: ProjectId;
  sources: Sources;
  success?: Success;
  [k: string]: unknown;
}
export interface SourceInfo {
  [k: string]: unknown;
}

// get_status
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetStatusRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Path = string;
export type ProjectId = string;
export type Success = true;

/**
 * Nested ``status`` payload is deliberately an untyped dict.
 */
export interface GetStatusResponse {
  path: Path;
  project_id: ProjectId;
  status: Status;
  success?: Success;
  [k: string]: unknown;
}
export interface Status {}

// include_all_screen
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface IncludeAllScreenRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Message = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface IncludeAllScreenResponse {
  message: Message;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// init_project
export type BasePath = string;
export type Example = boolean;
export type ForceMode = boolean;
export type Light = boolean;
export type ProjectId = string;
export type ReviewType = string;
export type Title = string | null;

export interface InitProjectRequest {
  base_path?: BasePath;
  example?: Example;
  force_mode?: ForceMode;
  light?: Light;
  project_id: ProjectId;
  review_type?: ReviewType;
  title?: Title;
}

export type Message = string;
export type Path = string;
export type ProjectId = string;
export type ReviewType = string;
export type Success = true;

export interface InitProjectResponse {
  message: Message;
  path: Path;
  project_id: ProjectId;
  review_type: ReviewType;
  success?: Success;
  [k: string]: unknown;
}

// list_managed_review_tasks
export type BasePath = string | null;
export type Kind = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface ListManagedReviewTasksRequest {
  base_path?: BasePath;
  kind: Kind;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type ProjectId = string;
export type Success = true;

/**
 * All managed-review responses share the same envelope: success +
 * project_id plus an open dict of service-specific fields.
 */
export interface ManagedReviewResponse {
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// list_projects
export type BasePath = string;

export interface ListProjectsRequest {
  base_path?: BasePath;
}

export type Id = string;
export type Path = string;
export type Title = string;
export type Projects = ProjectListItem[];
export type Success = true;

export interface ListProjectsResponse {
  projects: Projects;
  success?: Success;
  [k: string]: unknown;
}
export interface ProjectListItem {
  id: Id;
  path: Path;
  title: Title;
  [k: string]: unknown;
}

// load
export type BasePath = string | null;
export type KeepIds = boolean;
export type ProjectId = string;
export type Verbose = boolean;

export interface LoadRequest {
  base_path?: BasePath;
  keep_ids?: KeepIds;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface LoadResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// mark_pdf_not_available
export type BasePath = string | null;
export type ProjectId = string;
export type RecordId = string;
export type Verbose = boolean;

export interface MarkPDFNotAvailableRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  record_id: RecordId;
  verbose?: Verbose;
}

export type NewStatus = string;
export type ProjectId = string;
export type RecordId = string;
export type Success = true;

export interface MarkPDFNotAvailableResponse {
  new_status: NewStatus;
  project_id: ProjectId;
  record_id: RecordId;
  success?: Success;
  [k: string]: unknown;
}

// match_pdf_to_records
export type BasePath = string | null;
export type Content = string;
export type Filename = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface MatchPDFToRecordsRequest {
  base_path?: BasePath;
  content: Content;
  filename: Filename;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type RecordId = string;
export type Similarity = number;
export type Author = string;
export type Doi = string;
export type Title = string;
export type Year = string;
export type ExtractionMethod = "pdf_metadata" | "filename_only" | "none";
export type Filename = string;
export type Author1 = string;
export type RecordId1 = string;
export type Similarity1 = number;
export type Title1 = string;
export type Year1 = string;
export type Matches = PDFMatchCandidate[];
export type ProjectId = string;
export type Success = true;

export interface MatchPDFToRecordsResponse {
  best_match?: BestMatch | null;
  extracted_metadata?: ExtractedMetadata | null;
  extraction_method: ExtractionMethod;
  filename: Filename;
  matches: Matches;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface BestMatch {
  record_id: RecordId;
  similarity: Similarity;
  [k: string]: unknown;
}
export interface ExtractedMetadata {
  author?: Author;
  doi?: Doi;
  title?: Title;
  year?: Year;
  [k: string]: unknown;
}
export interface PDFMatchCandidate {
  author?: Author1;
  record_id: RecordId1;
  similarity: Similarity1;
  title?: Title1;
  year?: Year1;
  [k: string]: unknown;
}

// pdf_get
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface PDFGetRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface PDFGetResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// pdf_prep
export type BasePath = string | null;
export type BatchSize = number;
export type ProjectId = string;
export type Reprocess = boolean;
export type Verbose = boolean;

export interface PDFPrepRequest {
  base_path?: BasePath;
  batch_size?: BatchSize;
  project_id: ProjectId;
  reprocess?: Reprocess;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface PDFPrepResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// ping
export type BasePath = string | null;

export interface PingRequest {
  base_path?: BasePath;
}

export type Status = "pong";
export type Success = true;

export interface PingResponse {
  status?: Status;
  success?: Success;
  [k: string]: unknown;
}

// prep
export type BasePath = string | null;
export type ProjectId = string;
export type UseMinimalPrep = boolean;
export type Verbose = boolean;

export interface PrepRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  use_minimal_prep?: UseMinimalPrep;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface PrepResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// prep_man_update_record
export type BasePath = string | null;
export type ProjectId = string;
export type RecordId = string;
export type Verbose = boolean;

export interface PrepManUpdateRecordRequest {
  base_path?: BasePath;
  fields: Fields;
  project_id: ProjectId;
  record_id: RecordId;
  verbose?: Verbose;
}
export interface Fields {}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface PrepManUpdateRecordResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// prescreen
export type BasePath = string | null;
export type ProjectId = string;
export type SplitStr = string;
export type Verbose = boolean;

export interface PrescreenBatchRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  split_str?: SplitStr;
  verbose?: Verbose;
}

export type Message = string;
export type Operation = string;
export type ProjectId = string;
export type SplitStr = string;
export type Success = true;

export interface PrescreenBatchResponse {
  message: Message;
  operation: Operation;
  project_id: ProjectId;
  split_str: SplitStr;
  success?: Success;
  [k: string]: unknown;
}

// prescreen_record
export type BasePath = string | null;
export type Decision = "include" | "exclude";
export type ProjectId = string;
export type RecordId = string;
export type TaskId = string | null;
export type Verbose = boolean;

export interface PrescreenRecordRequest {
  base_path?: BasePath;
  decision: Decision;
  project_id: ProjectId;
  record_id: RecordId;
  task_id?: TaskId;
  verbose?: Verbose;
}

export type AlreadyDecided = boolean;
export type ProjectId = string;
export type Decision = "include" | "exclude";
export type Id = string;
export type NewStatus = string;
export type RemainingCount = number;
export type Success = true;

export interface PrescreenRecordResponse {
  already_decided?: AlreadyDecided;
  project_id: ProjectId;
  record: PrescreenedRecord;
  remaining_count: RemainingCount;
  success?: Success;
  [k: string]: unknown;
}
export interface PrescreenedRecord {
  decision: Decision;
  id: Id;
  new_status: NewStatus;
}

// remove_screening_criterion
export type BasePath = string | null;
export type CriterionName = string;
export type ProjectId = string;
export type Verbose = boolean;

export interface RemoveScreeningCriterionRequest {
  base_path?: BasePath;
  criterion_name: CriterionName;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface RemoveScreeningCriterionResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// remove_source
export type BasePath = string | null;
export type DeleteFile = boolean;
export type Filename = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface RemoveSourceRequest {
  base_path?: BasePath;
  delete_file?: DeleteFile;
  filename?: Filename;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Message = string;
export type Message1 = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface RemoveSourceResponse {
  details: RemoveSourceDetails;
  message: Message1;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface RemoveSourceDetails {
  message: Message;
  [k: string]: unknown;
}

// save_data_extraction
export type BasePath = string | null;
export type ProjectId = string;
export type RecordId = string;
export type Verbose = boolean;

export interface SaveDataExtractionRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  record_id: RecordId;
  values: Values;
  verbose?: Verbose;
}
export interface Values {}

export type Message = string;
export type ProjectId = string;
export type RecordId = string;
export type RemainingCount = number;
export type Success = true;

export interface SaveDataExtractionResponse {
  message: Message;
  project_id: ProjectId;
  record_id: RecordId;
  remaining_count: RemainingCount;
  success?: Success;
  [k: string]: unknown;
}

// screen
export type BasePath = string | null;
export type ProjectId = string;
export type SplitStr = string;
export type Verbose = boolean;

export interface ScreenBatchRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  split_str?: SplitStr;
  verbose?: Verbose;
}

export type Message = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface ScreenBatchResponse {
  message: Message;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// screen_record
export type BasePath = string | null;
export type Decision = "include" | "exclude";
export type ProjectId = string;
export type RecordId = string;
export type TaskId = string | null;
export type Verbose = boolean;

export interface ScreenRecordRequest {
  base_path?: BasePath;
  criteria_decisions?: CriteriaDecisions;
  decision: Decision;
  project_id: ProjectId;
  record_id: RecordId;
  task_id?: TaskId;
  verbose?: Verbose;
}
export interface CriteriaDecisions {
  [k: string]: "in" | "out" | "TODO";
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface ScreenRecordResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// search
export type BasePath = string | null;
export type ProjectId = string;
export type Rerun = boolean;
export type Source = string;
export type Verbose = boolean;

export interface SearchRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  rerun?: Rerun;
  source?: Source;
  verbose?: Verbose;
}

export type Message = string;
export type Rerun = boolean;
export type Source = string;
export type Message1 = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface SearchResponse {
  details: SearchDetails;
  message: Message1;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface SearchDetails {
  message: Message;
  rerun: Rerun;
  source: Source;
  [k: string]: unknown;
}

// status
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface GetStatusRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Path = string;
export type ProjectId = string;
export type Success = true;

/**
 * Nested ``status`` payload is deliberately an untyped dict.
 */
export interface GetStatusResponse {
  path: Path;
  project_id: ProjectId;
  status: Status;
  success?: Success;
  [k: string]: unknown;
}
export interface Status {}

// undo_pdf_not_available
export type BasePath = string | null;
export type ProjectId = string;
export type RecordId = string;
export type Verbose = boolean;

export interface UndoPDFNotAvailableRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  record_id: RecordId;
  verbose?: Verbose;
}

export type NewStatus = string;
export type ProjectId = string;
export type RecordId = string;
export type Success = true;

export interface UndoPDFNotAvailableResponse {
  new_status: NewStatus;
  project_id: ProjectId;
  record_id: RecordId;
  success?: Success;
  [k: string]: unknown;
}

// update_prescreen_decisions
export type BasePath = string | null;
export type Decision = "include" | "exclude";
export type RecordId = string;
export type Changes = PrescreenDecisionChange[];
export type ProjectId = string;
export type Verbose = boolean;

export interface UpdatePrescreenDecisionsRequest {
  base_path?: BasePath;
  changes: Changes;
  project_id: ProjectId;
  verbose?: Verbose;
}
export interface PrescreenDecisionChange {
  decision: Decision;
  record_id: RecordId;
}

export type ChangesCount = number;
export type Message = string;
export type ProjectId = string;
export type Reason = string;
export type RecordId = string;
export type Skipped = SkippedChange[];
export type Success = true;
export type UpdatedRecords = string[];

export interface UpdatePrescreenDecisionsResponse {
  changes_count: ChangesCount;
  message: Message;
  project_id: ProjectId;
  skipped: Skipped;
  success?: Success;
  updated_records: UpdatedRecords;
  [k: string]: unknown;
}
export interface SkippedChange {
  reason: Reason;
  record_id: RecordId;
}

// update_record
export type BasePath = string | null;
export type Fields = {} | null;
export type ProjectId = string;
export type RecordId = string | null;
export type Verbose = boolean;

export interface UpdateRecordRequest {
  base_path?: BasePath;
  fields?: Fields;
  project_id: ProjectId;
  record_id?: RecordId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface UpdateRecordResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// update_review_definition
export type BasePath = string | null;
export type Keywords = string[] | null;
export type Objectives = string | null;
export type ProjectId = string;
export type ProtocolUrl = string | null;
export type Verbose = boolean;

export interface UpdateReviewDefinitionRequest {
  base_path?: BasePath;
  keywords?: Keywords;
  objectives?: Objectives;
  project_id: ProjectId;
  protocol_url?: ProtocolUrl;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface UpdateReviewDefinitionResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// update_screen_decisions
export type BasePath = string | null;
export type Decision = "include" | "exclude";
export type RecordId = string;
export type Changes = ScreenDecisionChange[];
export type ProjectId = string;
export type Verbose = boolean;

export interface UpdateScreenDecisionsRequest {
  base_path?: BasePath;
  changes: Changes;
  project_id: ProjectId;
  verbose?: Verbose;
}
export interface ScreenDecisionChange {
  decision: Decision;
  record_id: RecordId;
}

export type ChangesCount = number;
export type Message = string;
export type ProjectId = string;
export type Reason = string;
export type RecordId = string;
export type Skipped = SkippedChange[];
export type Success = true;
export type UpdatedRecords = string[];

export interface UpdateScreenDecisionsResponse {
  changes_count: ChangesCount;
  message: Message;
  project_id: ProjectId;
  skipped: Skipped;
  success?: Success;
  updated_records: UpdatedRecords;
  [k: string]: unknown;
}
export interface SkippedChange {
  reason: Reason;
  record_id: RecordId;
}

// update_screening_criterion
export type BasePath = string | null;
export type Comment = string | null;
export type CriterionName = string;
export type CriterionType = string | null;
export type Explanation = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface UpdateScreeningCriterionRequest {
  base_path?: BasePath;
  comment?: Comment;
  criterion_name: CriterionName;
  criterion_type?: CriterionType;
  explanation?: Explanation;
  project_id: ProjectId;
  verbose?: Verbose;
}

export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface UpdateScreeningCriterionResponse {
  details: Details;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// update_settings
export type BasePath = string | null;
export type ProjectId = string;
export type Verbose = boolean;

export interface UpdateSettingsRequest {
  base_path?: BasePath;
  project_id: ProjectId;
  settings: Settings;
  verbose?: Verbose;
}
export interface Settings {}

export type Message = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface UpdateSettingsResponse {
  details: Details;
  message: Message;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

// update_source
export type BasePath = string | null;
export type Filename = string | null;
export type ProjectId = string;
export type RunDate = string | null;
export type SearchParameters = {} | null;
export type SearchString = string | null;
export type Verbose = boolean;

export interface UpdateSourceRequest {
  base_path?: BasePath;
  filename?: Filename;
  project_id: ProjectId;
  run_date?: RunDate;
  search_parameters?: SearchParameters;
  search_string?: SearchString;
  verbose?: Verbose;
}

export type Message = string;
export type Message1 = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface UpdateSourceResponse {
  details: UpdateSourceDetails;
  message: Message1;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface UpdateSourceDetails {
  message: Message;
  source: Source;
  [k: string]: unknown;
}
export interface Source {}

// upload_pdf
export type BasePath = string | null;
export type Content = string;
export type Filename = string;
export type ProjectId = string;
export type RecordId = string;
export type Verbose = boolean;

export interface UploadPDFRequest {
  base_path?: BasePath;
  content: Content;
  filename: Filename;
  project_id: ProjectId;
  record_id: RecordId;
  verbose?: Verbose;
}

export type FilePath = string;
export type NewStatus = string;
export type PrepMessage = string | null;
export type PrepStatus = string;
export type ProjectId = string;
export type RecordId = string;
export type Success = true;

export interface UploadPDFResponse {
  file_path: FilePath;
  new_status: NewStatus;
  prep_message?: PrepMessage;
  prep_status?: PrepStatus;
  project_id: ProjectId;
  record_id: RecordId;
  success?: Success;
  [k: string]: unknown;
}

// upload_search_file
export type BasePath = string | null;
export type Content = string | null;
export type Encoding = string;
export type Filename = string | null;
export type ProjectId = string;
export type SourceTemplate = string | null;
export type Verbose = boolean;

export interface UploadSearchFileRequest {
  base_path?: BasePath;
  content?: Content;
  encoding?: Encoding;
  filename?: Filename;
  project_id: ProjectId;
  source_template?: SourceTemplate;
  verbose?: Verbose;
}

export type DetectedFormat = string;
export type Message = string;
export type Path = string;
export type ProjectId = string;
export type Success = true;

export interface UploadSearchFileResponse {
  detected_format: DetectedFormat;
  message: Message;
  path: Path;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}

// validate
export type BasePath = string | null;
export type FilterSetting = string;
export type ProjectId = string;
export type Scope = string;
export type Verbose = boolean;

export interface ValidateRequest {
  base_path?: BasePath;
  filter_setting?: FilterSetting;
  project_id: ProjectId;
  scope?: Scope;
  verbose?: Verbose;
}

export type Message = string;
export type Operation = string;
export type ProjectId = string;
export type Success = true;

export interface ValidateResponse {
  details: Details;
  message: Message;
  operation: Operation;
  project_id: ProjectId;
  success?: Success;
  [k: string]: unknown;
}
export interface Details {}

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
  "export_reconciliation_audit": {
    params: ExportReconciliationAuditRequest;
    result: ExportReconciliationAuditResponse;
  };
  "get_branch_delta": {
    params: GetBranchDeltaRequest;
    result: GetBranchDeltaResponse;
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
