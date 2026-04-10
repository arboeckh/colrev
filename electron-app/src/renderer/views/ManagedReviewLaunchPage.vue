<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Users, AlertTriangle, CheckCircle2, RefreshCw, Loader2, UserPlus } from 'lucide-vue-next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ReviewerSelector } from '@/components/common';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import { useAuthStore } from '@/stores/auth';
import { useReadOnly } from '@/composables/useReadOnly';
import type {
  CreateManagedReviewTaskResponse,
  GetCurrentManagedReviewTaskResponse,
  ListManagedReviewTasksResponse,
  ManagedReviewReadinessResponse,
  ManagedReviewTask,
} from '@/types/api';
import type { GitHubCollaborator } from '@/types/window';

const route = useRoute();
const backend = useBackendStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();
const auth = useAuthStore();
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

const kind = computed<'prescreen' | 'screen'>(() =>
  route.meta.step === 'screen_launch' ? 'screen' : 'prescreen',
);
const kindLabel = computed(() => (kind.value === 'screen' ? 'Screen' : 'Prescreen'));
const activeTask = computed(() => tasks.value.find((task) => ['active', 'reconciling'].includes(task.state)) ?? null);
const displayTask = computed(() => activeTask.value ?? tasks.value[0] ?? null);
const remoteUrl = computed(() => projects.currentGitStatus?.remote_url ?? null);

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
    await projects.refreshCurrentProject();
    const [readinessResponse, tasksResponse, currentTaskResponse] = await Promise.all([
      backend.call<ManagedReviewReadinessResponse>('get_managed_review_task_readiness', {
        project_id: projects.currentProjectId,
        kind: kind.value,
      }),
      backend.call<ListManagedReviewTasksResponse>('list_managed_review_tasks', {
        project_id: projects.currentProjectId,
        kind: kind.value,
      }),
      backend.call<GetCurrentManagedReviewTaskResponse>('get_current_managed_review_task', {
        project_id: projects.currentProjectId,
        kind: kind.value,
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

  for (const reviewer of task.reviewers) {
    const createResult = await window.git.createLocalBranch(
      projects.currentProject.path,
      reviewer.branch_name,
      launchRef,
    );
    if (!createResult.success && !createResult.error?.includes('already exists')) {
      throw new Error(createResult.error || `Failed to create ${reviewer.branch_name}`);
    }

    const pushResult = await window.git.pushBranch(
      projects.currentProject.path,
      reviewer.branch_name,
    );
    if (!pushResult.success) {
      throw new Error(pushResult.error || `Failed to push ${reviewer.branch_name}`);
    }
  }
}

async function createTask() {
  if (!projects.currentProjectId || !reviewerA.value || !reviewerB.value) return;

  isCreating.value = true;
  try {
    const response = await backend.call<CreateManagedReviewTaskResponse>('create_managed_review_task', {
      project_id: projects.currentProjectId,
      kind: kind.value,
      reviewer_logins: [reviewerA.value, reviewerB.value],
      created_by: auth.user?.login ?? 'local-user',
    });

    await createBranches(response.task, response.launch_ref);
    notifications.success(
      `${kindLabel.value} task created`,
      `Launched reviewer branches for ${response.task.id}`,
    );
    reviewerA.value = '';
    reviewerB.value = '';
    await refreshData();
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

watch(kind, async () => {
  await refreshData();
  await loadCollaborators();
});

onMounted(async () => {
  await refreshData();
  await loadCollaborators();
});
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <Users class="h-6 w-6" />
          {{ kindLabel }} Launch
        </h2>
        <p class="text-muted-foreground text-sm">
          Assign two reviewers and launch the paired screening task.
        </p>
      </div>
      <Button variant="ghost" size="icon" :disabled="isLoading" @click="refreshData">
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoading }" />
      </Button>
    </div>

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

        <div v-if="readiness?.issues?.length" class="space-y-1.5">
          <div
            v-for="issue in readiness.issues"
            :key="issue"
            class="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle class="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{{ issue }}</span>
          </div>
        </div>
      </div>

      <!-- Active assignment notice -->
      <div v-if="currentBranchTask" class="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
        <span>You are assigned to task <code class="font-mono text-xs">{{ currentBranchTask.id }}</code>. Navigate to the <strong>{{ kindLabel }}</strong> step to continue.</span>
      </div>

      <Separator />

      <!-- Create task form (when no active task) -->
      <div v-if="!activeTask" class="space-y-4">
        <div class="flex items-center justify-between">
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
        <div v-if="showInviteForm" class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
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
        <div class="grid gap-4 md:grid-cols-2">
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
            :disabled="isReadOnly || isCreating || !readiness?.ready || !reviewerA || !reviewerB || reviewerA === reviewerB"
            @click="createTask"
          >
            {{ isCreating ? 'Launching…' : `Launch ${kindLabel} Task` }}
          </Button>
          <span v-if="reviewerA && reviewerB && reviewerA === reviewerB" class="text-xs text-destructive">
            Reviewers must be different
          </span>
        </div>
      </div>

      <!-- Active/completed task display -->
      <div v-if="displayTask" class="space-y-4">
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
