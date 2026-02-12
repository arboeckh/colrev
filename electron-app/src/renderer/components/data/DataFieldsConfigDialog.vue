<script setup lang="ts">
import { ref, watch, type Component } from 'vue';
import { Plus, Trash2, X, Type, Hash, Ruler, CircleDot, ListChecks } from 'lucide-vue-next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  data_type: 'str' | 'int' | 'double' | 'select' | 'multi_select';
  options: string[];
  optional: boolean;
}

const typeConfig: Record<string, { icon: Component; label: string; border: string; badge: string }> = {
  str:          { icon: Type,       label: 'Text',          border: 'border-l-blue-500',   badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  int:          { icon: Hash,       label: 'Integer',       border: 'border-l-emerald-500', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  double:       { icon: Ruler,      label: 'Decimal',       border: 'border-l-amber-500',  badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  select:       { icon: CircleDot,  label: 'Single Choice', border: 'border-l-violet-500', badge: 'bg-violet-500/10 text-violet-400 border-violet-500/30' },
  multi_select: { icon: ListChecks, label: 'Multi Select',  border: 'border-l-pink-500',   badge: 'bg-pink-500/10 text-pink-400 border-pink-500/30' },
};

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
          options: f.options ? [...f.options] : [],
          optional: f.optional ?? false,
        }));
      } else {
        fields.value = [{ name: '', explanation: '', data_type: 'str', options: [], optional: false }];
      }
    }
  },
);

function addField() {
  fields.value.push({ name: '', explanation: '', data_type: 'str', options: [], optional: false });
}

function removeField(index: number) {
  fields.value.splice(index, 1);
}

function addOption(field: FieldRow) {
  field.options.push('');
}

function removeOption(field: FieldRow, optIndex: number) {
  field.options.splice(optIndex, 1);
}

function onTypeChange(field: FieldRow) {
  if (field.data_type === 'select' || field.data_type === 'multi_select') {
    if (field.options.length === 0) {
      field.options = ['', ''];
    }
  } else {
    field.options = [];
  }
}

function needsOptions(field: FieldRow) {
  return field.data_type === 'select' || field.data_type === 'multi_select';
}

function isDuplicateName(index: number) {
  const name = fields.value[index].name.trim().toLowerCase();
  if (!name) return false;
  return fields.value.some((f, i) => i !== index && f.name.trim().toLowerCase() === name);
}

function hasDuplicateNames() {
  const names = fields.value.map((f) => f.name.trim().toLowerCase()).filter(Boolean);
  return new Set(names).size !== names.length;
}

function canSave() {
  return (
    fields.value.length > 0 &&
    !hasDuplicateNames() &&
    fields.value.every((f) => {
      if (!f.name.trim() || !f.explanation.trim()) return false;
      if (needsOptions(f)) {
        const nonEmpty = f.options.filter((o) => o.trim());
        if (nonEmpty.length < 2) return false;
      }
      return true;
    })
  );
}

function save() {
  if (!canSave()) return;
  const result: DataField[] = fields.value.map((f) => {
    const field: DataField = {
      name: f.name.trim(),
      explanation: f.explanation.trim(),
      data_type: f.data_type,
    };
    if (needsOptions(f)) {
      field.options = f.options.filter((o) => o.trim()).map((o) => o.trim());
    }
    if (f.optional) {
      field.optional = true;
    }
    return field;
  });
  emit('configured', result);
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[750px]" data-testid="data-fields-dialog">
      <DialogHeader>
        <DialogTitle>Configure Extraction Fields</DialogTitle>
      </DialogHeader>

      <div class="space-y-3 max-h-[450px] overflow-y-auto pr-1">
        <div
          v-for="(field, index) in fields"
          :key="index"
          class="rounded-md border border-l-[3px] bg-card/50 p-3"
          :class="typeConfig[field.data_type]?.border"
        >
          <!-- Row 1: Icon + Name + Type badge + Optional badge + Delete -->
          <div class="flex items-center gap-2">
            <component
              :is="typeConfig[field.data_type]?.icon"
              class="h-4 w-4 shrink-0 text-muted-foreground"
            />
            <Input
              v-model="field.name"
              placeholder="Field name"
              class="h-8 flex-1"
              :class="{ 'border-destructive': isDuplicateName(index) }"
              :data-testid="`data-field-name-${index}`"
            />
            <NativeSelect
              v-model="field.data_type"
              class="w-[130px] shrink-0"
              :data-testid="`data-field-type-${index}`"
              @change="onTypeChange(field)"
            >
              <NativeSelectOption value="str">Text</NativeSelectOption>
              <NativeSelectOption value="int">Integer</NativeSelectOption>
              <NativeSelectOption value="double">Decimal</NativeSelectOption>
              <NativeSelectOption value="select">Single Choice</NativeSelectOption>
              <NativeSelectOption value="multi_select">Multi Select</NativeSelectOption>
            </NativeSelect>
            <Badge
              variant="outline"
              class="shrink-0 cursor-pointer select-none text-[11px] px-1.5 py-0"
              :class="field.optional
                ? 'bg-muted text-muted-foreground'
                : 'text-muted-foreground/50 opacity-60 hover:opacity-100'"
              :data-testid="`data-field-optional-${index}`"
              @click="field.optional = !field.optional"
            >
              {{ field.optional ? 'Optional' : 'Required' }}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 shrink-0"
              :disabled="fields.length <= 1"
              :data-testid="`data-remove-field-${index}`"
              @click="removeField(index)"
            >
              <Trash2 class="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
          <p v-if="isDuplicateName(index)" class="text-xs text-destructive mt-1 ml-6">
            Duplicate field name
          </p>

          <!-- Row 2: Explanation -->
          <div class="mt-2 ml-6">
            <Input
              v-model="field.explanation"
              placeholder="Explanation (describe what to extract)"
              class="h-8 text-sm"
              :data-testid="`data-field-explanation-${index}`"
            />
          </div>

          <!-- Row 3: Options editor for select / multi_select -->
          <div v-if="needsOptions(field)" class="mt-2.5 ml-6 pl-3 border-l-2 border-muted">
            <span class="text-xs text-muted-foreground font-medium">Options (min 2)</span>
            <div class="mt-1.5 space-y-1.5">
              <div
                v-for="(_, optIdx) in field.options"
                :key="optIdx"
                class="flex items-center gap-1.5"
              >
                <span class="text-xs text-muted-foreground/50 w-4 text-right shrink-0">{{ optIdx + 1 }}</span>
                <Input
                  v-model="field.options[optIdx]"
                  placeholder="Option label"
                  class="h-7 text-xs flex-1"
                  :data-testid="`data-field-option-${index}-${optIdx}`"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0"
                  :disabled="field.options.length <= 2"
                  @click="removeOption(field, optIdx)"
                >
                  <X class="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-6 text-xs mt-1.5"
              :data-testid="`data-field-add-option-${index}`"
              @click="addOption(field)"
            >
              <Plus class="h-3 w-3 mr-0.5" />
              Add Option
            </Button>
          </div>
        </div>
      </div>

      <!-- Add Field button -->
      <button
        class="w-full border border-dashed rounded-md p-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer"
        data-testid="data-add-field-btn"
        @click="addField"
      >
        <Plus class="h-4 w-4" />
        Add Field
      </button>

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
