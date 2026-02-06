<script setup lang="ts">
import { Database, AlertCircle } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { OperationButton } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';

const projects = useProjectsStore();

const operationInfo = projects.operationInfo.data;

async function handleDataComplete() {
  await projects.refreshCurrentProject();
}
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <Database class="h-6 w-6" />
          Data
        </h2>
        <p class="text-muted-foreground">Data extraction and synthesis</p>
      </div>

      <OperationButton
        v-if="projects.currentProjectId"
        operation="data"
        :project-id="projects.currentProjectId"
        label="Run Data"
        :disabled="!operationInfo?.can_run"
        @success="handleDataComplete"
      />
    </div>

    <Separator />

    <!-- Operation info -->
    <Card>
      <CardHeader>
        <CardTitle>Operation Status</CardTitle>
        <CardDescription>
          {{ operationInfo?.description || 'Extract data and synthesize findings' }}
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

    <!-- Data packages -->
    <Card v-if="projects.currentSettings?.data">
      <CardHeader>
        <CardTitle>Data Extraction Packages</CardTitle>
        <CardDescription>Configured data extraction and synthesis plugins</CardDescription>
      </CardHeader>
      <CardContent>
        <ul class="space-y-2">
          <li
            v-for="pkg in projects.currentSettings.data.data_package_endpoints"
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
