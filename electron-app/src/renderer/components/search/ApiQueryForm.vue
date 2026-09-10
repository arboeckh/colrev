<script setup lang="ts">
/**
 * The query form for an API source — every option the connector supports.
 *
 * Used both when adding a source and when editing one, so an existing source
 * can be re-tuned with the same controls it was created with.
 */
import { computed } from 'vue';
import { Input, NumericInput } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DbConnector } from './db-catalog';
import type { ApiQueryValue } from './api-query';

const props = defineProps<{
  modelValue: ApiQueryValue;
  connector: DbConnector;
  disabled?: boolean;
  showAdvanced?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: ApiQueryValue): void;
  (e: 'update:showAdvanced', value: boolean): void;
}>();

/** Only OpenAlex exposes structured filters today. */
const hasOptions = computed(() => props.connector.endpoint === 'colrev.open_alex');

/** A pasted URL is the entire query — the rest of the form no longer applies. */
const rawUrlWins = computed(() => !!props.modelValue.rawApiUrl.trim());

function set<K extends keyof ApiQueryValue>(key: K, value: ApiQueryValue[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

const advancedOpen = computed({
  get: () => !!props.showAdvanced,
  set: (value: boolean) => emit('update:showAdvanced', value),
});
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <label class="text-sm font-medium">
        Search query
        <span v-if="!rawUrlWins" class="text-destructive">*</span>
      </label>
      <Textarea
        :model-value="modelValue.searchQuery"
        :placeholder="connector.queryPlaceholder"
        :disabled="disabled || rawUrlWins"
        data-testid="search-query-input"
        class="min-h-24 resize-y font-mono text-sm"
        @update:model-value="set('searchQuery', String($event ?? ''))"
      />
      <p v-if="rawUrlWins" class="text-xs text-muted-foreground">
        Ignored while a full API URL is set below.
      </p>
      <p v-else-if="connector.queryHelp" class="text-xs text-muted-foreground">
        {{ connector.queryHelp }}
      </p>
    </div>

    <template v-if="hasOptions">
      <fieldset :disabled="rawUrlWins" class="space-y-4" :class="rawUrlWins && 'opacity-50'">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-xs font-medium">Year from</label>
            <NumericInput
              :model-value="modelValue.yearFrom"
              mode="integer"
              :allow-negative="false"
              placeholder="2020"
              :disabled="disabled"
              data-testid="query-year-from"
              @update:model-value="set('yearFrom', $event)"
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium">Year to</label>
            <NumericInput
              :model-value="modelValue.yearTo"
              mode="integer"
              :allow-negative="false"
              placeholder="2024"
              :disabled="disabled"
              data-testid="query-year-to"
              @update:model-value="set('yearTo', $event)"
            />
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input
            :checked="modelValue.openAccessOnly"
            type="checkbox"
            :disabled="disabled"
            data-testid="query-open-access"
            @change="set('openAccessOnly', ($event.target as HTMLInputElement).checked)"
          />
          Open access only
        </label>

        <div class="space-y-1">
          <label class="text-xs font-medium">Work types (comma-separated)</label>
          <Input
            :model-value="modelValue.workTypes"
            placeholder="article, preprint, book"
            :disabled="disabled"
            data-testid="query-work-types"
            @update:model-value="set('workTypes', String($event ?? ''))"
          />
        </div>

        <div class="space-y-1">
          <label class="text-xs font-medium">Sort order</label>
          <select
            :value="modelValue.sortOrder"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            :disabled="disabled"
            data-testid="query-sort-order"
            @change="set('sortOrder', ($event.target as HTMLSelectElement).value)"
          >
            <option value="relevance">Relevance</option>
            <option value="citations">Citations</option>
            <option value="date">Publication date</option>
          </select>
        </div>
      </fieldset>

      <button
        type="button"
        class="text-xs text-muted-foreground underline"
        data-testid="toggle-advanced-filters"
        @click="advancedOpen = !advancedOpen"
      >
        {{ advancedOpen ? 'Hide' : 'Show' }} advanced filters
      </button>

      <div v-if="advancedOpen" class="space-y-3 border-t border-border pt-3">
        <fieldset :disabled="rawUrlWins" class="space-y-3" :class="rawUrlWins && 'opacity-50'">
          <label class="flex items-center gap-2 text-sm">
            <input
              :checked="modelValue.searchExact"
              type="checkbox"
              :disabled="disabled"
              data-testid="query-search-exact"
              @change="set('searchExact', ($event.target as HTMLInputElement).checked)"
            />
            Exact match (unstemmed)
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              :checked="modelValue.hasAbstract"
              type="checkbox"
              :disabled="disabled"
              data-testid="query-has-abstract"
              @change="set('hasAbstract', ($event.target as HTMLInputElement).checked)"
            />
            Has abstract
          </label>
          <div class="space-y-1">
            <label class="text-xs font-medium">Minimum citations</label>
            <NumericInput
              :model-value="modelValue.minCitations"
              mode="integer"
              :allow-negative="false"
              placeholder="10"
              :disabled="disabled"
              data-testid="query-min-citations"
              @update:model-value="set('minCitations', $event)"
            />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium">Language (ISO code)</label>
            <Input
              :model-value="modelValue.languageFilter"
              placeholder="en"
              :disabled="disabled"
              data-testid="query-language"
              @update:model-value="set('languageFilter', String($event ?? ''))"
            />
          </div>
        </fieldset>

        <div class="space-y-1">
          <label class="text-xs font-medium">Paste full OpenAlex API URL</label>
          <Textarea
            :model-value="modelValue.rawApiUrl"
            placeholder="https://api.openalex.org/works?..."
            :disabled="disabled"
            data-testid="query-raw-url"
            class="min-h-16 font-mono text-xs"
            @update:model-value="set('rawApiUrl', String($event ?? ''))"
          />
          <p class="text-xs text-muted-foreground">
            Overrides every option above.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
