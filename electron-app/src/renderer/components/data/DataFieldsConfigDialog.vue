<script setup lang="ts">
import { ref, watch, type Component } from 'vue';
import { Plus, Trash2, X, ChevronDown, Type, Hash, Ruler, CircleDot, ListChecks } from 'lucide-vue-next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldDefinition } from '@/types/generated/rpc';

const props = defineProps<{
  open: boolean;
  existingFields: FieldDefinition[];
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  configured: [fields: FieldDefinition[]];
}>();

interface FieldRow {
  name: string;
  explanation: string;
  data_type: 'str' | 'int' | 'double' | 'select' | 'multi_select';
  options: string[];
  optional: boolean;
}

const typeConfig: Record<string, { icon: Component; label: string }> = {
  str:          { icon: Type,       label: 'Text' },
  int:          { icon: Hash,       label: 'Integer' },
  double:       { icon: Ruler,      label: 'Decimal' },
  select:       { icon: CircleDot,  label: 'Single Choice' },
  multi_select: { icon: ListChecks, label: 'Multi Select' },
};

const fields = ref<FieldRow[]>([]);
const expanded = ref<Set<number>>(new Set());

function fieldSummary(field: FieldRow): string {
  const name = field.name.trim() || 'Untitled field';
  const typeLabel = typeConfig[field.data_type]?.label ?? field.data_type;
  return `${name} · ${typeLabel}`;
}

function isExpanded(index: number): boolean {
  return expanded.value.has(index);
}

function toggleExpanded(index: number) {
  const next = new Set(expanded.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  expanded.value = next;
}

function setExpandedIndices(indices: number[]) {
  expanded.value = new Set(indices);
}

// Sync from props when dialog opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.existingFields.length > 0) {
        fields.value = props.existingFields.map((f) => ({
          name: f.name,
          explanation: f.explanation ?? '',
          data_type: (f.data_type ?? 'str') as FieldRow['data_type'],
          options: f.options ? [...f.options] : [],
          optional: f.optional ?? false,
        }));
        setExpandedIndices([fields.value.length - 1]);
      } else {
        fields.value = [{ name: '', explanation: '', data_type: 'str', options: [], optional: false }];
        setExpandedIndices([0]);
      }
    }
  },
);

function addField() {
  fields.value.push({ name: '', explanation: '', data_type: 'str', options: [], optional: false });
  setExpandedIndices([fields.value.length - 1]);
}

function removeField(index: number) {
  fields.value.splice(index, 1);
  const nextExpanded = new Set<number>();
  for (const i of expanded.value) {
    if (i < index) nextExpanded.add(i);
    else if (i > index) nextExpanded.add(i - 1);
  }
  if (nextExpanded.size === 0 && fields.value.length > 0) {
    nextExpanded.add(fields.value.length - 1);
  }
  expanded.value = nextExpanded;
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
      if (!f.name.trim()) return false;
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
  const result: FieldDefinition[] = fields.value.map((f) => {
    const field: FieldDefinition = {
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
    <DialogContent class="sm:max-w-[750px] max-h-[90vh] flex flex-col overflow-hidden" data-testid="data-fields-dialog">
      <DialogHeader class="shrink-0">
        <DialogTitle>Configure Extraction Fields</DialogTitle>
      </DialogHeader>

      <div class="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
        <div
          v-for="(field, index) in fields"
          :key="index"
          class="rounded-md border border-eucalyptus-300/40 border-l-[3px] border-l-eucalyptus-600 bg-eucalyptus-50/30"
        >
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-eucalyptus-50 transition-colors rounded-md"
            :data-testid="`data-field-toggle-${index}`"
            @click="toggleExpanded(index)"
          >
            <ChevronDown
              class="h-4 w-4 shrink-0 text-eucalyptus-700/70 transition-transform"
              :class="{ '-rotate-90': !isExpanded(index) }"
            />
            <component
              :is="typeConfig[field.data_type]?.icon"
              class="h-4 w-4 shrink-0 text-eucalyptus-700"
            />
            <span class="flex-1 min-w-0 text-sm font-medium truncate">
              {{ fieldSummary(field) }}
            </span>
            <span
              v-if="!field.optional"
              class="shrink-0 text-[10px] uppercase tracking-wide text-destructive font-medium"
            >
              Required
            </span>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 shrink-0"
              :disabled="fields.length <= 1"
              :data-testid="`data-remove-field-${index}`"
              @click.stop="removeField(index)"
            >
              <Trash2 class="h-3.5 w-3.5 text-destructive" />
            </Button>
          </button>

          <div v-show="isExpanded(index)" class="px-3 pb-3 space-y-2">
            <!-- Row 1: Name + Type + Required checkbox -->
            <div class="flex items-end gap-2">
              <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                <span class="text-xs text-muted-foreground leading-none">
                  Name <span class="text-destructive font-semibold">*</span>
                </span>
                <Input
                  v-model="field.name"
                  placeholder="e.g. sample_size"
                  class="h-8"
                  :class="{
                    'border-destructive': isDuplicateName(index),
                    'border-destructive/60 bg-destructive/5': !field.name.trim() && !isDuplicateName(index),
                  }"
                  :data-testid="`data-field-name-${index}`"
                />
              </div>
              <div class="shrink-0 flex flex-col gap-0.5">
                <span class="text-xs text-muted-foreground leading-none">Type</span>
                <Select
                  v-model="field.data_type"
                  @update:model-value="onTypeChange(field)"
                >
                  <SelectTrigger
                    size="sm"
                    class="w-[168px] bg-card hover:bg-cream-200"
                    :data-testid="`data-field-type-${index}`"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="(config, value) in typeConfig"
                      :key="value"
                      :value="value"
                      :data-testid="`data-field-type-option-${index}-${value}`"
                    >
                      {{ config.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label
                class="shrink-0 flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground h-8"
                :data-testid="`data-field-required-${index}`"
              >
                <input
                  type="checkbox"
                  :checked="!field.optional"
                  class="h-4 w-4 rounded border-input text-primary focus:ring-ring/50"
                  @change="(e) => (field.optional = !(e.target as HTMLInputElement).checked)"
                />
                Required
              </label>
            </div>
            <p v-if="isDuplicateName(index)" class="text-xs text-destructive">
              Duplicate field name
            </p>

            <!-- Row 2: Explanation (optional) -->
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-muted-foreground leading-none">Explanation</span>
              <Input
                v-model="field.explanation"
                placeholder="Describe what to extract for this field (optional)"
                class="h-8 text-sm"
                :data-testid="`data-field-explanation-${index}`"
              />
            </div>

            <!-- Row 3: Options editor for select / multi_select -->
            <div v-if="needsOptions(field)" class="pl-3 border-l-2 border-eucalyptus-300/50">
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
      </div>

      <!-- Add Field button -->
      <button
        class="shrink-0 w-full border border-dashed border-eucalyptus-300/50 rounded-md p-3 flex items-center justify-center gap-2 text-sm text-eucalyptus-700/80 hover:bg-eucalyptus-50 hover:text-eucalyptus-700 hover:border-eucalyptus-400/60 transition-colors cursor-pointer"
        data-testid="data-add-field-btn"
        @click="addField"
      >
        <Plus class="h-4 w-4" />
        Add Field
      </button>

      <DialogFooter class="shrink-0">
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
