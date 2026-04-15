<script setup lang="ts">
import { Upload, Ban, Loader2, CheckCircle2, AlertTriangle, Undo2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
  'no-text-in-pdf': 'no extractable text',
  'pdf-incomplete': 'incomplete',
  'author-not-in-pdf': 'author missing',
  'title-not-in-pdf': 'title missing',
  'coverpage-included': 'cover page included',
  'last-page-appended': 'extra last page',
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

function getVenue(record: PdfRecord): string {
  return record.journal || record.booktitle || '';
}

function getMetaLine(record: PdfRecord): string {
  const parts: string[] = [];
  if (record.author) parts.push(record.author);
  if (record.year) parts.push(record.year);
  const venue = getVenue(record);
  if (venue) parts.push(venue);
  return parts.join(' · ');
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pdf_prepared':
      return 'Prepared';
    case 'pdf_imported':
      return 'Retrieved';
    case 'pdf_not_available':
      return 'Unavailable';
    case 'pdf_needs_manual_retrieval':
      return 'Needs upload';
    case 'pdf_needs_manual_preparation':
      return 'Needs fixing';
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'pdf_prepared':
      return 'text-green-600 dark:text-green-400';
    case 'pdf_imported':
      return 'text-muted-foreground';
    case 'pdf_not_available':
      return 'text-muted-foreground/70';
    case 'pdf_needs_manual_retrieval':
      return 'text-amber-600 dark:text-amber-400';
    case 'pdf_needs_manual_preparation':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-muted-foreground';
  }
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
  undoingRecordId?: string | null;
  uploadResults?: globalThis.Record<string, UploadResult>;
}>();

defineEmits<{
  upload: [recordId: string];
  'mark-not-available': [recordId: string];
  'undo-not-available': [recordId: string];
}>();
</script>

<template>
  <div class="divide-y divide-border/60">
    <div
      v-for="record in records"
      :key="record.ID"
      class="flex items-start gap-4 py-3"
      :data-testid="'pdf-record-row-' + record.ID"
    >
      <!-- Record metadata -->
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-3">
          <p class="text-sm font-medium leading-snug truncate">{{ record.title }}</p>
          <span class="text-[11px] font-mono text-muted-foreground/70 shrink-0">
            {{ record.ID }}
          </span>
        </div>
        <p class="text-xs text-muted-foreground mt-0.5 truncate">
          {{ getMetaLine(record) }}
        </p>
        <div
          v-if="record.colrev_status === 'pdf_needs_manual_preparation' && getDefects(record).length > 0"
          class="text-xs text-amber-600 dark:text-amber-400 mt-1 truncate"
          :data-testid="'pdf-defects-' + record.ID"
        >
          Defect:
          <span
            v-for="(defect, idx) in getDefects(record)"
            :key="defect"
            :data-testid="'pdf-defect-badge-' + defect"
          >
            {{ getDefectLabel(defect) }}<span v-if="idx < getDefects(record).length - 1"> · </span>
          </span>
        </div>
      </div>

      <!-- Status -->
      <div
        class="text-xs w-24 text-right shrink-0 pt-0.5"
        :class="statusClass(record.colrev_status)"
      >
        {{ statusLabel(record.colrev_status) }}
      </div>

      <!-- Actions -->
      <div v-if="showActions" class="flex items-center justify-end gap-1 shrink-0 min-w-[14rem]">
        <!-- Actions for pdf_needs_manual_retrieval -->
        <template v-if="record.colrev_status === 'pdf_needs_manual_retrieval'">
          <Button
            v-if="uploadingRecordId === record.ID"
            size="sm"
            variant="ghost"
            disabled
            :data-testid="'pdf-upload-btn-' + record.ID"
          >
            <Loader2 class="h-3.5 w-3.5 mr-1 animate-spin" />
            Uploading
          </Button>

          <Button
            v-else-if="uploadResults?.[record.ID]?.status === 'success'"
            size="sm"
            variant="ghost"
            disabled
            class="text-green-600"
            :data-testid="'pdf-upload-btn-' + record.ID"
          >
            <CheckCircle2 class="h-3.5 w-3.5 mr-1" />
            Prepared
          </Button>

          <TooltipProvider v-else-if="uploadResults?.[record.ID]?.status === 'prep-failed'">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled
                  class="text-amber-600"
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

          <TooltipProvider v-else-if="uploadResults?.[record.ID]?.status === 'error'">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled
                  class="text-red-600"
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

          <Button
            v-else
            size="sm"
            variant="ghost"
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
            class="text-muted-foreground hover:text-foreground"
            :data-testid="'pdf-not-available-btn-' + record.ID"
            @click="$emit('mark-not-available', record.ID)"
          >
            <Loader2
              v-if="markingRecordId === record.ID"
              class="h-3.5 w-3.5 mr-1 animate-spin"
            />
            <Ban v-else class="h-3.5 w-3.5 mr-1" />
            Unavailable
          </Button>
        </template>

        <!-- Actions for pdf_not_available -->
        <template v-else-if="record.colrev_status === 'pdf_not_available'">
          <Button
            size="sm"
            variant="ghost"
            :disabled="undoingRecordId === record.ID"
            class="text-muted-foreground hover:text-foreground"
            :data-testid="'pdf-undo-btn-' + record.ID"
            @click="$emit('undo-not-available', record.ID)"
          >
            <Loader2
              v-if="undoingRecordId === record.ID"
              class="h-3.5 w-3.5 mr-1 animate-spin"
            />
            <Undo2 v-else class="h-3.5 w-3.5 mr-1" />
            Undo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :disabled="uploadingRecordId === record.ID || undoingRecordId === record.ID"
            :data-testid="'pdf-upload-from-na-btn-' + record.ID"
            @click="$emit('upload', record.ID)"
          >
            <Loader2
              v-if="uploadingRecordId === record.ID"
              class="h-3.5 w-3.5 mr-1 animate-spin"
            />
            <Upload v-else class="h-3.5 w-3.5 mr-1" />
            Upload
          </Button>
        </template>

        <!-- Actions for pdf_needs_manual_preparation -->
        <template v-else-if="record.colrev_status === 'pdf_needs_manual_preparation'">
          <Button
            v-if="uploadingRecordId === record.ID"
            size="sm"
            variant="ghost"
            disabled
            :data-testid="'pdf-reupload-btn-' + record.ID"
          >
            <Loader2 class="h-3.5 w-3.5 mr-1 animate-spin" />
            Uploading
          </Button>

          <Button
            v-else-if="uploadResults?.[record.ID]?.status === 'success'"
            size="sm"
            variant="ghost"
            disabled
            class="text-green-600"
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
                  variant="ghost"
                  disabled
                  class="text-red-600"
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
            variant="ghost"
            :data-testid="'pdf-reupload-btn-' + record.ID"
            @click="$emit('upload', record.ID)"
          >
            <Upload class="h-3.5 w-3.5 mr-1" />
            Re-upload
          </Button>
        </template>
      </div>
    </div>

    <div
      v-if="records.length === 0"
      class="py-8 text-center text-sm text-muted-foreground"
    >
      No records
    </div>
  </div>
</template>
