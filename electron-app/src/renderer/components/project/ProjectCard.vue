<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { FolderOpen, Loader2, AlertCircle, Trash2, Github } from 'lucide-vue-next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectsStore, type ProjectListItem } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import { useConnectionStore } from '@/stores/connection';
import { useGitStore } from '@/stores/git';

const props = defineProps<{
  project: ProjectListItem;
}>();

const emit = defineEmits<{
  deleted: [projectId: string];
}>();

const router = useRouter();
const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const connection = useConnectionStore();
const git = useGitStore();

const showDeleteDialog = ref(false);
const isDeleting = ref(false);
const deleteGithubToo = ref(false);

const totalRecords = computed(() => {
  return props.project.status?.records?.total ?? 0;
});

// `overall.currently` never existed on the wire (latent drift bug — the badge
// always fell back to 'Unknown'); the step shown is the next operation.
// `next_operation` is null once every record is synthesized — that's a
// finished review, not an unknown state.
const currentStep = computed(() => {
  if (!props.project.status) return 'Unknown';
  return props.project.status.next_operation ?? 'complete';
});

const projectTitle = computed(() => {
  return props.project.title || props.project.id;
});

function openProject() {
  if (!props.project.loading && !isDeleting.value) {
    router.push(`/project/${props.project.id}`);
  }
}

// Git facts come from the one snapshot (WP-07 §2), keyed by project id.
const gitState = computed(() => git.snapshotFor(props.project.id));

function hasGitHubRemote(): boolean {
  const url = gitState.value?.remoteUrl;
  return !!url && url.includes('github.com');
}

function onDeleteClick(event: Event) {
  event.stopPropagation();
  deleteGithubToo.value = false;
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  isDeleting.value = true;

  try {
    // Delete GitHub repo first if requested
    const remoteUrl = gitState.value?.remoteUrl;
    if (deleteGithubToo.value && remoteUrl) {
      const ghResult = await window.github.deleteRepo({ remoteUrl });
      if (!ghResult.success) {
        notifications.error('Failed to delete GitHub repository', ghResult.error ?? 'Unknown error');
        isDeleting.value = false;
        return;
      }
    }

    const response = await backend.call('delete_project', {
      project_id: props.project.id,
    });

    if (response.success) {
      const suffix = deleteGithubToo.value ? ' and GitHub repository' : '';
      notifications.success('Review deleted', `Deleted ${props.project.id}${suffix}`);
      projects.removeProject(props.project.id);
      emit('deleted', props.project.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to delete review', message);
  } finally {
    isDeleting.value = false;
    showDeleteDialog.value = false;
  }
}
</script>

<template>
  <Card
    class="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group"
    :class="{ 'opacity-50': project.loading || isDeleting }"
    :data-testid="`project-card-${project.id}`"
    @click="openProject"
  >
    <CardHeader class="pb-2">
      <div class="flex items-start justify-between gap-2">
        <CardTitle class="text-base font-medium truncate flex items-center gap-2">
          <FolderOpen class="h-4 w-4 text-muted-foreground flex-shrink-0" />
          {{ projectTitle }}
        </CardTitle>
        <div class="flex items-center gap-1">
          <Loader2 v-if="project.loading || isDeleting" class="h-4 w-4 animate-spin text-muted-foreground" />
          <Button
            v-else
            variant="ghost"
            size="icon"
            class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            data-testid="delete-project-button"
            @click="onDeleteClick"
          >
            <Trash2 class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-3">
      <!-- Error state -->
      <div v-if="project.error" class="flex items-center gap-2 text-destructive text-sm">
        <AlertCircle class="h-4 w-4" />
        <span class="truncate">{{ project.error }}</span>
      </div>

      <!-- Status info -->
      <template v-else-if="project.status">
        <div class="flex items-center justify-between text-sm">
          <span class="text-muted-foreground">Records</span>
          <span class="font-medium tabular-nums">{{ totalRecords }}</span>
        </div>

        <div class="flex items-center justify-between text-sm">
          <span class="text-muted-foreground">Current step</span>
          <Badge variant="secondary" class="font-normal">{{ currentStep }}</Badge>
        </div>

      </template>

      <!-- Loading placeholder -->
      <template v-else>
        <div class="space-y-2">
          <div class="h-4 bg-muted rounded animate-pulse" />
          <div class="h-4 bg-muted rounded animate-pulse w-2/3" />
        </div>
      </template>
    </CardContent>
  </Card>

  <!-- Delete confirmation dialog -->
  <Dialog v-model:open="showDeleteDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete Review</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete "{{ projectTitle }}"? This action cannot be undone
          and will permanently remove all local review files.
        </DialogDescription>
      </DialogHeader>

      <!-- GitHub delete option -->
      <div
        v-if="hasGitHubRemote()"
        class="flex items-start gap-3 rounded-md border p-3"
        :class="deleteGithubToo ? 'border-destructive bg-destructive/5' : 'border-border'"
        :title="connection.isOnline ? undefined : 'Requires internet'"
      >
        <Checkbox
          :checked="deleteGithubToo"
          :disabled="!connection.isOnline"
          data-testid="delete-github-checkbox"
          @update:checked="deleteGithubToo = $event"
        />
        <div class="space-y-1">
          <label
            class="text-sm font-medium flex items-center gap-1.5"
            :class="connection.isOnline ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
            @click="connection.isOnline && (deleteGithubToo = !deleteGithubToo)"
          >
            <Github class="h-4 w-4" />
            Also delete GitHub repository
          </label>
          <p class="text-xs text-muted-foreground">
            This will permanently delete the repository on GitHub. All collaborators will lose access.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isDeleting"
          @click="showDeleteDialog = false"
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          :disabled="isDeleting"
          data-testid="confirm-delete-project"
          @click="confirmDelete"
        >
          <Loader2 v-if="isDeleting" class="h-4 w-4 mr-2 animate-spin" />
          {{ deleteGithubToo ? 'Delete Local & GitHub' : 'Delete Local' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
