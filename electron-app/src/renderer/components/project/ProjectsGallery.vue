<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Loader2, AlertCircle, Trash2, Github } from 'lucide-vue-next';
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

defineProps<{
  projects: ProjectListItem[];
}>();

const router = useRouter();
const projectsStore = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const connection = useConnectionStore();
const git = useGitStore();

const showDeleteDialog = ref(false);
const projectToDelete = ref<ProjectListItem | null>(null);
const isDeleting = ref(false);
const deleteGithubToo = ref(false);
// Whether the project being deleted has a GitHub remote. Read for that one
// project when the dialog opens — the gallery itself reads no repos.
const deleteTargetRemoteUrl = ref<string | null>(null);

function openProject(project: ProjectListItem) {
  if (!isDeleting.value) {
    router.push(`/project/${project.id}`);
  }
}

// Two letters are enough to tell the tiles apart at a glance without asking
// the list to describe each review.
function initials(project: ProjectListItem): string {
  const name = project.title || project.id;
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

async function onDeleteClick(event: Event, project: ProjectListItem) {
  event.stopPropagation();
  projectToDelete.value = project;
  deleteGithubToo.value = false;
  deleteTargetRemoteUrl.value = git.snapshotFor(project.id)?.remoteUrl ?? null;
  showDeleteDialog.value = true;

  if (!deleteTargetRemoteUrl.value) {
    await git.refreshSnapshotFor(project.id, project.path);
    if (projectToDelete.value?.id === project.id) {
      deleteTargetRemoteUrl.value = git.snapshotFor(project.id)?.remoteUrl ?? null;
    }
  }
}

function hasGitHubRemote(): boolean {
  const url = deleteTargetRemoteUrl.value;
  return !!url && url.includes('github.com');
}

async function confirmDelete() {
  if (!projectToDelete.value) return;

  isDeleting.value = true;

  try {
    const remoteUrl = deleteTargetRemoteUrl.value;
    if (deleteGithubToo.value && remoteUrl) {
      const ghResult = await window.github.deleteRepo({ remoteUrl });
      if (!ghResult.success) {
        notifications.error('Failed to delete GitHub repository', ghResult.error ?? 'Unknown error');
        isDeleting.value = false;
        return;
      }
    }

    const response = await backend.call('delete_project', {
      project_id: projectToDelete.value.id,
    });

    if (response.success) {
      const suffix = deleteGithubToo.value ? ' and GitHub repository' : '';
      notifications.success('Review deleted', `Deleted ${projectToDelete.value.id}${suffix}`);
      projectsStore.removeProject(projectToDelete.value.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to delete review', message);
  } finally {
    isDeleting.value = false;
    showDeleteDialog.value = false;
    projectToDelete.value = null;
    deleteTargetRemoteUrl.value = null;
  }
}
</script>

<template>
  <div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
    <div
      v-for="project in projects"
      :key="project.id"
      role="button"
      tabindex="0"
      class="group relative flex cursor-pointer flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :data-testid="`project-row-${project.id}`"
      @click="openProject(project)"
      @keydown.enter.prevent="openProject(project)"
      @keydown.space.prevent="openProject(project)"
    >
      <span
        class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {{ initials(project) }}
      </span>

      <span class="min-w-0 w-full">
        <span
          class="block truncate text-sm font-medium"
          :data-testid="`project-name-${project.id}`"
        >
          {{ project.title || project.id }}
        </span>
        <span v-if="project.error" class="mt-1 flex items-center gap-1 text-xs text-destructive">
          <AlertCircle class="h-3 w-3 shrink-0" />
          <span class="truncate">{{ project.error }}</span>
        </span>
      </span>

      <Button
        variant="ghost"
        size="icon"
        class="absolute right-2 top-2 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        :aria-label="`Delete ${project.title || project.id}`"
        :data-testid="`delete-project-${project.id}`"
        @click="onDeleteClick($event, project)"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>
  </div>

  <!-- Delete confirmation dialog -->
  <Dialog v-model:open="showDeleteDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete Review</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete "{{ projectToDelete?.title || projectToDelete?.id }}"? This action cannot be undone
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
