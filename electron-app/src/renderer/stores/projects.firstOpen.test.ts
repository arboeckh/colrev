/**
 * Opening a project decides whether to move it to `dev`. The git snapshot is
 * only loaded after the project (`git.initialize()` runs later), so the decision
 * used to be made against a null snapshot, which reads as branch `main`: a repo
 * already on dev was checked out again on every open, and one left on a
 * reviewer branch was moved to dev without publishing its decisions first.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  branchDeltaResponse,
  setupRendererTest,
  settingsResponse,
  statusResponse,
  tasksResponse,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';
import { useGitStore } from './git';
import { useProjectsStore } from './projects';
import { useBackendStore } from './backend';

let ctx: RendererTestContext;

beforeEach(() => {
  ctx = setupRendererTest();
  useBackendStore().status = 'running';
  ctx.mock.rpc
    .on('get_status', statusResponse())
    .on('get_settings', settingsResponse())
    .on('get_branch_delta', branchDeltaResponse())
    .on('list_managed_review_tasks', (p) => tasksResponse(p.kind));
});

/** The main process knows the branch; the renderer has not read it yet. */
function repoIsOn(branch: string, overrides: Record<string, unknown> = {}) {
  ctx.setGitState({ branch, ...overrides });
  useGitStore().snapshots = {};
  useGitStore().branches = [{ name: 'dev' } as never];
}

describe('loadProject branch decision', () => {
  it('leaves a repo that is already on dev where it is', async () => {
    repoIsOn('dev');

    await useProjectsStore().loadProject(TEST_PROJECT_ID);

    expect(ctx.mock.gitState.refresh).toHaveBeenCalled();
    expect(ctx.mock.git.checkout).not.toHaveBeenCalled();
  });

  it('moves a repo on main to dev', async () => {
    repoIsOn('main');

    await useProjectsStore().loadProject(TEST_PROJECT_ID);

    expect(ctx.mock.git.checkout).toHaveBeenCalledWith(expect.anything(), 'dev');
  });

  it('publishes a reviewer branch before leaving it for dev', async () => {
    repoIsOn('review/prescreen/t1/alice', {
      ahead: 2,
      remoteUrl: 'https://github.com/acme/lit-review.git',
    });

    await useProjectsStore().loadProject(TEST_PROJECT_ID);

    const push = ctx.mock.git.push.mock.invocationCallOrder[0];
    const checkout = ctx.mock.git.checkout.mock.invocationCallOrder[0];
    expect(push).toBeDefined();
    expect(push).toBeLessThan(checkout);
  });
});
