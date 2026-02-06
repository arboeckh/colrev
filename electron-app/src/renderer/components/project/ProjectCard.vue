<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { FolderOpen, Loader2, AlertCircle } from 'lucide-vue-next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import GitSyncStatus from '@/components/common/GitSyncStatus.vue';
import type { ProjectListItem } from '@/stores/projects';

const props = defineProps<{
  project: ProjectListItem;
}>();

const router = useRouter();

const totalRecords = computed(() => {
  return props.project.status?.records?.total ?? 0;
});

const currentStep = computed(() => {
  return props.project.status?.overall?.currently ?? 'Unknown';
});

const projectTitle = computed(() => {
  // Try to get title from status, fall back to ID
  return props.project.id;
});

function openProject() {
  if (!props.project.loading) {
    router.push(`/project/${props.project.id}`);
  }
}
</script>

<template>
  <Card
    class="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
    :class="{ 'opacity-50': project.loading }"
    :data-testid="`project-card-${project.id}`"
    @click="openProject"
  >
    <CardHeader class="pb-2">
      <div class="flex items-start justify-between gap-2">
        <CardTitle class="text-base font-medium truncate flex items-center gap-2">
          <FolderOpen class="h-4 w-4 text-muted-foreground flex-shrink-0" />
          {{ projectTitle }}
        </CardTitle>
        <Loader2 v-if="project.loading" class="h-4 w-4 animate-spin text-muted-foreground" />
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
</template>
