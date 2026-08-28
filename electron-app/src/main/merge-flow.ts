/**
 * Divergence-merge orchestration for collaborator sync.
 *
 * The engine (colrev core, via the `analyze_merge` / `apply_merge` RPCs)
 * owns all merge semantics — BibTeX parsing, status reconciliation,
 * status.yaml regeneration, settings.json field merge, and the two-parent
 * merge commit. This module is a thin, dependency-injected bridge between
 * the IPC surface and those RPCs plus the dugite push, so it can be unit
 * tested with a fake backend/git.
 */

// --- Renderer-facing analysis shape ---

export interface MergeConflictItem {
  /** "records:<record_id>" or "settings:<dotted.path>" */
  id: string;
  file: string;
  path: string;
  label: string;
  description?: string;
  localValue: unknown;
  remoteValue: unknown;
  localLabel?: string;
  remoteLabel?: string;
}

export interface MergeBlocker {
  id?: string;
  reason: string;
}

export interface MergeAnalysis {
  hasConflicts: boolean;
  autoMergeable: boolean;
  conflicts: MergeConflictItem[];
  blockers: MergeBlocker[];
}

export interface MergeConflictResolution {
  id: string;
  choice: 'local' | 'remote';
}

export interface AnalyzeDivergenceResult {
  success: boolean;
  analysis?: MergeAnalysis;
  error?: string;
}

export interface ApplyMergeResult {
  success: boolean;
  /** Only meaningful when success is true: whether the push reached the remote. */
  pushed?: boolean;
  pushError?: string;
  error?: string;
}

// --- RPC response shapes (mirror colrev/ui_jsonrpc merge_handler models) ---

interface StatusConflictRpc {
  id: string;
  ours: string;
  theirs: string;
  title?: string;
  author?: string;
  year?: string;
}

interface SettingsConflictRpc {
  path: string;
  ours?: unknown;
  theirs?: unknown;
}

interface AnalyzeMergeRpcResponse {
  auto_mergeable: boolean;
  status_conflicts?: StatusConflictRpc[];
  settings_conflicts?: SettingsConflictRpc[];
  blockers?: MergeBlocker[];
}

interface ApplyMergeRpcResponse {
  merged: boolean;
  commit_sha: string;
}

// --- Injected dependencies ---

export interface MergeFlowDeps {
  /** Resolve the current branch and its upstream tracking ref. */
  getBranchAndUpstream(projectPath: string): Promise<{
    success: boolean;
    branch?: string;
    upstream?: string;
    error?: string;
  }>;
  /** JSON-RPC call into the colrev backend. */
  callBackend<T>(method: string, params: Record<string, unknown>): Promise<T>;
  /** Push the current branch (auth handled by the caller's binding). */
  push(projectPath: string): Promise<{ success: boolean; error?: string }>;
}

export interface MergeFlowParams {
  projectPath: string;
  projectId: string;
}

// --- Display helpers ---

function formatStatus(status?: string): string {
  if (!status) return 'Unknown';
  return status
    .replace(/^(md_|rev_|pdf_)/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function recordLabel(conflict: StatusConflictRpc): string {
  const parts: string[] = [];
  if (conflict.author) {
    parts.push(conflict.author.split(' and ')[0].trim());
  }
  if (conflict.year) parts.push(`(${conflict.year})`);
  return parts.join(' ') || conflict.id;
}

function settingsLabel(path: string): string {
  return path
    .split('.')
    .map((seg) => seg.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' > ');
}

function formatSettingsValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value || '(empty)';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty list)';
    if (typeof value[0] === 'string') return value.join(', ');
    return `${value.length} item(s)`;
  }
  if (typeof value === 'object') {
    return `${Object.keys(value as Record<string, unknown>).length} fields`;
  }
  return String(value);
}

function toAnalysis(report: AnalyzeMergeRpcResponse): MergeAnalysis {
  const conflicts: MergeConflictItem[] = [];

  for (const c of report.status_conflicts ?? []) {
    conflicts.push({
      id: `records:${c.id}`,
      file: 'data/records.bib',
      path: c.id,
      label: recordLabel(c),
      description: c.title ? `"${c.title}"` : undefined,
      localValue: c.ours,
      remoteValue: c.theirs,
      localLabel: formatStatus(c.ours),
      remoteLabel: formatStatus(c.theirs),
    });
  }

  for (const c of report.settings_conflicts ?? []) {
    conflicts.push({
      id: `settings:${c.path}`,
      file: 'settings.json',
      path: c.path,
      label: settingsLabel(c.path),
      localValue: c.ours ?? null,
      remoteValue: c.theirs ?? null,
      localLabel: formatSettingsValue(c.ours),
      remoteLabel: formatSettingsValue(c.theirs),
    });
  }

  return {
    hasConflicts: conflicts.length > 0,
    autoMergeable: report.auto_mergeable,
    conflicts,
    blockers: report.blockers ?? [],
  };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// --- Flows ---

export async function analyzeDivergenceFlow(
  deps: MergeFlowDeps,
  params: MergeFlowParams,
): Promise<AnalyzeDivergenceResult> {
  try {
    const branchInfo = await deps.getBranchAndUpstream(params.projectPath);
    if (!branchInfo.success || !branchInfo.branch || !branchInfo.upstream) {
      return { success: false, error: branchInfo.error || 'No upstream tracking branch' };
    }

    const report = await deps.callBackend<AnalyzeMergeRpcResponse>('analyze_merge', {
      project_id: params.projectId,
      ours: branchInfo.branch,
      theirs: branchInfo.upstream,
    });

    return { success: true, analysis: toAnalysis(report) };
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Analysis failed') };
  }
}

export async function applyMergeFlow(
  deps: MergeFlowDeps,
  params: MergeFlowParams & { resolutions: MergeConflictResolution[] },
): Promise<ApplyMergeResult> {
  try {
    const branchInfo = await deps.getBranchAndUpstream(params.projectPath);
    if (!branchInfo.success || !branchInfo.branch || !branchInfo.upstream) {
      return { success: false, error: branchInfo.error || 'No upstream tracking branch' };
    }

    const resolutions: Record<string, 'ours' | 'theirs'> = {};
    const settingsResolutions: Record<string, 'ours' | 'theirs'> = {};
    for (const r of params.resolutions) {
      const side = r.choice === 'local' ? 'ours' : 'theirs';
      if (r.id.startsWith('records:')) {
        resolutions[r.id.slice('records:'.length)] = side;
      } else if (r.id.startsWith('settings:')) {
        settingsResolutions[r.id.slice('settings:'.length)] = side;
      }
    }

    // The engine merges, reconciles, and creates the two-parent merge
    // commit; on any failure it aborts the merge and throws — no repo
    // state to roll back here.
    await deps.callBackend<ApplyMergeRpcResponse>('apply_merge', {
      project_id: params.projectId,
      theirs: branchInfo.upstream,
      resolutions,
      settings_resolutions: settingsResolutions,
    });

    const pushResult = await deps.push(params.projectPath);
    if (!pushResult.success) {
      // Merged locally but not uploaded. Report honestly — the renderer
      // tells the user to push from the sync controls (the merge commit
      // makes the branch "ahead", so the push affordance is available).
      return { success: true, pushed: false, pushError: pushResult.error };
    }

    return { success: true, pushed: true };
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Merge failed') };
  }
}
