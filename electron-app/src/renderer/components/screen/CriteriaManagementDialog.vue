<script setup lang="ts">
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CriteriaList } from '@/components/review-definition';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useNotificationsStore } from '@/stores/notifications';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  criteriaChanged: [];
}>();

const store = useReviewDefinitionStore();
const notifications = useNotificationsStore();

async function handleAddCriterion(data: {
  name: string;
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.addCriterion(data);
  if (success) {
    notifications.success('Added', `Criterion "${data.name}" added`);
    emit('criteriaChanged');
  } else {
    notifications.error('Failed', 'Could not add criterion');
  }
}

async function handleUpdateCriterion(name: string, data: {
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.updateCriterion({
    criterion_name: name,
    ...data,
  });
  if (success) {
    notifications.success('Updated', `Criterion "${name}" updated`);
    emit('criteriaChanged');
  } else {
    notifications.error('Failed', 'Could not update criterion');
  }
}

async function handleDeleteCriterion(name: string) {
  const success = await store.removeCriterion(name);
  if (success) {
    notifications.success('Removed', `Criterion "${name}" removed`);
    emit('criteriaChanged');
  } else {
    notifications.error('Failed', 'Could not remove criterion');
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Manage Screening Criteria</DialogTitle>
      </DialogHeader>

      <div class="py-2">
        <CriteriaList
          :criteria="store.definition?.criteria || {}"
          :is-saving="store.isSaving"
          @add-criterion="handleAddCriterion"
          @update-criterion="handleUpdateCriterion"
          @delete-criterion="handleDeleteCriterion"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
