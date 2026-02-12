<script setup lang="ts">
import { computed } from 'vue';
import { Database, Settings, ChevronRight } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { DataProgressBar } from '@/components/data';
import type { DataField, DataExtractionRecord } from '@/types/api';

const props = defineProps<{
  record: DataExtractionRecord;
  fields: DataField[];
  localValues: Record<string, string>;
  totalCount: number;
  completedCount: number;
  isSaving: boolean;
  canSave: boolean;
  incompleteFields: string[];
  queueRecords: Array<DataExtractionRecord & { _completed: boolean }>;
  currentIndex: number;
}>();

const emit = defineEmits<{
  'update-value': [fieldName: string, value: string];
  save: [];
  'skip-to-next': [];
  navigate: [index: number];
  'configure-fields': [];
}>();

const remainingCount = computed(() => props.totalCount - props.completedCount);

function isMultiSelected(fieldName: string, option: string): boolean {
  const val = props.localValues[fieldName] || '';
  return val.split(';').map((s) => s.trim()).filter(Boolean).includes(option);
}

function toggleMultiSelect(fieldName: string, option: string) {
  const val = props.localValues[fieldName] || '';
  const current = val === 'TODO' ? [] : val.split(';').map((s) => s.trim()).filter(Boolean);
  const idx = current.indexOf(option);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(option);
  }
  emit('update-value', fieldName, current.join(';'));
}

function typeLabel(dt: string): string {
  switch (dt) {
    case 'int': return 'integer';
    case 'double': return 'decimal';
    case 'select': return 'single choice';
    case 'multi_select': return 'multi select';
    default: return dt;
  }
}
</script>

<template>
  <div
    class="h-full flex flex-col bg-background"
    data-testid="data-extraction-panel"
  >
    <!-- Header -->
    <div class="shrink-0 px-4 py-3 border-b">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <Database class="h-4 w-4 text-muted-foreground" />
          <span class="text-sm font-medium">Data Extraction</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 text-sm">
            <span class="text-green-500 font-medium" data-testid="data-completed-count">
              {{ completedCount }}
            </span>
            <span class="text-muted-foreground">/</span>
            <span data-testid="data-remaining-count">{{ totalCount }}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7"
            data-testid="data-configure-fields-btn"
            @click="emit('configure-fields')"
          >
            <Settings class="h-4 w-4" />
          </Button>
        </div>
      </div>

      <!-- Progress bar -->
      <DataProgressBar
        :records="queueRecords"
        :current-index="currentIndex"
        @navigate="emit('navigate', $event)"
      />
    </div>

    <!-- Record info -->
    <div class="shrink-0 px-4 py-3 border-b">
      <div class="flex items-center gap-2 mb-1">
        <Badge variant="outline" class="font-mono text-xs" data-testid="data-record-id">
          {{ record.id }}
        </Badge>
      </div>
      <p
        class="text-sm font-medium line-clamp-2"
        data-testid="data-record-title"
      >
        {{ record.title || 'Untitled' }}
      </p>
      <p v-if="record.author" class="text-xs text-muted-foreground mt-0.5">
        {{ record.author }} ({{ record.year }})
      </p>
    </div>

    <!-- Extraction form -->
    <ScrollArea class="flex-1 min-h-0">
      <div class="p-4 space-y-4">
        <div
          v-for="field in fields"
          :key="field.name"
          class="space-y-1.5"
        >
          <label class="text-sm font-medium">
            {{ field.name }}
            <span
              v-if="field.data_type !== 'str'"
              class="text-xs text-muted-foreground ml-1"
            >
              ({{ typeLabel(field.data_type) }})
            </span>
            <span
              v-if="field.optional"
              class="text-xs text-muted-foreground ml-1"
            >
              — optional
            </span>
          </label>
          <p v-if="field.explanation" class="text-xs text-muted-foreground">
            {{ field.explanation }}
          </p>

          <!-- Text -->
          <Textarea
            v-if="field.data_type === 'str'"
            :model-value="localValues[field.name] === 'TODO' ? '' : localValues[field.name]"
            :placeholder="field.explanation || field.name"
            rows="3"
            :data-testid="`data-field-input-${field.name}`"
            @update:model-value="emit('update-value', field.name, String($event))"
          />

          <!-- Number (int / double) -->
          <Input
            v-else-if="field.data_type === 'int' || field.data_type === 'double'"
            type="number"
            :model-value="localValues[field.name] === 'TODO' ? '' : localValues[field.name]"
            :placeholder="field.explanation || field.name"
            :data-testid="`data-field-input-${field.name}`"
            @update:model-value="emit('update-value', field.name, String($event))"
          />

          <!-- Single choice (radio buttons) -->
          <div
            v-else-if="field.data_type === 'select'"
            class="space-y-1.5"
            :data-testid="`data-field-input-${field.name}`"
          >
            <label
              v-for="option in (field.options || [])"
              :key="option"
              class="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                :name="`field-radio-${field.name}`"
                :value="option"
                :checked="localValues[field.name] === option"
                class="h-4 w-4 border-input text-primary focus:ring-ring/50"
                @change="emit('update-value', field.name, option)"
              />
              <span class="text-sm">{{ option }}</span>
            </label>
          </div>

          <!-- Multi select (checkboxes) -->
          <div
            v-else-if="field.data_type === 'multi_select'"
            class="space-y-1.5"
            :data-testid="`data-field-input-${field.name}`"
          >
            <label
              v-for="option in (field.options || [])"
              :key="option"
              class="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                :checked="isMultiSelected(field.name, option)"
                class="h-4 w-4 rounded border-input text-primary focus:ring-ring/50"
                @change="toggleMultiSelect(field.name, option)"
              />
              <span class="text-sm">{{ option }}</span>
            </label>
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- Action buttons -->
    <div class="shrink-0 px-4 py-3 border-t space-y-1.5">
      <p
        v-if="incompleteFields.length > 0"
        class="text-xs text-muted-foreground"
      >
        Missing: {{ incompleteFields.join(', ') }}
      </p>
      <div class="flex items-center gap-2">
        <Button
          class="flex-1"
          :disabled="!canSave || isSaving"
          data-testid="data-save-next-btn"
          @click="emit('save')"
        >
          {{ isSaving ? 'Saving...' : 'Save & Next' }}
          <ChevronRight class="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  </div>
</template>
