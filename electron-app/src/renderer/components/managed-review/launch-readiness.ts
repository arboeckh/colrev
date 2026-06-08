import type { Ref } from 'vue';
import type { useGitStore } from '@/stores/git';
import type { useNotificationsStore } from '@/stores/notifications';
import type { useProjectsStore } from '@/stores/projects';

export interface MappedIssue {
  message: string;
  action?: { label: string; handler: () => Promise<void>; isRunning: Ref<boolean> };
}

type GitStore = ReturnType<typeof useGitStore>;
type ProjectsStore = ReturnType<typeof useProjectsStore>;
type NotificationsStore = ReturnType<typeof useNotificationsStore>;

const GIT_REPO_ISSUE_MARKERS = ['fully synced', 'clean before'] as const;

function isGitRepoIssue(raw: string): boolean {
  return GIT_REPO_ISSUE_MARKERS.some((marker) => raw.includes(marker));
}

function createSaveAndSyncIssue(ctx: {
  isResolvingIssue: Ref<boolean>;
  git: GitStore;
  projects: ProjectsStore;
  notifications: NotificationsStore;
  refreshData: () => Promise<void>;
}): MappedIssue {
  return {
    message: 'Save and sync your changes before starting.',
    action: {
      label: 'Save & sync',
      isRunning: ctx.isResolvingIssue,
      handler: async () => {
        ctx.isResolvingIssue.value = true;
        try {
          const path = ctx.projects.currentProject?.path;
          if (path && !ctx.git.isClean) {
            await window.git.addAndCommit(path, 'Save changes before review launch');
            await ctx.git.refreshStatus();
          }
          if (ctx.git.hasRemote) {
            if (ctx.git.ahead > 0) await ctx.git.push();
            if (ctx.git.behind > 0) await ctx.git.pull();
          }
          await ctx.refreshData();
        } catch (err) {
          ctx.notifications.error('Save failed', err instanceof Error ? err.message : 'Unknown error');
        } finally {
          ctx.isResolvingIssue.value = false;
        }
      },
    },
  };
}

function mapSingleIssue(raw: string): MappedIssue | null {
  if (isGitRepoIssue(raw)) {
    return null;
  }
  if (raw.includes('already covers')) {
    return null;
  }
  if (raw.includes('only available from the dev')) {
    return null;
  }
  if (raw.includes('No records are ready')) {
    return { message: 'There are no records ready for review yet. Complete the earlier steps first.' };
  }
  if (raw.includes('track a remote branch')) {
    return { message: "This project isn't connected to a remote yet. Push your changes first." };
  }
  if (raw.includes('remote repository is required')) {
    return { message: 'A remote repository (e.g. GitHub) is required for collaborative review.' };
  }
  if (raw.includes('Finish PDF retrieval')) {
    return { message: 'Complete PDF retrieval and preparation before starting the screen review.' };
  }
  if (raw.includes('Resolve or abort')) {
    return { message: 'There is a merge conflict that needs to be resolved first.' };
  }
  return { message: raw };
}

export function mapReadinessIssues(
  rawIssues: string[],
  ctx: {
    isResolvingIssue: Ref<boolean>;
    git: GitStore;
    projects: ProjectsStore;
    notifications: NotificationsStore;
    refreshData: () => Promise<void>;
  },
): MappedIssue[] {
  const mapped = rawIssues
    .map(mapSingleIssue)
    .filter((issue): issue is MappedIssue => issue !== null);

  if (rawIssues.some(isGitRepoIssue)) {
    mapped.unshift(createSaveAndSyncIssue(ctx));
  }

  return mapped;
}
