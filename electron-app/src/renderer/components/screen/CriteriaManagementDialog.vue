<script setup lang="ts">
import { ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CriteriaList, AddCriterionDialog, EditCriterionDialog } from '@/components/review-definition';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useNotificationsStore } from '@/stores/notifications';
import type { ScreenCriterionDefinition } from '@/types/api';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  criteriaChanged: [];
}>();

const store = useReviewDefinitionStore();
const notifications = useNotificationsStore();

const showAddDialog = ref(false);
const showEditDialog = ref(false);
const editName = ref('');
const editData = ref<ScreenCriterionDefinition | null>(null);

function openEdit(name: string, criterion: ScreenCriterionDefinition) {
  editName.value = name;
  editData.value = criterion;
  showEditDialog.value = true;
}

async function handleAdd(data: {
  name: string;
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.addCriterion(data);
  if (success) {
    showAddDialog.value = false;
    notifications.success('Added', `Criterion "${data.name}" added`);
    emit('criteriaChanged');
  } else {
    notifications.error('Failed', 'Could not add criterion');
  }
}

async function handleEdit(data: {
  criterion_name: string;
  explanation?: string;
  comment?: string;
  criterion_type?: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.updateCriterion(data);
  if (success) {
    showEditDialog.value = false;
    notifications.success('Updated', `Criterion "${data.criterion_name}" updated`);
    emit('criteriaChanged');
  } else {
    notifications.error('Failed', 'Could not update criterion');
  }
}

async function handleRemove(name: string) {
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
    <DialogContent class="sm:max-w-[550px]">
      <DialogHeader>
        <div class="flex items-center justify-between">
          <DialogTitle>Manage Screening Criteria</DialogTitle>
          <Button
            variant="outline"
            size="sm"
            data-testid="manage-criteria-add-btn"
            @click="showAddDialog = true"
          >
            <Plus class="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </DialogHeader>

      <div class="py-2">
        <CriteriaList
          :criteria="store.definition?.criteria || {}"
          @edit="openEdit"
          @remove="handleRemove"
        />
      </div>
    </DialogContent>
  </Dialog>

  <AddCriterionDialog
    v-model:open="showAddDialog"
    :is-saving="store.isSaving"
    @submit="handleAdd"
  />

  <EditCriterionDialog
    v-model:open="showEditDialog"
    :criterion-name="editName"
    :criterion="editData"
    :is-saving="store.isSaving"
    @submit="handleEdit"
  />
</template>
