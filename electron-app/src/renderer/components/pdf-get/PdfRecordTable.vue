<script setup lang="ts">
import { Upload, Ban, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/common';

export interface PdfRecord {
  ID: string;
  title: string;
  author: string;
  year: string;
  colrev_status: string;
  journal?: string;
  booktitle?: string;
  doi?: string;
}

defineProps<{
  records: PdfRecord[];
  showActions?: boolean;
  uploadingRecordId?: string | null;
  markingRecordId?: string | null;
}>();

defineEmits<{
  upload: [recordId: string];
  'mark-not-available': [recordId: string];
}>();
</script>

<template>
  <Table class="table-fixed w-full">
    <TableHeader>
      <TableRow>
        <TableHead class="w-[40%]">Title</TableHead>
        <TableHead class="w-[22%]">Authors</TableHead>
        <TableHead class="w-[50px]">Year</TableHead>
        <TableHead class="w-[120px]">Status</TableHead>
        <TableHead v-if="showActions" class="w-[160px] text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow
        v-for="record in records"
        :key="record.ID"
        :data-testid="'pdf-record-row-' + record.ID"
      >
        <TableCell class="overflow-hidden">
          <div class="font-medium text-sm leading-tight truncate">{{ record.title }}</div>
          <div class="text-xs text-muted-foreground font-mono mt-0.5 truncate">{{ record.ID }}</div>
        </TableCell>
        <TableCell class="text-sm overflow-hidden">
          <span class="block truncate">{{ record.author }}</span>
        </TableCell>
        <TableCell class="text-sm">{{ record.year }}</TableCell>
        <TableCell>
          <StatusBadge :status="record.colrev_status" size="sm" />
        </TableCell>
        <TableCell v-if="showActions" class="text-right">
          <div
            v-if="record.colrev_status === 'pdf_needs_manual_retrieval'"
            class="flex items-center justify-end gap-1"
          >
            <Button
              size="sm"
              variant="outline"
              :disabled="uploadingRecordId === record.ID"
              :data-testid="'pdf-upload-btn-' + record.ID"
              @click="$emit('upload', record.ID)"
            >
              <Loader2
                v-if="uploadingRecordId === record.ID"
                class="h-3.5 w-3.5 mr-1 animate-spin"
              />
              <Upload v-else class="h-3.5 w-3.5 mr-1" />
              Upload
            </Button>
            <Button
              size="sm"
              variant="ghost"
              :disabled="markingRecordId === record.ID"
              :data-testid="'pdf-not-available-btn-' + record.ID"
              @click="$emit('mark-not-available', record.ID)"
            >
              <Loader2
                v-if="markingRecordId === record.ID"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Ban v-else class="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      <TableRow v-if="records.length === 0">
        <TableCell
          :colspan="showActions ? 5 : 4"
          class="text-center text-muted-foreground py-8"
        >
          No records found
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
