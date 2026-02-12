<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { FolderOpen, Loader2, AlertCircle, Trash2, GitBranch, ExternalLink } from 'lucide-vue-next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { useProjectsStore, type ProjectListItem } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type { DeleteProjectResponse } from '@/types/api';

defineProps<{
  projects: ProjectListItem[];
}>();

const router = useRouter();
const projectsStore = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();

const showDeleteDialog = ref(false);
const projectToDelete = ref<ProjectListItem | null>(null);
const isDeleting = ref(false);

function openProject(project: ProjectListItem) {
  if (!project.loading && !isDeleting.value) {
    router.push(`/project/${project.id}`);
  }
}

function onDeleteClick(event: Event, project: ProjectListItem) {
  event.stopPropagation();
  projectToDelete.value = project;
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  if (!projectToDelete.value) return;

  isDeleting.value = true;

  try {
    const response = await backend.call<DeleteProjectResponse>('delete_project', {
      project_id: projectToDelete.value.id,
    });

    if (response.success) {
      notifications.success('Project deleted', `Deleted ${projectToDelete.value.id}`);
      projectsStore.removeProject(projectToDelete.value.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notifications.error('Failed to delete project', message);
  } finally {
    isDeleting.value = false;
    showDeleteDialog.value = false;
    projectToDelete.value = null;
  }
}

function getRecordCount(project: ProjectListItem): number {
  return project.status?.currently?.total ?? project.status?.records?.total ?? 0;
}

function getNextOperation(project: ProjectListItem): string {
  return project.status?.next_operation ?? '-';
}

function formatNextOperation(op: string): string {
  if (op === '-' || !op) return '-';
  // Convert snake_case to Title Case
  return op
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getBranchName(project: ProjectListItem): string {
  return project.gitStatus?.branch ?? '-';
}

function isGitClean(project: ProjectListItem): boolean {
  return project.gitStatus?.is_clean ?? true;
}

function getUncommittedCount(project: ProjectListItem): number {
  return project.gitStatus?.uncommitted_changes ?? 0;
}
</script>

<template>
  <div class="rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[250px]">Project</TableHead>
          <TableHead class="text-right w-[100px]">Records</TableHead>
          <TableHead class="w-[150px]">Next Step</TableHead>
          <TableHead class="w-[180px]">Git Status</TableHead>
          <TableHead class="text-right w-[100px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="project in projects"
          :key="project.id"
          class="cursor-pointer hover:bg-muted/50"
          :class="{ 'opacity-50': project.loading }"
          :data-testid="`project-row-${project.id}`"
          @click="openProject(project)"
        >
          <!-- Project name -->
          <TableCell class="font-medium">
            <div class="flex items-center gap-2">
              <FolderOpen class="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span class="truncate" :data-testid="`project-name-${project.id}`">{{ project.title || project.id }}</span>
              <Loader2 v-if="project.loading" class="h-3 w-3 animate-spin text-muted-foreground" />
            </div>
            <div v-if="project.error" class="flex items-center gap-1 text-destructive text-xs mt-1">
              <AlertCircle class="h-3 w-3" />
              <span class="truncate">{{ project.error }}</span>
            </div>
          </TableCell>

          <!-- Records count -->
          <TableCell class="text-right tabular-nums">
            <span v-if="project.status">{{ getRecordCount(project) }}</span>
            <span v-else class="text-muted-foreground">-</span>
          </TableCell>

          <!-- Next step -->
          <TableCell>
            <Badge v-if="project.status" variant="secondary" class="font-normal">
              {{ formatNextOperation(getNextOperation(project)) }}
            </Badge>
            <span v-else class="text-muted-foreground">-</span>
          </TableCell>

          <!-- Git status -->
          <TableCell>
            <div v-if="project.gitStatus" class="flex items-center gap-2 text-sm">
              <GitBranch class="h-3 w-3 text-muted-foreground" />
              <span class="truncate max-w-[80px]">{{ getBranchName(project) }}</span>
              <Badge
                v-if="!isGitClean(project)"
                variant="outline"
                class="text-xs text-amber-600 border-amber-600/30"
              >
                {{ getUncommittedCount(project) }} changes
              </Badge>
              <Badge
                v-else
                variant="outline"
                class="text-xs text-green-600 border-green-600/30"
              >
                clean
              </Badge>
            </div>
            <span v-else class="text-muted-foreground">-</span>
          </TableCell>

          <!-- Actions -->
          <TableCell class="text-right">
            <div class="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                data-testid="open-project-button"
                @click.stop="openProject(project)"
              >
                <ExternalLink class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-destructive"
                :data-testid="`delete-project-${project.id}`"
                @click="onDeleteClick($event, project)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>

  <!-- Delete confirmation dialog -->
  <Dialog v-model:open="showDeleteDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete "{{ projectToDelete?.title || projectToDelete?.id }}"? This action cannot be undone
          and will permanently remove all project files.
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
          Delete Project
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
