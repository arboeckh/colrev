<script setup lang="ts">
import { ref, watch } from 'vue';
import { Plus, Trash2 } from 'lucide-vue-next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { DataField } from '@/types/api';

const props = defineProps<{
  open: boolean;
  existingFields: DataField[];
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  configured: [fields: DataField[]];
}>();

interface FieldRow {
  name: string;
  explanation: string;
  data_type: 'str' | 'int' | 'double';
}

const fields = ref<FieldRow[]>([]);

// Sync from props when dialog opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.existingFields.length > 0) {
        fields.value = props.existingFields.map((f) => ({
          name: f.name,
          explanation: f.explanation,
          data_type: f.data_type,
        }));
      } else {
        fields.value = [{ name: '', explanation: '', data_type: 'str' }];
      }
    }
  },
);

function addField() {
  fields.value.push({ name: '', explanation: '', data_type: 'str' });
}

function removeField(index: number) {
  fields.value.splice(index, 1);
}

function canSave() {
  return (
    fields.value.length > 0 &&
    fields.value.every((f) => f.name.trim() && f.explanation.trim())
  );
}

function save() {
  if (!canSave()) return;
  const result: DataField[] = fields.value.map((f) => ({
    name: f.name.trim(),
    explanation: f.explanation.trim(),
    data_type: f.data_type,
  }));
  emit('configured', result);
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[600px]" data-testid="data-fields-dialog">
      <DialogHeader>
        <DialogTitle>Configure Extraction Fields</DialogTitle>
      </DialogHeader>

      <div class="space-y-3 max-h-[400px] overflow-y-auto py-2">
        <div
          v-for="(field, index) in fields"
          :key="index"
          class="flex items-start gap-2"
        >
          <div class="flex-1 space-y-1">
            <Input
              v-model="field.name"
              placeholder="Field name"
              :data-testid="`data-field-name-${index}`"
            />
            <Input
              v-model="field.explanation"
              placeholder="Explanation"
              :data-testid="`data-field-explanation-${index}`"
            />
          </div>
          <NativeSelect
            v-model="field.data_type"
            class="w-24 mt-0.5"
            :data-testid="`data-field-type-${index}`"
          >
            <NativeSelectOption value="str">Text</NativeSelectOption>
            <NativeSelectOption value="int">Integer</NativeSelectOption>
            <NativeSelectOption value="double">Decimal</NativeSelectOption>
          </NativeSelect>
          <Button
            variant="ghost"
            size="icon"
            class="mt-0.5 shrink-0"
            :disabled="fields.length <= 1"
            :data-testid="`data-remove-field-${index}`"
            @click="removeField(index)"
          >
            <Trash2 class="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        class="w-fit"
        data-testid="data-add-field-btn"
        @click="addField"
      >
        <Plus class="h-4 w-4 mr-1" />
        Add Field
      </Button>

      <DialogFooter>
        <Button
          variant="outline"
          @click="emit('update:open', false)"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSave() || isSaving"
          data-testid="data-save-fields-btn"
          @click="save"
        >
          {{ isSaving ? 'Saving...' : 'Save Fields' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
