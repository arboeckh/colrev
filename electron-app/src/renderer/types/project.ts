// Project and record type definitions

export type RecordStatus =
  | 'md_retrieved'
  | 'md_imported'
  | 'md_needs_manual_preparation'
  | 'md_prepared'
  | 'md_processed'
  | 'rev_prescreen_excluded'
  | 'rev_prescreen_included'
  | 'pdf_needs_manual_retrieval'
  | 'pdf_imported'
  | 'pdf_needs_manual_preparation'
  | 'pdf_prepared'
  | 'rev_excluded'
  | 'rev_included'
  | 'rev_synthesized';

export interface Record {
  ID: string;
  ENTRYTYPE: string;
  colrev_status: RecordStatus;
  title?: string;
  author?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  abstract?: string;
  doi?: string;
  url?: string;
  file?: string;
  [key: string]: unknown;
}

export interface RecordCounts {
  md_retrieved: number;
  md_imported: number;
  md_needs_manual_preparation: number;
  md_prepared: number;
  md_processed: number;
  rev_prescreen_excluded: number;
  rev_prescreen_included: number;
  pdf_needs_manual_retrieval: number;
  pdf_imported: number;
  pdf_not_available: number;
  pdf_needs_manual_preparation: number;
  pdf_prepared: number;
  rev_excluded: number;
  rev_included: number;
  rev_synthesized: number;
  total: number;
}

export interface GitStatus {
  branch: string;
  is_clean: boolean;
  uncommitted_changes: number;
  untracked_files: string[];
  modified_files: string[];
  staged_files: string[];
  ahead: number;
  behind: number;
  remote_url: string | null;
  last_commit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
}

// Overall record counts (records that have ever been in each state)
export interface OverallRecordCounts {
  md_retrieved: number;
  md_imported: number;
  md_prepared: number;
  md_processed: number;
  rev_prescreen_excluded: number;
  rev_prescreen_included: number;
  pdf_not_available: number;
  pdf_imported: number;
  pdf_prepared: number;
  rev_excluded: number;
  rev_included: number;
  rev_synthesized: number;
}

export interface ProjectStatus {
  project_id?: string;
  path?: string;
  // Overall counts - records that have ever been in each state
  overall: OverallRecordCounts;
  // Currently counts - records currently in each state (this is what we need for workflow progress)
  currently: RecordCounts;
  total_records: number;
  next_operation: string | null;
  completeness_condition: boolean;
  atomic_steps: number;
  completed_atomic_steps: number;
  has_changes: boolean;
  duplicates_removed: number;
  nr_origins: number;
  screening_statistics: globalThis.Record<string, unknown>;
  // Legacy field for backwards compatibility (maps to 'currently')
  records?: RecordCounts;
}

export interface Project {
  id: string;
  path: string;
  status: ProjectStatus | null;
  gitStatus: GitStatus | null;
  settings: ProjectSettings | null;
}

export interface ProjectSettings {
  project: {
    title: string;
    review_type?: string;
    authors: Array<{
      name: string;
      initials: string;
      email?: string;
    }>;
    keywords?: string[];
    protocol?: {
      url?: string;
    };
  };
  sources: SearchSource[];
  search: {
    retrieve_forthcoming: boolean;
  };
  prep: {
    prep_rounds: Array<{
      name: string;
      prep_package_endpoints: Array<{
        endpoint: string;
      }>;
    }>;
  };
  dedupe: {
    dedupe_package_endpoints: Array<{
      endpoint: string;
    }>;
  };
  prescreen: {
    prescreen_package_endpoints: Array<{
      endpoint: string;
    }>;
  };
  pdf_get: {
    pdf_path_type: string;
    pdf_required_for_screen_and_synthesis: boolean;
    pdf_get_package_endpoints: Array<{
      endpoint: string;
    }>;
  };
  pdf_prep: {
    pdf_prep_package_endpoints: Array<{
      endpoint: string;
    }>;
  };
  screen: {
    screen_package_endpoints: Array<{
      endpoint: string;
    }>;
    criteria?: globalThis.Record<string, ScreenCriterion>;
  };
  data: {
    data_package_endpoints: Array<{
      endpoint: string;
    }>;
  };
}

export interface SearchSource {
  endpoint: string;
  search_type: 'API' | 'DB' | 'TOC' | 'BACKWARD_SEARCH' | 'FORWARD_SEARCH' | 'OTHER' | 'FILES' | 'MD';
  search_parameters: globalThis.Record<string, unknown>;
  filename: string;
  search_string?: string;
  search_results_path?: string;
  platform?: string;
  // Per-source staleness metadata
  record_count?: number;
  last_run_timestamp?: string | null;
  is_stale?: boolean;
  stale_reason?: string | null;
}

export interface ScreenCriterion {
  explanation: string;
  comment?: string;
  criterion_type?: 'inclusion_criterion' | 'exclusion_criterion';
}

// Branch delta comparison
export interface BranchDelta {
  base_branch: string;
  current_branch: string;
  new_record_count: number;
  removed_record_count: number;
  changed_record_count: number;
  delta_by_state: globalThis.Record<string, number>;
}

// Workflow step definitions
export type WorkflowStep =
  | 'review_definition'
  | 'search'
  | 'load'
  | 'prep'
  | 'dedupe'
  | 'prescreen'
  | 'pdf_get'
  | 'pdf_prep'
  | 'screen'
  | 'data';

export interface WorkflowStepInfo {
  id: WorkflowStep;
  label: string;
  description: string;
  route: string;
  // Record states that feed into this step (records waiting for this operation)
  // When all these counts are 0, the step is "complete" (no pending work)
  inputStates: (keyof RecordCounts)[];
  // Record states that indicate this step has processed records
  // Used to determine if the step has ever been run
  outputStates: (keyof RecordCounts)[];
  // Whether this is a grouped/combined step
  isGrouped?: boolean;
  // Sub-steps if this is a grouped step
  subSteps?: WorkflowStep[];
}

// Full workflow steps including the individual load/prep/dedupe for backwards compatibility
export const ALL_WORKFLOW_STEPS: WorkflowStepInfo[] = [
  {
    id: 'review_definition',
    label: 'Definition',
    description: 'Define review scope and criteria',
    route: 'review-definition',
    inputStates: [],
    outputStates: [],
  },
  {
    id: 'search',
    label: 'Search',
    description: 'Configure and run searches',
    route: 'search',
    inputStates: [], // Search doesn't consume records, it creates them
    outputStates: ['md_retrieved'], // Records waiting in search files
  },
  {
    id: 'load',
    label: 'Load',
    description: 'Import search results',
    route: 'load',
    inputStates: ['md_retrieved'],
    outputStates: ['md_imported', 'md_needs_manual_preparation'],
  },
  {
    id: 'prep',
    label: 'Prep',
    description: 'Prepare metadata',
    route: 'prep',
    inputStates: ['md_imported', 'md_needs_manual_preparation'],
    outputStates: ['md_prepared'],
  },
  {
    id: 'dedupe',
    label: 'Dedupe',
    description: 'Remove duplicates',
    route: 'dedupe',
    inputStates: ['md_prepared'],
    outputStates: ['md_processed'],
  },
  {
    id: 'prescreen',
    label: 'Prescreen',
    description: 'Title/abstract screening',
    route: 'prescreen',
    inputStates: ['md_processed'],
    outputStates: ['rev_prescreen_included', 'rev_prescreen_excluded'],
  },
  {
    id: 'pdf_get',
    label: 'PDF Get',
    description: 'Retrieve PDFs',
    route: 'pdf-get',
    inputStates: ['rev_prescreen_included', 'pdf_needs_manual_retrieval'],
    outputStates: ['pdf_imported', 'pdf_not_available'],
  },
  {
    id: 'pdf_prep',
    label: 'PDF Prep',
    description: 'Prepare PDFs',
    route: 'pdf-prep',
    inputStates: ['pdf_imported', 'pdf_needs_manual_preparation'],
    outputStates: ['pdf_prepared'],
  },
  {
    id: 'screen',
    label: 'Screen',
    description: 'Full-text screening',
    route: 'screen',
    inputStates: ['pdf_prepared'],
    outputStates: ['rev_included', 'rev_excluded'],
  },
  {
    id: 'data',
    label: 'Data',
    description: 'Data extraction',
    route: 'data',
    inputStates: ['rev_included'],
    outputStates: ['rev_synthesized'],
  },
];

// Grouped workflow steps for sidebar display (5 decision steps)
// Search absorbs preprocessing (load/prep/dedupe), Screen absorbs PDFs (pdf_get/pdf_prep)
export const WORKFLOW_STEPS: WorkflowStepInfo[] = [
  {
    id: 'review_definition',
    label: 'Definition',
    description: 'Define review scope and criteria',
    route: 'review-definition',
    inputStates: [],
    outputStates: [],
  },
  {
    id: 'search',
    label: 'Search',
    description: 'Search, load, prepare, and deduplicate records',
    route: 'search',
    // Combined input states from search + load/prep/dedupe
    inputStates: ['md_retrieved', 'md_imported', 'md_needs_manual_preparation', 'md_prepared'],
    outputStates: ['md_processed'],
    isGrouped: true,
    subSteps: ['load', 'prep', 'dedupe'],
  },
  {
    id: 'prescreen',
    label: 'Prescreen',
    description: 'Title/abstract screening',
    route: 'prescreen',
    inputStates: ['md_processed'],
    outputStates: ['rev_prescreen_included', 'rev_prescreen_excluded'],
  },
  {
    id: 'screen',
    label: 'Screen',
    description: 'PDF retrieval, preparation, and full-text screening',
    route: 'screen',
    // Combined input states from pdf_get/pdf_prep/screen
    inputStates: ['rev_prescreen_included', 'pdf_needs_manual_retrieval', 'pdf_imported', 'pdf_needs_manual_preparation', 'pdf_prepared'],
    outputStates: ['rev_included', 'rev_excluded'],
    isGrouped: true,
    subSteps: ['pdf_get', 'pdf_prep', 'screen'],
  },
  {
    id: 'data',
    label: 'Data',
    description: 'Data extraction',
    route: 'data',
    inputStates: ['rev_included'],
    outputStates: ['rev_synthesized'],
  },
];
