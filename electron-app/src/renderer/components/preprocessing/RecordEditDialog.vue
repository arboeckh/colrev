<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Loader2, AlertTriangle, Check } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type { GetRecordResponse, PrepManUpdateRecordResponse, Record } from '@/types';

const props = defineProps<{
  open: boolean;
  projectId: string;
  recordId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'record-updated'): void;
}>();

const backend = useBackendStore();
const notifications = useNotificationsStore();

const record = ref<Record | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const saveError = ref<string | null>(null);

// Editable field values
const editFields = ref<globalThis.Record<string, string>>({});

// Defects parsed from provenance
const defects = ref<globalThis.Record<string, string[]>>({});

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

// Fields to show in the edit form
const EDITABLE_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'year', label: 'Year' },
  { key: 'ENTRYTYPE', label: 'Entry Type' },
  { key: 'journal', label: 'Journal' },
  { key: 'booktitle', label: 'Book Title' },
  { key: 'doi', label: 'DOI' },
  { key: 'volume', label: 'Volume' },
  { key: 'number', label: 'Number' },
  { key: 'pages', label: 'Pages' },
  { key: 'publisher', label: 'Publisher' },
];

const ENTRY_TYPES = [
  'article',
  'inproceedings',
  'inbook',
  'book',
  'phdthesis',
  'mastersthesis',
  'techreport',
  'misc',
  'online',
  'proceedings',
];

// Human-readable labels for defect codes
const DEFECT_LABELS: globalThis.Record<string, string> = {
  'missing': 'This field is required',
  'name-abbreviated': 'Author name appears abbreviated',
  'name-format-separators': 'Author name format issue',
  'name-format-titles': 'Contains honorifics/titles',
  'container-title-abbreviated': 'Container title is abbreviated',
  'identical-values-between-title-and-container': 'Title is identical to container title',
  'inconsistent-with-entrytype': 'Inconsistent with entry type',
  'mostly-all-caps': 'Contains excessive capitalization',
  'year-format': 'Year format issue',
  'incomplete-field': 'Field content appears incomplete',
  'html-tags': 'Contains HTML tags',
  'erroneous-symbol-in-field': 'Contains erroneous symbols',
  'erroneous-term-in-field': 'Contains erroneous terms',
  'erroneous-title-field': 'Title field appears erroneous',
  'doi-not-matching-pattern': 'DOI format invalid',
  'page-range': 'Page range format issue',
  'record-not-in-toc': 'Record not in table of contents',
  'language-unknown': 'Language could not be determined',
  'language-format-error': 'Language format error',
};

function getDefectLabel(code: string): string {
  return DEFECT_LABELS[code] || code;
}

// List of all defects as a flat array for the summary banner
const allDefectSummary = computed(() => {
  const items: Array<{ field: string; label: string }> = [];
  for (const [field, codes] of Object.entries(defects.value)) {
    for (const code of codes) {
      const fieldDef = EDITABLE_FIELDS.find((f) => f.key === field);
      items.push({
        field: fieldDef?.label || field,
        label: getDefectLabel(code),
      });
    }
  }
  return items;
});

function parseDefects(mdProv: globalThis.Record<string, { source: string; note: string }> | undefined) {
  const result: globalThis.Record<string, string[]> = {};
  if (!mdProv) return result;
  for (const [field, prov] of Object.entries(mdProv)) {
    if (typeof prov === 'object' && prov.note) {
      const codes = prov.note
        .split(',')
        .map((n: string) => n.trim())
        .filter((n: string) => n && !n.startsWith('IGNORE:'));
      if (codes.length > 0) result[field] = codes;
    }
  }
  return result;
}

async function loadRecord() {
  if (!props.projectId || !props.recordId) return;

  isLoading.value = true;
  saveError.value = null;

  try {
    const response = await backend.call<GetRecordResponse>('get_record', {
      project_id: props.projectId,
      record_id: props.recordId,
    });

    if (response.success && response.record) {
      record.value = response.record;

      // Populate edit fields from record
      const fields: globalThis.Record<string, string> = {};
      for (const fieldDef of EDITABLE_FIELDS) {
        const val = response.record[fieldDef.key];
        fields[fieldDef.key] = val != null ? String(val) : '';
      }
      editFields.value = fields;

      // Parse defects from provenance
      const mdProv = response.record.colrev_masterdata_provenance as
        | globalThis.Record<string, { source: string; note: string }>
        | undefined;
      defects.value = parseDefects(mdProv);
    }
  } catch (err) {
    console.error('Failed to load record:', err);
    saveError.value = 'Failed to load record';
  } finally {
    isLoading.value = false;
  }
}

// Compute changed fields
function getChangedFields(): globalThis.Record<string, string> {
  if (!record.value) return {};
  const changed: globalThis.Record<string, string> = {};
  for (const fieldDef of EDITABLE_FIELDS) {
    const original = record.value[fieldDef.key];
    const originalStr = original != null ? String(original) : '';
    const current = editFields.value[fieldDef.key] || '';
    if (current !== originalStr && current !== '') {
      changed[fieldDef.key] = current;
    }
  }
  return changed;
}

const hasChanges = computed(() => {
  return Object.keys(getChangedFields()).length > 0;
});

async function saveChanges() {
  if (!props.projectId || !props.recordId || !hasChanges.value) return;

  isSaving.value = true;
  saveError.value = null;

  try {
    const changedFields = getChangedFields();
    const response = await backend.call<PrepManUpdateRecordResponse>('prep_man_update_record', {
      project_id: props.projectId,
      record_id: props.recordId,
      fields: changedFields,
    });

    if (response.success) {
      const details = response.details;

      if (details.new_status === 'md_prepared') {
        notifications.success('Record fixed', 'Record transitioned to prepared status');
        emit('record-updated');
        isOpen.value = false;
      } else {
        // Still has defects — update the display
        if (details.remaining_defects) {
          defects.value = details.remaining_defects;
        }
        if (details.record) {
          record.value = details.record;
          // Update edit fields from the saved record
          for (const fieldDef of EDITABLE_FIELDS) {
            const val = details.record[fieldDef.key];
            if (val != null) {
              editFields.value[fieldDef.key] = String(val);
            }
          }
        }
        saveError.value = 'Record saved but still has quality defects. Please fix the remaining issues.';
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    saveError.value = `Failed to save: ${message}`;
  } finally {
    isSaving.value = false;
  }
}

// Load record when dialog opens
watch(
  () => props.open,
  (newValue) => {
    if (newValue && props.recordId) {
      loadRecord();
    } else {
      record.value = null;
      editFields.value = {};
      defects.value = {};
      saveError.value = null;
    }
  },
);
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent
      class="w-[600px] max-w-[90vw] max-h-[85vh] flex flex-col overflow-hidden"
      data-testid="record-edit-dialog"
    >
      <DialogHeader>
        <DialogTitle>Edit Record</DialogTitle>
        <DialogDescription>
          Fix quality issues to prepare this record for processing
        </DialogDescription>
      </DialogHeader>

      <!-- Loading -->
      <div v-if="isLoading" class="flex items-center justify-center py-12">
        <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
      </div>

      <!-- Content -->
      <div v-if="!isLoading && record" class="flex flex-col flex-1 min-h-0 gap-4">
        <!-- Record ID + status -->
        <div class="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
          <span class="font-mono">{{ record.ID }}</span>
          <Badge variant="outline" data-testid="record-edit-status-badge">
            {{ record.colrev_status }}
          </Badge>
        </div>

        <!-- Defect summary banner -->
        <div
          v-if="allDefectSummary.length > 0"
          class="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm shrink-0 max-h-[30vh] overflow-auto"
          data-testid="record-edit-defect-banner"
        >
          <AlertTriangle class="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p class="font-medium text-amber-600 dark:text-amber-400">
              {{ allDefectSummary.length }} issue{{ allDefectSummary.length !== 1 ? 's' : '' }} found
            </p>
            <ul class="mt-1 space-y-0.5 text-muted-foreground">
              <li v-for="(item, idx) in allDefectSummary" :key="idx">
                <span class="font-medium">{{ item.field }}:</span> {{ item.label }}
              </li>
            </ul>
          </div>
        </div>

        <!-- Edit form (scrollable) -->
        <div class="flex-1 min-h-0 overflow-y-auto -mx-6 px-6" data-testid="record-edit-form-scroll">
          <div class="space-y-4 py-2">
            <div v-for="fieldDef in EDITABLE_FIELDS" :key="fieldDef.key" class="space-y-1.5">
              <label
                :for="`field-${fieldDef.key}`"
                class="text-sm font-medium flex items-center gap-2"
              >
                {{ fieldDef.label }}
                <Badge
                  v-if="defects[fieldDef.key]"
                  variant="outline"
                  class="text-xs text-amber-600 dark:text-amber-400 border-amber-500/30"
                >
                  {{ defects[fieldDef.key].length }} issue{{ defects[fieldDef.key].length !== 1 ? 's' : '' }}
                </Badge>
              </label>

              <!-- Entry type uses a select -->
              <NativeSelect
                v-if="fieldDef.key === 'ENTRYTYPE'"
                :id="`field-${fieldDef.key}`"
                v-model="editFields[fieldDef.key]"
                :data-testid="`record-edit-field-${fieldDef.key}`"
                class="w-full"
              >
                <option v-for="et in ENTRY_TYPES" :key="et" :value="et">
                  {{ et }}
                </option>
              </NativeSelect>

              <!-- Regular text input -->
              <Input
                v-else
                :id="`field-${fieldDef.key}`"
                v-model="editFields[fieldDef.key]"
                :placeholder="`Enter ${fieldDef.label.toLowerCase()}`"
                :data-testid="`record-edit-field-${fieldDef.key}`"
                :class="{ 'border-amber-500/50': defects[fieldDef.key] }"
              />

              <!-- Per-field defect hints -->
              <div
                v-if="defects[fieldDef.key]"
                class="text-xs text-amber-600 dark:text-amber-400 space-y-0.5"
                :data-testid="`record-edit-defect-${fieldDef.key}`"
              >
                <p v-for="code in defects[fieldDef.key]" :key="code">
                  {{ getDefectLabel(code) }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Error message -->
        <div
          v-if="saveError"
          class="text-sm p-2 rounded bg-destructive/10 text-destructive border border-destructive/30 shrink-0"
        >
          {{ saveError }}
        </div>
      </div>

      <!-- Footer -->
      <DialogFooter v-if="record && !isLoading">
        <Button variant="outline" data-testid="record-edit-cancel-button" @click="isOpen = false">
          Cancel
        </Button>
        <Button
          :disabled="!hasChanges || isSaving"
          data-testid="record-edit-save-button"
          @click="saveChanges"
        >
          <Loader2 v-if="isSaving" class="h-4 w-4 mr-1 animate-spin" />
          <Check v-else class="h-4 w-4 mr-1" />
          Save Changes
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
