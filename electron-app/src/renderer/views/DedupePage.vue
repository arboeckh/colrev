<script setup lang="ts">
import { Copy, AlertCircle } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { OperationButton } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';

const projects = useProjectsStore();

const operationInfo = projects.operationInfo.dedupe;

async function handleDedupeComplete() {
  await projects.refreshCurrentProject();
}
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <Copy class="h-6 w-6" />
          Dedupe
        </h2>
        <p class="text-muted-foreground">Identify and merge duplicate records</p>
      </div>

      <OperationButton
        v-if="projects.currentProjectId"
        operation="dedupe"
        :project-id="projects.currentProjectId"
        label="Run Dedupe"
        :disabled="!operationInfo?.can_run"
        @success="handleDedupeComplete"
      />
    </div>

    <Separator />

    <!-- Operation info -->
    <Card>
      <CardHeader>
        <CardTitle>Operation Status</CardTitle>
        <CardDescription>
          {{ operationInfo?.description || 'Find and merge duplicate records' }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Can run</span>
            <span :class="operationInfo?.can_run ? 'text-green-500' : 'text-muted-foreground'">
              {{ operationInfo?.can_run ? 'Yes' : 'No' }}
            </span>
          </div>

          <div v-if="operationInfo?.affected_records" class="flex items-center justify-between">
            <span class="text-muted-foreground">Records to process</span>
            <span class="font-medium tabular-nums">{{ operationInfo.affected_records }}</span>
          </div>

          <div v-if="operationInfo?.reason" class="flex items-start gap-2 p-3 bg-muted rounded-md">
            <AlertCircle class="h-4 w-4 text-yellow-500 mt-0.5" />
            <span class="text-sm">{{ operationInfo.reason }}</span>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Dedupe settings preview -->
    <Card v-if="projects.currentSettings?.dedupe">
      <CardHeader>
        <CardTitle>Deduplication Packages</CardTitle>
        <CardDescription>Configured deduplication strategies</CardDescription>
      </CardHeader>
      <CardContent>
        <ul class="space-y-2">
          <li
            v-for="pkg in projects.currentSettings.dedupe.dedupe_package_endpoints"
            :key="pkg.endpoint"
            class="p-2 bg-muted rounded-md font-mono text-sm"
          >
            {{ pkg.endpoint }}
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</template>
