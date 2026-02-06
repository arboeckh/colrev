<script setup lang="ts">
import { FileEdit, AlertCircle } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { OperationButton } from '@/components/common';
import { useProjectsStore } from '@/stores/projects';

const projects = useProjectsStore();

const operationInfo = projects.operationInfo.prep;

async function handlePrepComplete() {
  await projects.refreshCurrentProject();
}
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <FileEdit class="h-6 w-6" />
          Prep
        </h2>
        <p class="text-muted-foreground">Prepare and clean metadata for imported records</p>
      </div>

      <OperationButton
        v-if="projects.currentProjectId"
        operation="prep"
        :project-id="projects.currentProjectId"
        label="Run Prep"
        :disabled="!operationInfo?.can_run"
        @success="handlePrepComplete"
      />
    </div>

    <Separator />

    <!-- Operation info -->
    <Card>
      <CardHeader>
        <CardTitle>Operation Status</CardTitle>
        <CardDescription>
          {{ operationInfo?.description || 'Clean and standardize record metadata' }}
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

    <!-- Prep settings preview -->
    <Card v-if="projects.currentSettings?.prep">
      <CardHeader>
        <CardTitle>Prep Rounds</CardTitle>
        <CardDescription>Configured preparation packages</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="(round, index) in projects.currentSettings.prep.prep_rounds"
            :key="index"
            class="p-3 bg-muted rounded-md"
          >
            <h4 class="font-medium mb-2">{{ round.name }}</h4>
            <ul class="text-sm text-muted-foreground space-y-1">
              <li v-for="pkg in round.prep_package_endpoints" :key="pkg.endpoint" class="font-mono text-xs">
                {{ pkg.endpoint }}
              </li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
