<script setup lang="ts">
import { Upload, Ban, Loader2, CheckCircle2, AlertTriangle } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  colrev_data_provenance?: globalThis.Record<string, { source: string; note: string }>;
}

const PDF_DEFECT_LABELS: globalThis.Record<string, string> = {
  'no-text-in-pdf': 'No extractable text in PDF',
  'pdf-incomplete': 'PDF is incomplete',
  'author-not-in-pdf': 'Author not found in PDF',
  'title-not-in-pdf': 'Title not found in PDF',
  'coverpage-included': 'Cover page included',
  'last-page-appended': 'Extra last page appended',
};

function getDefects(record: PdfRecord): string[] {
  const note = record.colrev_data_provenance?.file?.note || '';
  return note
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith('IGNORE:'));
}

function getDefectLabel(code: string): string {
  return PDF_DEFECT_LABELS[code] || code;
}

export interface UploadResult {
  status: 'success' | 'prep-failed' | 'error';
  message?: string;
}

defineProps<{
  records: PdfRecord[];
  showActions?: boolean;
  uploadingRecordId?: string | null;
  markingRecordId?: string | null;
  uploadResults?: globalThis.Record<string, UploadResult>;
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
          <div
            v-if="record.colrev_status === 'pdf_needs_manual_preparation' && getDefects(record).length > 0"
            class="flex flex-wrap gap-1 mt-1"
            :data-testid="'pdf-defects-' + record.ID"
          >
            <Badge
              v-for="defect in getDefects(record)"
              :key="defect"
              variant="outline"
              class="text-xs border-amber-500 text-amber-600"
              :data-testid="'pdf-defect-badge-' + defect"
            >
              {{ getDefectLabel(defect) }}
            </Badge>
          </div>
        </TableCell>
        <TableCell class="text-sm overflow-hidden">
          <span class="block truncate">{{ record.author }}</span>
        </TableCell>
        <TableCell class="text-sm">{{ record.year }}</TableCell>
        <TableCell>
          <StatusBadge :status="record.colrev_status" size="sm" />
        </TableCell>
        <TableCell v-if="showActions" class="text-right">
          <!-- Actions for pdf_needs_manual_retrieval -->
          <div
            v-if="record.colrev_status === 'pdf_needs_manual_retrieval'"
            class="flex items-center justify-end gap-1"
          >
            <!-- Loading state -->
            <Button
              v-if="uploadingRecordId === record.ID"
              size="sm"
              variant="outline"
              disabled
              :data-testid="'pdf-upload-btn-' + record.ID"
            >
              <Loader2 class="h-3.5 w-3.5 mr-1 animate-spin" />
              Uploading...
            </Button>

            <!-- Success state -->
            <Button
              v-else-if="uploadResults?.[record.ID]?.status === 'success'"
              size="sm"
              variant="outline"
              disabled
              class="text-green-600 border-green-600"
              :data-testid="'pdf-upload-btn-' + record.ID"
            >
              <CheckCircle2 class="h-3.5 w-3.5 mr-1" />
              Prepared
            </Button>

            <!-- Prep failed state -->
            <TooltipProvider v-else-if="uploadResults?.[record.ID]?.status === 'prep-failed'">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    class="text-amber-600 border-amber-600"
                    :data-testid="'pdf-upload-btn-' + record.ID"
                  >
                    <AlertTriangle class="h-3.5 w-3.5 mr-1" />
                    Needs prep
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ uploadResults?.[record.ID]?.message || 'PDF needs manual preparation' }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <!-- Error state -->
            <TooltipProvider v-else-if="uploadResults?.[record.ID]?.status === 'error'">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    class="text-red-600 border-red-600"
                    :data-testid="'pdf-upload-btn-' + record.ID"
                  >
                    <AlertTriangle class="h-3.5 w-3.5 mr-1" />
                    Error
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ uploadResults?.[record.ID]?.message || 'Upload failed' }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <!-- Default state -->
            <Button
              v-else
              size="sm"
              variant="outline"
              :data-testid="'pdf-upload-btn-' + record.ID"
              @click="$emit('upload', record.ID)"
            >
              <Upload class="h-3.5 w-3.5 mr-1" />
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

          <!-- Actions for pdf_needs_manual_preparation (re-upload) -->
          <div
            v-else-if="record.colrev_status === 'pdf_needs_manual_preparation'"
            class="flex items-center justify-end gap-1"
          >
            <Button
              v-if="uploadingRecordId === record.ID"
              size="sm"
              variant="outline"
              disabled
              :data-testid="'pdf-reupload-btn-' + record.ID"
            >
              <Loader2 class="h-3.5 w-3.5 mr-1 animate-spin" />
              Uploading...
            </Button>

            <Button
              v-else-if="uploadResults?.[record.ID]?.status === 'success'"
              size="sm"
              variant="outline"
              disabled
              class="text-green-600 border-green-600"
              :data-testid="'pdf-reupload-btn-' + record.ID"
            >
              <CheckCircle2 class="h-3.5 w-3.5 mr-1" />
              Prepared
            </Button>

            <TooltipProvider v-else-if="uploadResults?.[record.ID]?.status === 'error'">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    class="text-red-600 border-red-600"
                    :data-testid="'pdf-reupload-btn-' + record.ID"
                  >
                    <AlertTriangle class="h-3.5 w-3.5 mr-1" />
                    Error
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ uploadResults?.[record.ID]?.message || 'Re-upload failed' }}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              v-else
              size="sm"
              variant="outline"
              :data-testid="'pdf-reupload-btn-' + record.ID"
              @click="$emit('upload', record.ID)"
            >
              <Upload class="h-3.5 w-3.5 mr-1" />
              Re-upload
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
