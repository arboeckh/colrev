<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Loader2, AlertCircle, Trash2, Info } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
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
import { useGitStore } from '@/stores/git';

defineProps<{
  projects: ProjectListItem[];
}>();

const router = useRouter();
const projectsStore = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const git = useGitStore();

const showDeleteDialog = ref(false);
const projectToDelete = ref<ProjectListItem | null>(null);
const isDeleting = ref(false);
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
  deleteTargetRemoteUrl.value = git.snapshotFor(project.id)?.remoteUrl ?? null;
  showDeleteDialog.value = true;

  if (!deleteTargetRemoteUrl.value) {
    await git.refreshSnapshotFor(project.id, project.path);
    if (projectToDelete.value?.id === project.id) {
      deleteTargetRemoteUrl.value = git.snapshotFor(project.id)?.remoteUrl ?? null;
    }
  }
}

// The app only deletes the local copy: removing a GitHub repository needs
// admin rights we don't ask the user's token for. Point them at the repo's
// settings page instead, where GitHub's own delete lives.
function gitHubSettingsUrl(): string | null {
  const match = deleteTargetRemoteUrl.value?.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `https://github.com/${match[1]}/${match[2]}/settings` : null;
}

async function confirmDelete() {
  if (!projectToDelete.value) return;

  isDeleting.value = true;

  try {
    const response = await backend.call('delete_project', {
      project_id: projectToDelete.value.id,
    });

    if (response.success) {
      notifications.success('Review deleted', `Deleted ${projectToDelete.value.id}`);
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

      <!-- The GitHub repository is left untouched -->
      <div
        v-if="gitHubSettingsUrl()"
        class="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
        data-testid="delete-github-info"
      >
        <Info class="h-4 w-4 shrink-0" />
        <p>
          This only deletes the review on this computer. The GitHub repository stays, and collaborators keep
          access. To delete it as well, do so on GitHub under
          <a
            :href="gitHubSettingsUrl()!"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-foreground underline underline-offset-2"
          >Settings → Danger Zone</a>.
        </p>
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
          Delete Local
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
