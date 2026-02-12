<script setup lang="ts">
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ScreenCriteriaChecklist from './ScreenCriteriaChecklist.vue';
import type { ScreenQueueRecord, ScreenCriterionDefinition } from '@/types/api';

defineProps<{
  record: ScreenQueueRecord;
  criteria: Record<string, ScreenCriterionDefinition>;
  criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'>;
  hasCriteria: boolean;
}>();

const emit = defineEmits<{
  toggleCriterion: [name: string, value: 'in' | 'out' | 'TODO'];
}>();
</script>

<template>
  <div class="h-full flex flex-col" data-testid="screen-record-panel">
    <!-- Compact header -->
    <div class="px-3 py-2 flex items-center gap-2 min-w-0">
      <Badge variant="outline" class="font-mono text-xs shrink-0" data-testid="screen-record-id">
        {{ record.id }}
      </Badge>
      <span class="text-sm font-medium truncate" data-testid="screen-record-title">
        {{ record.title }}
      </span>
    </div>

    <Separator />

    <!-- Tabs -->
    <Tabs
      :default-value="hasCriteria ? 'criteria' : 'details'"
      class="flex-1 flex flex-col min-h-0"
    >
      <TabsList class="mx-3 mt-2 shrink-0">
        <TabsTrigger v-if="hasCriteria" value="criteria" data-testid="screen-tab-criteria">
          Criteria
        </TabsTrigger>
        <TabsTrigger value="details" data-testid="screen-tab-details">
          Details
        </TabsTrigger>
      </TabsList>

      <!-- Criteria tab -->
      <TabsContent
        v-if="hasCriteria"
        value="criteria"
        class="flex-1 min-h-0 overflow-auto px-3 pb-3"
      >
        <ScreenCriteriaChecklist
          :criteria="criteria"
          :decisions="criteriaDecisions"
          @toggle="(name, value) => emit('toggleCriterion', name, value)"
        />
      </TabsContent>

      <!-- Details tab -->
      <TabsContent
        value="details"
        class="flex-1 min-h-0 overflow-auto px-3 pb-3"
      >
        <div class="space-y-3">
          <div>
            <h4 class="text-sm font-semibold leading-tight">{{ record.title }}</h4>
            <p class="text-sm text-muted-foreground mt-1">
              {{ record.author }} ({{ record.year }})
            </p>
            <p v-if="record.journal" class="text-sm text-muted-foreground">
              {{ record.journal }}
            </p>
            <p v-else-if="record.booktitle" class="text-sm text-muted-foreground">
              {{ record.booktitle }}
            </p>
          </div>

          <Separator />

          <div>
            <h4 class="text-sm font-medium mb-1">Abstract</h4>
            <p class="text-sm text-muted-foreground whitespace-pre-wrap">
              {{ record.abstract || 'No abstract available' }}
            </p>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
