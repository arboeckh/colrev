<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { FolderOpen, Loader2, AlertCircle, Trash2 } from 'lucide-vue-next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import GitSyncStatus from '@/components/common/GitSyncStatus.vue';
import { useProjectsStore, type ProjectListItem } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type { DeleteProjectResponse } from '@/types/api';

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

const showDeleteDialog = ref(false);
const isDeleting = ref(false);

const totalRecords = computed(() => {
  return props.project.status?.records?.total ?? 0;
});

const currentStep = computed(() => {
  return props.project.status?.overall?.currently ?? 'Unknown';
});

const projectTitle = computed(() => {
  return props.project.title || props.project.id;
});

function openProject() {
  if (!props.project.loading && !isDeleting.value) {
    router.push(`/project/${props.project.id}`);
  }
}

function onDeleteClick(event: Event) {
  event.stopPropagation();
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  isDeleting.value = true;

  try {
    const response = await backend.call<DeleteProjectResponse>('delete_project', {
      project_id: props.project.id,
    });

    if (response.success) {
      notifications.success('Review deleted', `Deleted ${props.project.id}`);
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

        <!-- Git status -->
        <div v-if="project.gitStatus" class="pt-2 border-t border-border">
          <GitSyncStatus :status="project.gitStatus" :show-branch="true" />
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
          and will permanently remove all review files.
        </DialogDescription>
      </DialogHeader>
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
          Delete Review
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
