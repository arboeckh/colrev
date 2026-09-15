import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useBackendStore } from '@/stores/backend';
import { useGitStore } from '@/stores/git';
import { useSyncStore } from '@/stores/sync';
import { useProjectsStore } from '@/stores/projects';
import type {
  GetCurrentManagedReviewTaskResponse,
  ListManagedReviewTasksResponse,
  ManagedReviewTask,
} from '@/types/generated/rpc';

export type ManagedReviewKind = 'prescreen' | 'screen';

export type ManagedAccessState = 'loading' | 'switching' | 'ready' | 'blocked';

/** The branch a managed review is coordinated from. */
export const WORKING_BRANCH = 'dev';

function isReviewerBranch(branch: string): boolean {
  return branch.startsWith('review/');
}

/**
 * The reviewer-branch invariant, in one place (WP-07 §6).
 *
 * A reviewer works on `review/<kind>/<task>/<login>`; everyone else, and every
 * page outside a managed review step, belongs on `dev`. This used to be
 * implemented twice — verbatim — in PrescreenPage and ScreenPage, with two
 * more switch sites (the router guard and the workflow page) racing them.
 */
export function useManagedTaskAccess(kind: ManagedReviewKind) {
  const auth = useAuthStore();
  const backend = useBackendStore();
  const git = useGitStore();
  const projects = useProjectsStore();

  /** The task whose queue this branch serves, if the current branch is one. */
  const managedTask = ref<GetCurrentManagedReviewTaskResponse['task']>(null);
  /** The in-flight task for this step, whether or not we can work on it. */
  const activeManagedTask = ref<ManagedReviewTask | null>(null);
  const assignedReviewerBranch = ref<string | null>(null);
  const accessState = ref<ManagedAccessState>('loading');

  const isManagedAccessBlocked = computed(() => accessState.value === 'blocked');

  const assignedReviewer = computed(() => {
    const login = auth.user?.login?.toLowerCase();
    if (!activeManagedTask.value || !login) return null;
    return (
      activeManagedTask.value.reviewers.find(
        (reviewer) => reviewer.github_login.toLowerCase() === login,
      ) ?? null
    );
  });

  async function loadManagedTask(): Promise<void> {
    if (!projects.currentProjectId || !backend.isRunning) return;
    try {
      const response = await backend.call('get_current_managed_review_task', {
        project_id: projects.currentProjectId,
        kind,
      });
      managedTask.value = response.task;
    } catch {
      managedTask.value = null;
    }
  }

  /**
   * Put the user on the branch this step should be worked from, and report
   * whether the queue can be loaded.
   *
   * Returns false when the step is off limits — an active task the user is not
   * a reviewer on, or a branch switch the user declined (a dirty tree opens
   * BranchSwitchBlockedDialog rather than stashing; see WP-07 §1).
   */
  async function ensureAccess(): Promise<boolean> {
    if (!projects.currentProjectId || !backend.isRunning) return false;

    accessState.value = 'loading';
    activeManagedTask.value = null;
    assignedReviewerBranch.value = null;

    // Already on a branch that serves a task queue: nothing to arrange.
    await loadManagedTask();
    if (managedTask.value) {
      activeManagedTask.value = managedTask.value;
      accessState.value = 'ready';
      return true;
    }

    let tasksResponse: ListManagedReviewTasksResponse;
    try {
      tasksResponse = await backend.call('list_managed_review_tasks', {
        project_id: projects.currentProjectId,
        kind,
      });
    } catch {
      // No managed-review information: fall back to unmanaged access.
      accessState.value = 'ready';
      return true;
    }

    const activeTask = tasksResponse.tasks.find((task) => task.state === 'active') ?? null;
    activeManagedTask.value = activeTask;
    if (!activeTask) {
      accessState.value = 'ready';
      return true;
    }

    const reviewer = assignedReviewer.value;
    if (!reviewer) {
      // Someone else's task is in flight — decisions must come from a
      // reviewer branch, so this step is read-only for us.
      accessState.value = 'blocked';
      return false;
    }

    assignedReviewerBranch.value = reviewer.branch_name;
    if (git.currentBranch !== reviewer.branch_name) {
      accessState.value = 'switching';
      // Fetch first so the reviewer branch exists locally to check out.
      if (git.hasRemote) await useSyncStore().fetchNow();
      // Coming off another review (prescreen -> screen) leaves that branch too.
      await publishReviewerBranch();
      if (!(await git.switchBranch(reviewer.branch_name))) {
        accessState.value = 'blocked';
        return false;
      }
    }

    await loadManagedTask();
    activeManagedTask.value = managedTask.value ?? activeTask;
    accessState.value = managedTask.value ? 'ready' : 'blocked';
    return managedTask.value !== null;
  }

  return {
    managedTask,
    activeManagedTask,
    assignedReviewerBranch,
    assignedReviewer,
    accessState,
    isManagedAccessBlocked,
    loadManagedTask,
    ensureAccess,
  };
}

/**
 * Put the user on the branch the project is coordinated from, creating it if
 * this project has never had one.
 *
 * The single "get me to dev" call: launch and reconcile panels, the read-only
 * banner, publishing and the router guard all went through their own copy of
 * this, which is how four switch sites ended up racing each other.
 *
 * Returns false when the switch did not happen — most often a dirty tree the
 * user chose not to resolve (WP-07 §1).
 */
export async function ensureWorkingBranch(): Promise<boolean> {
  const git = useGitStore();
  if (git.currentBranch === WORKING_BRANCH) return true;
  // ensureDevBranch only guarantees the branch exists (it may find it on the
  // remote, e.g. a collaborator's fresh clone of the default branch) — the
  // checkout still has to happen, or the user is left on an empty `main`.
  if (!git.hasDevBranch && !(await git.ensureDevBranch())) return false;
  await publishReviewerBranch();
  return git.switchBranch(WORKING_BRANCH);
}

/**
 * Share the reviewer branch the user is standing on, before they leave it.
 *
 * A reviewer branch exists to carry one person's decisions to reconciliation,
 * which — like the co-reviewer's progress view — reads it from the remote. The
 * sync coordinator only ever pushes the checked-out branch, and holds off while
 * a review walkthrough is open, so once the user is back on dev nothing would
 * push it: they saw themselves finished while their co-reviewer saw them at 0,
 * and reconciliation could not start for either of them.
 *
 * Every way off a reviewer branch comes through here — `ensureWorkingBranch`,
 * the save-then-switch dialog, moving between two reviews.
 *
 * A failed push does not stop the user leaving: being offline must not trap
 * anyone on a reviewer branch. The coordinator reports the failure, and the
 * workflow page shares the branch on the next visit (`shareUnpublishedReviews`).
 */
export async function publishReviewerBranch(): Promise<boolean> {
  const git = useGitStore();
  if (!isReviewerBranch(git.currentBranch) || !git.hasRemote) return true;
  await git.refreshStatus();
  // Nothing to share — or the branch has diverged, where a push would be
  // refused and the sync banner owns the resolution.
  if (git.ahead === 0 || git.behind > 0) return true;
  return useSyncStore().pushNow();
}

/**
 * Share this user's reviewer branches that hold decisions the remote lacks.
 *
 * Leaving a reviewer branch shares it (`publishReviewerBranch`), but not every
 * departure gets that chance: the push can fail while offline, and reviews
 * worked before that existed already carry decisions that were saved and never
 * pushed. Such a reviewer sees themselves finished while their co-reviewer sees
 * them at 0, and neither of them can reconcile. The review workflow page calls
 * this on arrival, which is when that picture is read.
 *
 * Only in-flight tasks and only this user's branches (nobody else commits to
 * them here) — and never the checked-out branch, which the sync loop pushes.
 * Returns the branches it shared.
 */
export async function shareUnpublishedReviews(tasks: ManagedReviewTask[]): Promise<string[]> {
  const auth = useAuthStore();
  const git = useGitStore();
  const login = auth.user?.login?.toLowerCase();
  if (!login || !git.hasRemote) return [];

  const shared: string[] = [];
  for (const task of tasks) {
    if (task.state !== 'active') continue;
    for (const reviewer of task.reviewer_progress) {
      if (reviewer.github_login.toLowerCase() !== login) continue;
      if (!reviewer.unpublished_count) continue;
      if (reviewer.branch_name === git.currentBranch) continue;
      if (await useSyncStore().pushBranchNow(reviewer.branch_name)) {
        shared.push(reviewer.branch_name);
      }
    }
  }
  return shared;
}

/**
 * Leave a reviewer branch. Called when navigating away from a managed review
 * step — reviewer branches are temporary, and everything else reads `dev`.
 */
export async function leaveReviewerBranch(): Promise<boolean> {
  const git = useGitStore();
  if (!isReviewerBranch(git.currentBranch)) return true;
  return ensureWorkingBranch();
}

/**
 * Retire reviewer branches once their decisions are reconciled into `dev`.
 *
 * Reviewer branches are temporary by design, but nothing used to delete them,
 * so every completed task left a pair behind on origin forever. The
 * reconciliation audit in the manifest is the durable record of what they
 * contained, which is what makes deleting them safe.
 *
 * Both deletions are idempotent, so a partial failure can be retried by
 * running reconciliation cleanup again.
 */
export async function retireReviewerBranches(
  branches: string[],
): Promise<{ deleted: string[]; failed: string[] }> {
  const git = useGitStore();
  const projects = useProjectsStore();

  const projectPath = projects.currentProject?.path;
  const deleted: string[] = [];
  const failed: string[] = [];
  if (!projectPath) return { deleted, failed };

  // Never delete the branch we are standing on, and never touch a branch that
  // isn't a reviewer branch.
  const targets = branches.filter(
    (branch) => isReviewerBranch(branch) && branch !== git.currentBranch,
  );

  for (const branch of targets) {
    const remote = git.hasRemote
      ? await window.git.deleteRemoteBranch(projectPath, branch)
      : { success: true };
    const local = await window.git.deleteLocalBranch(projectPath, branch);
    if (remote.success && local.success) deleted.push(branch);
    else failed.push(branch);
  }

  if (deleted.length > 0) await git.refreshBranches();
  return { deleted, failed };
}

export { isReviewerBranch };
