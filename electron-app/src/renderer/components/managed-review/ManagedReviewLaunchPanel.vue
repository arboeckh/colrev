<script setup lang="ts">
import { computed, onMounted, ref, type Ref } from 'vue';
import { AlertTriangle, CheckCircle2, Loader2, UserPlus } from 'lucide-vue-next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ReviewerSelector } from '@/components/common';
import { CriteriaList } from '@/components/review-definition';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import { useAuthStore } from '@/stores/auth';
import { useGitStore } from '@/stores/git';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useReadOnly } from '@/composables/useReadOnly';
import type {
  CreateManagedReviewTaskResponse,
  GetCurrentManagedReviewTaskResponse,
  ListManagedReviewTasksResponse,
  ManagedReviewReadinessResponse,
  ManagedReviewTask,
} from '@/types/api';
import type { GitHubCollaborator } from '@/types/window';

const props = defineProps<{
  kind: 'prescreen' | 'screen';
}>();

const emit = defineEmits<{
  taskCreated: [];
}>();

const backend = useBackendStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();
const auth = useAuthStore();
const git = useGitStore();
const reviewDefStore = useReviewDefinitionStore();
const { isReadOnly } = useReadOnly();

const isLoading = ref(false);
const isCreating = ref(false);
const readiness = ref<ManagedReviewReadinessResponse | null>(null);
const tasks = ref<ManagedReviewTask[]>([]);
const currentBranchTask = ref<ManagedReviewTask | null>(null);
const collaborators = ref<GitHubCollaborator[]>([]);
const isLoadingCollaborators = ref(false);
const reviewerA = ref('');
const reviewerB = ref('');

// Invite collaborator state
const showInviteForm = ref(false);
const inviteUsername = ref('');
const isInviting = ref(false);

const kindLabel = computed(() => (props.kind === 'screen' ? 'Screen' : 'Prescreen'));
const activeTask = computed(() => tasks.value.find((task) => ['active', 'reconciling'].includes(task.state)) ?? null);
const displayTask = computed(() => activeTask.value ?? tasks.value[0] ?? null);
const remoteUrl = computed(() => projects.currentGitStatus?.remote_url ?? null);

// Screen-only: criteria are required to launch and editable only on dev
const showCriteria = computed(() => props.kind === 'screen');
const criteria = computed(() => reviewDefStore.definition?.criteria ?? {});
const criteriaCount = computed(() => Object.keys(criteria.value).length);
const criteriaReadOnly = computed(() => !git.isOnDev || !!activeTask.value || isReadOnly.value);

// Map backend issue strings to user-friendly messages with optional actions
interface MappedIssue {
  message: string;
  action?: { label: string; handler: () => Promise<void>; isRunning: Ref<boolean> };
}

const isResolvingIssue = ref(false);

function mapIssue(raw: string): MappedIssue | null {
  if (raw.includes('fully synced')) {
    return {
      message: 'You have unsaved changes. Sync them before starting.',
      action: {
        label: 'Sync now',
        isRunning: isResolvingIssue,
        handler: async () => {
          isResolvingIssue.value = true;
          try {
            if (git.ahead > 0) await git.push();
            if (git.behind > 0) await git.pull();
            await refreshData();
          } finally {
            isResolvingIssue.value = false;
          }
        },
      },
    };
  }
  if (raw.includes('clean before')) {
    return {
      message: 'You have uncommitted changes. Save your work first.',
      action: {
        label: 'Save now',
        isRunning: isResolvingIssue,
        handler: async () => {
          isResolvingIssue.value = true;
          try {
            const path = projects.currentProject?.path;
            if (path) {
              await window.git.addAndCommit(path, 'Save changes before review launch');
              if (git.hasRemote) {
                await git.push();
              }
            }
            await refreshData();
          } catch (err) {
            notifications.error('Save failed', err instanceof Error ? err.message : 'Unknown error');
          } finally {
            isResolvingIssue.value = false;
          }
        },
      },
    };
  }
  if (raw.includes('already covers')) {
    // Active task exists — UI already hides create form when a task is present
    return null;
  }
  if (raw.includes('only available from the dev')) {
    // Auto-handled by ManagedReviewWorkflowPage's phase watcher
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
  // Fallback: return as-is
  return { message: raw };
}

const mappedIssues = computed<MappedIssue[]>(() => {
  if (!readiness.value?.issues?.length) return [];
  return readiness.value.issues.map(mapIssue).filter((issue): issue is MappedIssue => issue !== null);
});

function collaboratorAvatar(login: string): string | null {
  return collaborators.value.find((c) => c.login === login)?.avatarUrl ?? null;
}

function prettyDate(value?: string | null) {
  if (!value) return 'Not finished';
  return new Date(value).toLocaleString();
}

async function loadCollaborators() {
  collaborators.value = [];
  if (!remoteUrl.value || !remoteUrl.value.includes('github.com')) return;

  isLoadingCollaborators.value = true;
  try {
    const result = await window.github.listCollaborators({ remoteUrl: remoteUrl.value });
    if (result.success) {
      collaborators.value = result.collaborators;
    }
  } finally {
    isLoadingCollaborators.value = false;
  }
}

async function refreshData() {
  if (!projects.currentProjectId || !backend.isRunning) return;

  isLoading.value = true;
  try {
    // Fetch remote refs so we can see other reviewers' progress
    if (git.hasRemote) {
      await git.fetch();
    }
    const [readinessResponse, tasksResponse, currentTaskResponse] = await Promise.all([
      backend.call<ManagedReviewReadinessResponse>('get_managed_review_task_readiness', {
        project_id: projects.currentProjectId,
        kind: props.kind,
      }),
      backend.call<ListManagedReviewTasksResponse>('list_managed_review_tasks', {
        project_id: projects.currentProjectId,
        kind: props.kind,
      }),
      backend.call<GetCurrentManagedReviewTaskResponse>('get_current_managed_review_task', {
        project_id: projects.currentProjectId,
        kind: props.kind,
      }),
    ]);

    readiness.value = readinessResponse;
    tasks.value = tasksResponse.tasks;
    currentBranchTask.value = currentTaskResponse.task;
  } catch (err) {
    notifications.error(`${kindLabel.value} launch failed`, err instanceof Error ? err.message : 'Unknown error');
  } finally {
    isLoading.value = false;
  }
}

async function createBranches(task: ManagedReviewTask, launchRef: string) {
  if (!projects.currentProject?.path) return;
  const path = projects.currentProject.path;
  const myLogin = auth.user?.login?.toLowerCase();

  // Create and push all reviewer branches
  for (const reviewer of task.reviewers) {
    const createResult = await window.git.createLocalBranch(path, reviewer.branch_name, launchRef);
    if (!createResult.success && !createResult.error?.includes('already exists')) {
      throw new Error(createResult.error || `Failed to create ${reviewer.branch_name}`);
    }

    const pushResult = await window.git.pushBranch(path, reviewer.branch_name);
    if (!pushResult.success) {
      throw new Error(pushResult.error || `Failed to push ${reviewer.branch_name}`);
    }
  }

  // Delete local branches for other reviewers so _branch_ref uses
  // the remote ref (which stays up-to-date after fetch). Without this,
  // the stale local branch would make the other reviewer's progress
  // always show as 0.
  for (const reviewer of task.reviewers) {
    if (reviewer.github_login.toLowerCase() !== myLogin) {
      await window.git.deleteLocalBranch(path, reviewer.branch_name);
    }
  }
}

async function createTask() {
  if (!projects.currentProjectId || !reviewerA.value || !reviewerB.value) return;

  isCreating.value = true;
  try {
    const response = await backend.call<CreateManagedReviewTaskResponse>('create_managed_review_task', {
      project_id: projects.currentProjectId,
      kind: props.kind,
      reviewer_logins: [reviewerA.value, reviewerB.value],
      created_by: auth.user?.login ?? 'local-user',
    });

    await createBranches(response.task, response.launch_ref);

    // Push dev branch so the other reviewer can see the task manifest
    if (git.hasRemote) {
      await git.push();
    }

    notifications.success(
      `${kindLabel.value} task created`,
      `Launched reviewer branches for ${response.task.id}`,
    );
    reviewerA.value = '';
    reviewerB.value = '';
    await refreshData();
    emit('taskCreated');
  } catch (err) {
    notifications.error(
      `${kindLabel.value} launch failed`,
      err instanceof Error ? err.message : 'Unknown error',
    );
  } finally {
    isCreating.value = false;
  }
}

async function cancelTask() {
  if (!displayTask.value || !projects.currentProjectId) return;
  try {
    await backend.call('cancel_managed_review_task', {
      project_id: projects.currentProjectId,
      task_id: displayTask.value.id,
      canceled_by: auth.user?.login ?? 'local-user',
    });
    notifications.success('Task canceled');
    await refreshData();
  } catch (err) {
    notifications.error('Cancel failed', err instanceof Error ? err.message : 'Unknown error');
  }
}

async function handleAddCriterion(data: {
  name: string;
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await reviewDefStore.addCriterion(data);
  if (success) {
    notifications.success('Added', `Criterion "${data.name}" added`);
  } else {
    notifications.error('Failed', 'Could not add criterion');
  }
}

async function handleUpdateCriterion(name: string, data: {
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await reviewDefStore.updateCriterion({ criterion_name: name, ...data });
  if (success) {
    notifications.success('Updated', `Criterion "${name}" updated`);
  } else {
    notifications.error('Failed', 'Could not update criterion');
  }
}

async function handleDeleteCriterion(name: string) {
  const success = await reviewDefStore.removeCriterion(name);
  if (success) {
    notifications.success('Removed', `Criterion "${name}" removed`);
  } else {
    notifications.error('Failed', 'Could not remove criterion');
  }
}

async function inviteCollaborator() {
  if (!inviteUsername.value || !remoteUrl.value) return;
  isInviting.value = true;
  try {
    const result = await window.github.addCollaborator({
      remoteUrl: remoteUrl.value,
      username: inviteUsername.value,
    });
    if (result.success) {
      const msg = result.invited
        ? `Invitation sent to ${inviteUsername.value}`
        : `${inviteUsername.value} is already a collaborator`;
      notifications.success('Collaborator added', msg);
      inviteUsername.value = '';
      showInviteForm.value = false;
      await loadCollaborators();
    } else {
      notifications.error('Invite failed', result.error || 'Unknown error');
    }
  } catch (err) {
    notifications.error('Invite failed', err instanceof Error ? err.message : 'Unknown error');
  } finally {
    isInviting.value = false;
  }
}

onMounted(async () => {
  await refreshData();
  await loadCollaborators();
  if (showCriteria.value) {
    await reviewDefStore.loadDefinition();
  }
});

defineExpose({ refreshData, activeTask, tasks });
</script>

<template>
  <div class="space-y-6">
    <!-- Loading state -->
    <div v-if="isLoading && !readiness" class="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 class="h-4 w-4 animate-spin" />
      Checking readiness...
    </div>

    <template v-else>
      <!-- Readiness status -->
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <Badge :variant="readiness?.ready ? 'default' : 'secondary'">
            {{ readiness?.ready ? 'Ready' : 'Blocked' }}
          </Badge>
          <span class="text-sm text-muted-foreground">
            {{ readiness?.eligible_count ?? 0 }} eligible record{{ readiness?.eligible_count === 1 ? '' : 's' }}
          </span>
        </div>

        <div v-if="mappedIssues.length" class="space-y-1.5">
          <div
            v-for="(issue, idx) in mappedIssues"
            :key="idx"
            class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
            <span>{{ issue.message }}</span>
            <Button
              v-if="issue.action"
              variant="outline"
              size="sm"
              class="h-7 text-xs shrink-0"
              :disabled="issue.action.isRunning.value"
              @click="issue.action.handler"
            >
              <Loader2 v-if="issue.action.isRunning.value" class="h-3 w-3 mr-1 animate-spin" />
              {{ issue.action.label }}
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <!-- Screening criteria (screen kind only, dev branch only) -->
      <template v-if="showCriteria">
        <div class="space-y-3 max-w-md">
          <div class="flex items-baseline justify-between">
            <h3 class="text-sm font-medium">Screening criteria</h3>
            <span class="text-xs text-muted-foreground">
              {{ criteriaCount }} defined
            </span>
          </div>

          <div
            v-if="!git.isOnDev"
            class="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
            <span>Switch to the dev branch to edit screening criteria.</span>
          </div>
          <div
            v-else-if="activeTask"
            class="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
            <span>Criteria are frozen while a managed task is active. Cancel the task and relaunch to change them.</span>
          </div>

          <CriteriaList
            :criteria="criteria"
            :is-saving="reviewDefStore.isSaving"
            :read-only="criteriaReadOnly"
            @add-criterion="handleAddCriterion"
            @update-criterion="handleUpdateCriterion"
            @delete-criterion="handleDeleteCriterion"
          />
        </div>

        <Separator />
      </template>

      <!-- Create task form (when no active task) -->
      <div v-if="!activeTask" class="space-y-4">
        <div class="flex items-start gap-3">
          <div>
            <h3 class="text-sm font-medium">Assign Reviewers</h3>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ isLoadingCollaborators ? 'Loading collaborators...' : `${collaborators.length} collaborator${collaborators.length === 1 ? '' : 's'} available` }}
            </p>
          </div>
          <Button
            v-if="remoteUrl && !showInviteForm"
            variant="ghost"
            size="sm"
            class="gap-1.5 text-xs h-7"
            @click="showInviteForm = true"
          >
            <UserPlus class="h-3.5 w-3.5" />
            Invite
          </Button>
        </div>

        <!-- Invite collaborator inline form -->
        <div v-if="showInviteForm" class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 max-w-md">
          <UserPlus class="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            v-model="inviteUsername"
            class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            placeholder="GitHub username to invite..."
            @keydown.enter="inviteCollaborator"
          >
          <Button
            size="sm"
            class="h-6 text-xs px-2"
            :disabled="!inviteUsername || isInviting"
            @click="inviteCollaborator"
          >
            {{ isInviting ? 'Sending...' : 'Send Invite' }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 text-xs px-2"
            @click="showInviteForm = false; inviteUsername = ''"
          >
            Cancel
          </Button>
        </div>

        <!-- Reviewer selection dropdowns -->
        <div class="grid gap-4 md:grid-cols-2 max-w-md">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">Reviewer A</label>
            <ReviewerSelector
              v-model="reviewerA"
              :collaborators="collaborators"
              :exclude-login="reviewerB"
              :disabled="isLoadingCollaborators"
              placeholder="Select reviewer A..."
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">Reviewer B</label>
            <ReviewerSelector
              v-model="reviewerB"
              :collaborators="collaborators"
              :exclude-login="reviewerA"
              :disabled="isLoadingCollaborators"
              placeholder="Select reviewer B..."
            />
          </div>
        </div>

        <div class="flex items-center gap-3">
          <Button
            size="sm"
            :disabled="isReadOnly || isCreating || !readiness?.ready || !reviewerA || !reviewerB || reviewerA === reviewerB || (showCriteria && criteriaCount === 0)"
            @click="createTask"
          >
            {{ isCreating ? 'Launching...' : `Launch ${kindLabel} Task` }}
          </Button>
          <span v-if="reviewerA && reviewerB && reviewerA === reviewerB" class="text-xs text-destructive">
            Reviewers must be different
          </span>
          <span v-else-if="showCriteria && criteriaCount === 0" class="text-xs text-destructive">
            Add at least one screening criterion
          </span>
        </div>
      </div>

      <!-- Active/completed task display -->
      <div v-if="displayTask" class="space-y-4 max-w-md">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-medium">{{ displayTask.id }}</h3>
            <p class="text-xs text-muted-foreground">Created by {{ displayTask.created_by }} · {{ prettyDate(displayTask.created_at) }}</p>
          </div>
          <Badge :variant="displayTask.state === 'completed' ? 'default' : 'secondary'" class="text-xs">
            {{ displayTask.state }}
          </Badge>
        </div>

        <!-- Reviewer progress -->
        <div class="border border-border rounded-md overflow-hidden">
          <div
            v-for="(reviewer, index) in displayTask.reviewer_progress"
            :key="reviewer.role"
            class="flex items-center justify-between py-2.5 px-3"
            :class="index > 0 ? 'border-t border-border' : ''"
          >
            <div class="flex items-center gap-2">
              <Avatar class="h-5 w-5 shrink-0">
                <AvatarImage v-if="collaboratorAvatar(reviewer.github_login)" :src="collaboratorAvatar(reviewer.github_login)!" />
                <AvatarFallback class="text-[9px] bg-muted">{{ reviewer.github_login.slice(0, 2).toUpperCase() }}</AvatarFallback>
              </Avatar>
              <span class="text-sm font-medium">{{ reviewer.github_login }}</span>
              <span class="h-2 w-2 rounded-full shrink-0" :class="reviewer.available ? 'bg-green-500' : 'bg-muted-foreground/30'" />
            </div>
            <span class="text-xs text-muted-foreground tabular-nums">{{ reviewer.completed_count }} / {{ displayTask.record_count }}</span>
          </div>
        </div>

        <!-- Reconciliation summary -->
        <div v-if="displayTask.reconciliation_summary" class="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
          <span>Reconciled by {{ displayTask.reconciliation_summary.resolved_by }} — {{ displayTask.reconciliation_summary.auto_resolved_count }} auto, {{ displayTask.reconciliation_summary.manual_conflict_count }} manual</span>
        </div>

        <!-- Cancel button -->
        <Button
          v-if="displayTask.state !== 'completed' && displayTask.state !== 'aborted'"
          variant="ghost"
          size="sm"
          class="text-destructive hover:text-destructive"
          :disabled="isReadOnly"
          @click="cancelTask"
        >
          Cancel Task
        </Button>
      </div>
    </template>
  </div>
</template>
