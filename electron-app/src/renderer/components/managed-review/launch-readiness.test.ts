/**
 * "Save & sync" before launching a managed review. It must commit through the
 * same RPC as every other save in the app and say so when the commit fails; the
 * old main-process `addAndCommit` ran the repo's git hooks, which a packaged
 * app cannot resolve, so the commit used to abort and the tree stayed dirty
 * with nothing said.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { setupRendererTest, TEST_PROJECT_ID, type RendererTestContext } from '@/test/harness';
import { useGitStore } from '@/stores/git';
import { useNotificationsStore } from '@/stores/notifications';
import { useProjectsStore } from '@/stores/projects';
import { useSyncStore } from '@/stores/sync';
import { mapReadinessIssues } from './launch-readiness';

let ctx: RendererTestContext;

function saveAndSync() {
  const refreshData = vi.fn(async () => undefined);
  const issues = mapReadinessIssues(['Working tree must be clean before launching'], {
    isResolvingIssue: ref(false),
    git: useGitStore(),
    sync: useSyncStore(),
    projects: useProjectsStore(),
    notifications: useNotificationsStore(),
    refreshData,
  });
  return { action: issues[0].action!, refreshData };
}

beforeEach(() => {
  ctx = setupRendererTest();
  ctx.openProject();
  ctx.setGitState({ branch: 'dev', remoteUrl: null, isClean: false, uncommittedChanges: 1 });
});

describe('Save & sync', () => {
  it('commits through the commit_changes RPC, not the hook-running git path', async () => {
    ctx.mock.rpc.on('commit_changes', () => ({
      success: true,
      project_id: TEST_PROJECT_ID,
      committed: true,
      message: 'ok',
    }));
    const { action, refreshData } = saveAndSync();

    await action.handler();

    expect(ctx.mock.rpc.callsTo('commit_changes')[0].params.message).toBe(
      'Save changes before review launch',
    );
    expect(refreshData).toHaveBeenCalled();
  });

  it('reports a failed commit and does not sync on top of it', async () => {
    ctx.mock.rpc.onError('commit_changes', { message: 'pre-commit hook failed' });
    const syncNow = vi.spyOn(useSyncStore(), 'syncNow');
    const { action, refreshData } = saveAndSync();

    await action.handler();

    expect(
      useNotificationsStore().history.some((n) => n.title === 'Commit failed'),
    ).toBe(true);
    expect(syncNow).not.toHaveBeenCalled();
    expect(refreshData).toHaveBeenCalled();
  });
});
