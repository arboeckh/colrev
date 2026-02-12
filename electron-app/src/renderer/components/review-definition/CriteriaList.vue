<script setup lang="ts">
import { ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import InlineCriterionEditor from './InlineCriterionEditor.vue';
import type { ScreenCriterionDefinition } from '@/types/api';

defineProps<{
  criteria: Record<string, ScreenCriterionDefinition>;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  'add-criterion': [data: {
    name: string;
    explanation: string;
    comment?: string;
    criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
  }];
  'update-criterion': [name: string, data: {
    explanation: string;
    comment?: string;
    criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
  }];
  'delete-criterion': [name: string];
}>();

const showAddForm = ref(false);

function handleAddCriterion(data: any) {
  emit('add-criterion', data);
  showAddForm.value = false;
}
</script>

<template>
  <div class="space-y-3">
    <!-- Existing Criteria -->
    <InlineCriterionEditor
      v-for="(criterion, name) in criteria"
      :key="name"
      :criterion="{ name: name as string, ...criterion }"
      :is-saving="isSaving"
      mode="view"
      @save="(data) => emit('update-criterion', name as string, data)"
      @delete="emit('delete-criterion', name as string)"
    />

    <!-- Add New Criterion -->
    <InlineCriterionEditor
      v-if="showAddForm"
      :is-saving="isSaving"
      mode="add"
      @save="handleAddCriterion"
      @cancel="showAddForm = false"
    />

    <!-- Add Button (shown when not adding) -->
    <Button
      v-if="!showAddForm"
      variant="outline"
      class="w-full"
      data-testid="add-criterion-inline-btn"
      @click="showAddForm = true"
    >
      <Plus class="h-4 w-4 mr-2" />
      Add Screening Criterion
    </Button>

    <!-- Empty State -->
    <div
      v-if="Object.keys(criteria).length === 0 && !showAddForm"
      class="text-sm text-muted-foreground text-center py-8 border-2 border-dashed rounded-lg"
    >
      <p class="mb-2">No screening criteria defined yet.</p>
      <p class="text-xs">Add your first criterion to define inclusion/exclusion rules for screening.</p>
    </div>
  </div>
</template>
