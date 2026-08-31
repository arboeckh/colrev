/**
 * Store-test harness (WP-08 §1).
 *
 * `setupRendererTest()` gives every test the same starting point: a fresh
 * Pinia, a fresh typed `window.*` bridge mock, and a helper to put a project
 * "open" without walking the real load path. Stores are the real ones — only
 * the bridge is doubled, so the logic under test is the logic that ships.
 */
import { createPinia, setActivePinia } from 'pinia';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useProjectsStore } from '@/stores/projects';
import type { ManagedReviewTask, RPCResult } from '@/types/generated/rpc';
import type { ProjectStatus, RecordCounts, StatusStep } from '@/types/project';
import type { GitStateSnapshot } from '@/types/window';
import { installWindowMock, makeGitSnapshot, type WindowMock } from './window-mock';

/** The engine's pipeline operations, as they appear in `status.steps`. */
export const PIPELINE_OPERATIONS = [
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

export const TEST_PROJECT_ID = 'lit-review';
export const TEST_PROJECT_PATH = '/projects/alice/lit-review';

export interface RendererTestContext {
  mock: WindowMock;
  /**
   * Mark a project open and the backend running — the precondition almost
   * every store action checks before doing anything.
   */
  openProject(options?: { projectId?: string; path?: string }): void;
  /**
   * Put a git snapshot in place the way production does: the main process
   * owns it, hands it to the store, and answers the next `gitState.refresh`
   * with the same value.
   */
  setGitState(overrides?: Partial<GitStateSnapshot>): GitStateSnapshot;
}

export function setupRendererTest(): RendererTestContext {
  const mock = installWindowMock();
  setActivePinia(createPinia());
  let openProjectId = TEST_PROJECT_ID;

  return {
    mock,
    openProject({ projectId = TEST_PROJECT_ID, path = TEST_PROJECT_PATH } = {}) {
      const projects = useProjectsStore();
      const backend = useBackendStore();
      openProjectId = projectId;
      backend.status = 'running';
      projects.currentProjectId = projectId;
      projects.currentProject = {
        id: projectId,
        path,
        status: makeProjectStatus(),
        settings: null,
      };
    },
    setGitState(overrides = {}) {
      const snapshot = makeGitSnapshot({ projectId: openProjectId, ...overrides });
      mock.setGitSnapshot(snapshot);
      useGitStore().applySnapshot(snapshot);
      return snapshot;
    },
  };
}

export function makeRecordCounts(overrides: Partial<RecordCounts> = {}): RecordCounts {
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
    ...overrides,
  };
}

export function makeStatusStep(
  operation: string,
  overrides: Partial<StatusStep> = {},
): StatusStep {
  return {
    operation,
    state: 'ready',
    runnable: true,
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

export function makeProjectStatus(overrides: Partial<ProjectStatus> = {}): ProjectStatus {
  return {
    overall: {
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
    },
    currently: makeRecordCounts(),
    total_records: 0,
    next_operation: null,
    steps: PIPELINE_OPERATIONS.map((operation) => makeStatusStep(operation)),
    search_stale: false,
    stale_sources: [],
    completeness_condition: false,
    atomic_steps: 0,
    completed_atomic_steps: 0,
    has_changes: false,
    duplicates_removed: 0,
    nr_origins: 0,
    screening_statistics: {},
    ...overrides,
  };
}

// --- contract-typed response builders --------------------------------------
//
// Stubbed RPC results are typed as `RPCResult<M>`, so a backend model gaining
// a required field breaks these builders — in one place — rather than each
// test that happens to stub that method.

export function statusResponse(
  status: ProjectStatus = makeProjectStatus(),
  projectId = TEST_PROJECT_ID,
): RPCResult<'get_status'> {
  return {
    success: true,
    project_id: projectId,
    path: TEST_PROJECT_PATH,
    status: status as unknown as Record<string, unknown>,
  };
}

export function settingsResponse(
  settings: Record<string, unknown> = {},
  projectId = TEST_PROJECT_ID,
): RPCResult<'get_settings'> {
  return { success: true, project_id: projectId, settings };
}

export function tasksResponse(
  kind: 'prescreen' | 'screen',
  tasks: ManagedReviewTask[] = [],
  projectId = TEST_PROJECT_ID,
): RPCResult<'list_managed_review_tasks'> {
  return { success: true, project_id: projectId, kind, tasks };
}

export function branchDeltaResponse(
  overrides: Partial<RPCResult<'get_branch_delta'>> = {},
): RPCResult<'get_branch_delta'> {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    base_branch: 'main',
    current_branch: 'dev',
    source_branch: 'dev',
    changed_record_count: 0,
    new_record_count: 0,
    removed_record_count: 0,
    delta_by_state: {},
    source_branch_counts: {},
    ...overrides,
  };
}

export function reviewDefinitionResponse(
  overrides: Partial<RPCResult<'get_review_definition'>> = {},
): RPCResult<'get_review_definition'> {
  return {
    success: true,
    project_id: TEST_PROJECT_ID,
    title: 'A review',
    objectives: '',
    review_type: 'literature_review',
    protocol_url: '',
    keywords: [],
    criteria: {},
    ...overrides,
  };
}

/** The `{operation, details}` shape every pipeline operation answers with. */
export function operationResponse<M extends 'prep' | 'dedupe' | 'load' | 'pdf_get' | 'pdf_prep'>(
  operation: M,
  projectId = TEST_PROJECT_ID,
): RPCResult<M> {
  return { success: true, project_id: projectId, operation, details: {} } as RPCResult<M>;
}
