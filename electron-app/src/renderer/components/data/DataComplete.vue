<script setup lang="ts">
import { CircleCheck, Download, Pencil, Table2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

defineProps<{
  completedCount: number;
  totalCount: number;
  isExporting?: boolean;
}>();

const emit = defineEmits<{
  viewData: [];
  exportCsv: [];
  editExtractions: [];
}>();
</script>

<template>
  <div
    class="flex-1 flex flex-col items-center justify-center text-center"
    data-testid="data-complete"
  >
    <div class="rounded-full bg-green-600/15 p-4 mb-4">
      <CircleCheck class="h-8 w-8 text-green-500" />
    </div>
    <h3 class="text-lg font-medium mb-1">Data extraction complete</h3>
    <p class="text-sm text-muted-foreground mb-6">
      All records have been extracted.
    </p>

    <div class="flex items-center gap-6">
      <div class="flex flex-col items-center gap-1">
        <span
          class="text-2xl font-semibold text-green-500"
          data-testid="data-complete-count"
        >
          {{ completedCount }}
        </span>
        <span class="text-xs text-muted-foreground">Completed</span>
      </div>
      <Separator orientation="vertical" class="h-10" />
      <div class="flex flex-col items-center gap-1">
        <span class="text-2xl font-semibold">
          {{ totalCount }}
        </span>
        <span class="text-xs text-muted-foreground">Total records</span>
      </div>
    </div>

    <Button
      class="mt-6"
      data-testid="data-export-csv-btn"
      :disabled="isExporting"
      @click="emit('exportCsv')"
    >
      <Download class="h-4 w-4 mr-1.5" />
      {{ isExporting ? 'Exporting...' : 'Export CSV' }}
    </Button>

    <div class="flex items-center gap-2 mt-3">
      <Button
        variant="ghost"
        size="sm"
        data-testid="data-complete-view-btn"
        @click="emit('viewData')"
      >
        <Table2 class="h-4 w-4 mr-1.5" />
        View Data
      </Button>
      <Separator orientation="vertical" class="h-4" />
      <Button
        variant="ghost"
        size="sm"
        data-testid="data-complete-edit-btn"
        @click="emit('editExtractions')"
      >
        <Pencil class="h-4 w-4 mr-1.5" />
        Edit Extractions
      </Button>
    </div>
  </div>
</template>
