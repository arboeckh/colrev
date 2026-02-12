<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DataField, DataExtractionRecord } from '@/types/api';

defineProps<{
  open: boolean;
  fields: DataField[];
  records: DataExtractionRecord[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

function displayValue(val: string | undefined, field: DataField): string {
  if (!val || val === 'TODO') return '';
  if (field.data_type === 'multi_select') {
    return val.split(';').map((s) => s.trim()).filter(Boolean).join(', ');
  }
  return val;
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent
      class="!w-[80vw] !h-[80vh] !max-w-none flex flex-col"
      data-testid="data-table-dialog"
    >
      <DialogHeader class="shrink-0">
        <DialogTitle>Extracted Data</DialogTitle>
      </DialogHeader>

      <ScrollArea class="flex-1 min-h-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="sticky left-0 bg-background z-10 min-w-[140px]">
                  Record ID
                </TableHead>
                <TableHead
                  v-for="field in fields"
                  :key="field.name"
                  class="min-w-[120px]"
                >
                  {{ field.name }}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="record in records"
                :key="record.id"
              >
                <TableCell class="sticky left-0 bg-background z-10 font-mono text-xs">
                  {{ record.id }}
                </TableCell>
                <TableCell
                  v-for="field in fields"
                  :key="field.name"
                  class="text-sm"
                >
                  {{ displayValue(record.extraction_values[field.name], field) }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
