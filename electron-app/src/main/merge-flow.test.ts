import { describe, it, expect, vi } from 'vitest';
import {
  analyzeDivergenceFlow,
  applyMergeFlow,
  type MergeFlowDeps,
} from './merge-flow';

const PROJECT = { projectPath: '/projects/alice/lit-review', projectId: 'lit-review' };

function makeDeps(overrides: Partial<MergeFlowDeps> = {}): MergeFlowDeps {
  return {
    getBranchAndUpstream: vi.fn().mockResolvedValue({
      success: true,
      branch: 'dev',
      upstream: 'origin/some-branch',
    }),
    callBackend: vi.fn().mockResolvedValue({}),
    push: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe('analyzeDivergenceFlow', () => {
  it('calls analyze_merge with the actual branch and upstream', async () => {
    const deps = makeDeps({
      callBackend: vi.fn().mockResolvedValue({
        auto_mergeable: true,
        status_conflicts: [],
        settings_conflicts: [],
        blockers: [],
      }),
    });

    const result = await analyzeDivergenceFlow(deps, PROJECT);

    expect(deps.callBackend).toHaveBeenCalledWith('analyze_merge', {
      project_id: 'lit-review',
      ours: 'dev',
      theirs: 'origin/some-branch',
    });
    expect(result.success).toBe(true);
    expect(result.analysis).toEqual({
      hasConflicts: false,
      autoMergeable: true,
      conflicts: [],
      blockers: [],
    });
  });

  it('maps status and settings conflicts into renderer conflict items', async () => {
    const deps = makeDeps({
      callBackend: vi.fn().mockResolvedValue({
        auto_mergeable: false,
        status_conflicts: [
          {
            id: 'Smith2020',
            ours: 'rev_prescreen_included',
            theirs: 'rev_prescreen_excluded',
            title: 'A title',
            author: 'Smith, John and Doe, Jane',
            year: '2020',
          },
        ],
        settings_conflicts: [
          { path: 'project.title', ours: 'Mine', theirs: 'Theirs' },
        ],
        blockers: [],
      }),
    });

    const result = await analyzeDivergenceFlow(deps, PROJECT);

    expect(result.success).toBe(true);
    expect(result.analysis!.hasConflicts).toBe(true);
    expect(result.analysis!.conflicts).toEqual([
      {
        id: 'records:Smith2020',
        file: 'data/records.bib',
        path: 'Smith2020',
        label: 'Smith, John (2020)',
        description: '"A title"',
        localValue: 'rev_prescreen_included',
        remoteValue: 'rev_prescreen_excluded',
        localLabel: 'Prescreen Included',
        remoteLabel: 'Prescreen Excluded',
      },
      {
        id: 'settings:project.title',
        file: 'settings.json',
        path: 'project.title',
        label: 'Project > Title',
        localValue: 'Mine',
        remoteValue: 'Theirs',
        localLabel: 'Mine',
        remoteLabel: 'Theirs',
      },
    ]);
  });

  it('passes blockers through', async () => {
    const deps = makeDeps({
      callBackend: vi.fn().mockResolvedValue({
        auto_mergeable: false,
        status_conflicts: [],
        settings_conflicts: [],
        blockers: [{ id: 'data/records.bib', reason: 'changed record fields: Smith2020' }],
      }),
    });

    const result = await analyzeDivergenceFlow(deps, PROJECT);
    expect(result.analysis!.blockers).toEqual([
      { id: 'data/records.bib', reason: 'changed record fields: Smith2020' },
    ]);
  });

  it('fails when there is no upstream tracking branch', async () => {
    const deps = makeDeps({
      getBranchAndUpstream: vi.fn().mockResolvedValue({
        success: false,
        branch: 'main',
        error: "Branch 'main' has no upstream tracking branch",
      }),
    });

    const result = await analyzeDivergenceFlow(deps, PROJECT);
    expect(result.success).toBe(false);
    expect(result.error).toContain('no upstream');
    expect(deps.callBackend).not.toHaveBeenCalled();
  });

  it('reports backend errors', async () => {
    const deps = makeDeps({
      callBackend: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await analyzeDivergenceFlow(deps, PROJECT);
    expect(result).toEqual({ success: false, error: 'boom' });
  });
});

describe('applyMergeFlow', () => {
  it('splits resolutions by kind, maps local/remote to ours/theirs, then pushes', async () => {
    const deps = makeDeps({
      callBackend: vi.fn().mockResolvedValue({ merged: true, commit_sha: 'abc' }),
    });

    const result = await applyMergeFlow(deps, {
      ...PROJECT,
      resolutions: [
        { id: 'records:Smith2020', choice: 'remote' },
        { id: 'records:Doe2021', choice: 'local' },
        { id: 'settings:project.title', choice: 'remote' },
      ],
    });

    expect(deps.callBackend).toHaveBeenCalledWith('apply_merge', {
      project_id: 'lit-review',
      theirs: 'origin/some-branch',
      resolutions: { Smith2020: 'theirs', Doe2021: 'ours' },
      settings_resolutions: { 'project.title': 'theirs' },
    });
    expect(deps.push).toHaveBeenCalledWith(PROJECT.projectPath);
    expect(result).toEqual({ success: true, pushed: true });
  });

  it('does not push when the engine merge fails, and reports the error', async () => {
    const deps = makeDeps({
      callBackend: vi.fn().mockRejectedValue(new Error('Merge blocked: drift')),
    });

    const result = await applyMergeFlow(deps, { ...PROJECT, resolutions: [] });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Merge blocked');
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('reports an unpushed local merge honestly when the push fails', async () => {
    const deps = makeDeps({
      callBackend: vi.fn().mockResolvedValue({ merged: true, commit_sha: 'abc' }),
      push: vi.fn().mockResolvedValue({ success: false, error: 'network down' }),
    });

    const result = await applyMergeFlow(deps, { ...PROJECT, resolutions: [] });

    expect(result).toEqual({ success: true, pushed: false, pushError: 'network down' });
  });

  it('fails before merging when there is no upstream', async () => {
    const deps = makeDeps({
      getBranchAndUpstream: vi.fn().mockResolvedValue({ success: false, error: 'no upstream' }),
    });

    const result = await applyMergeFlow(deps, { ...PROJECT, resolutions: [] });
    expect(result.success).toBe(false);
    expect(deps.callBackend).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });
});
