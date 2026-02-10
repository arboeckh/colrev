<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  FileUp,
  Loader2,
  Check,
  AlertTriangle,
  X,
  File,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';
import type { UploadPdfResponse } from '@/types/api';
import type { PdfRecord } from '@/components/pdf-get/PdfRecordTable.vue';

const props = defineProps<{
  open: boolean;
  records: PdfRecord[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  complete: [];
}>();

const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();

interface FileAssignment {
  file: File;
  recordId: string | null;
  matchType: 'exact' | 'fuzzy' | 'manual' | 'none';
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

const assignments = ref<FileAssignment[]>([]);
const isUploading = ref(false);

const matchedCount = computed(() => assignments.value.filter((a) => a.recordId !== null).length);
const unmatchedCount = computed(() => assignments.value.filter((a) => a.recordId === null).length);
const canUpload = computed(() => matchedCount.value > 0 && !isUploading.value);

// Available records for assignment (not already assigned to another file)
function availableRecordsFor(currentIndex: number): PdfRecord[] {
  const assignedIds = new Set(
    assignments.value
      .filter((a, i) => i !== currentIndex && a.recordId !== null)
      .map((a) => a.recordId),
  );
  return props.records.filter((r) => !assignedIds.has(r.ID));
}

// Reset when dialog opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      assignments.value = [];
    }
  },
);

function selectFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf';
  input.multiple = true;

  input.onchange = () => {
    const files = input.files;
    if (!files) return;

    const newAssignments: FileAssignment[] = [];
    for (const file of Array.from(files)) {
      const match = autoMatch(file);
      newAssignments.push({
        file,
        recordId: match.recordId,
        matchType: match.type,
        status: 'pending',
      });
    }
    assignments.value = newAssignments;
  };

  input.click();
}

function autoMatch(file: File): { recordId: string | null; type: FileAssignment['matchType'] } {
  const stem = file.name.replace(/\.pdf$/i, '').toLowerCase();

  // Try exact match: filename stem === record ID
  const exactMatch = props.records.find((r) => r.ID.toLowerCase() === stem);
  if (exactMatch) return { recordId: exactMatch.ID, type: 'exact' };

  // Try fuzzy match: filename contains author last name + year
  for (const record of props.records) {
    const authorLastName = record.author?.split(',')[0]?.trim().toLowerCase();
    const year = record.year;
    if (authorLastName && year && stem.includes(authorLastName) && stem.includes(year)) {
      return { recordId: record.ID, type: 'fuzzy' };
    }
  }

  return { recordId: null, type: 'none' };
}

function assignRecord(index: number, recordId: string | null) {
  if (index >= 0 && index < assignments.value.length) {
    assignments.value[index].recordId = recordId;
    assignments.value[index].matchType = recordId ? 'manual' : 'none';
  }
}

function removeFile(index: number) {
  assignments.value.splice(index, 1);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function uploadAll() {
  if (!projects.currentProjectId || isUploading.value) return;

  isUploading.value = true;
  let successCount = 0;
  let errorCount = 0;

  for (const assignment of assignments.value) {
    if (!assignment.recordId) continue;

    assignment.status = 'uploading';
    try {
      const content = await readFileAsBase64(assignment.file);
      const response = await backend.call<UploadPdfResponse>('upload_pdf', {
        project_id: projects.currentProjectId,
        record_id: assignment.recordId,
        filename: assignment.file.name,
        content,
        skip_commit: true,
      });

      if (response.success) {
        assignment.status = 'success';
        successCount++;
      } else {
        assignment.status = 'error';
        assignment.error = 'Upload failed';
        errorCount++;
      }
    } catch (err) {
      assignment.status = 'error';
      assignment.error = err instanceof Error ? err.message : 'Unknown error';
      errorCount++;
    }
  }

  isUploading.value = false;

  if (successCount > 0) {
    notifications.success(
      'Batch upload complete',
      `${successCount} PDF(s) uploaded${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
    );
  }

  if (errorCount === 0) {
    emit('complete');
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-3xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FileUp class="h-5 w-5" />
          Batch Upload PDFs
        </DialogTitle>
        <DialogDescription>
          Select multiple PDF files and match them to records that need PDFs.
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 min-h-0 flex flex-col gap-4">
        <!-- File picker area -->
        <div
          v-if="assignments.length === 0"
          class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          data-testid="batch-upload-dropzone"
          @click="selectFiles"
        >
          <FileUp class="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p class="text-sm font-medium">Click to select PDF files</p>
          <p class="text-xs text-muted-foreground mt-1">
            Files will be auto-matched to records by filename
          </p>
        </div>

        <!-- File assignments list -->
        <template v-else>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Badge variant="secondary">{{ assignments.length }} file(s)</Badge>
              <Badge v-if="matchedCount > 0" variant="default">
                {{ matchedCount }} matched
              </Badge>
              <Badge v-if="unmatchedCount > 0" variant="destructive">
                {{ unmatchedCount }} unmatched
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              :disabled="isUploading"
              data-testid="batch-upload-reselect"
              @click="selectFiles"
            >
              Change files
            </Button>
          </div>

          <ScrollArea class="flex-1">
            <Table class="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead class="w-[35%]">PDF File</TableHead>
                  <TableHead class="w-[40%]">Assign to Record</TableHead>
                  <TableHead class="w-[80px]">Match</TableHead>
                  <TableHead class="w-[80px] text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="(assignment, index) in assignments"
                  :key="index"
                  :data-testid="'batch-upload-row-' + index"
                >
                  <TableCell class="overflow-hidden">
                    <div class="flex items-center gap-2">
                      <File class="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span class="text-sm truncate">{{ assignment.file.name }}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <select
                      :value="assignment.recordId ?? ''"
                      :disabled="assignment.status !== 'pending'"
                      class="w-full text-sm bg-background border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                      :data-testid="'batch-upload-select-' + index"
                      @change="assignRecord(index, ($event.target as HTMLSelectElement).value || null)"
                    >
                      <option value="">-- Unassigned --</option>
                      <option
                        v-for="record in availableRecordsFor(index)"
                        :key="record.ID"
                        :value="record.ID"
                      >
                        {{ record.ID }} - {{ record.author?.split(',')[0] }} ({{ record.year }})
                      </option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <Badge
                      v-if="assignment.matchType === 'exact'"
                      variant="default"
                      class="text-[10px] px-1.5"
                    >
                      Exact
                    </Badge>
                    <Badge
                      v-else-if="assignment.matchType === 'fuzzy'"
                      variant="secondary"
                      class="text-[10px] px-1.5"
                    >
                      Fuzzy
                    </Badge>
                    <Badge
                      v-else-if="assignment.matchType === 'manual'"
                      variant="outline"
                      class="text-[10px] px-1.5"
                    >
                      Manual
                    </Badge>
                    <Badge
                      v-else
                      variant="destructive"
                      class="text-[10px] px-1.5"
                    >
                      None
                    </Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <Check
                      v-if="assignment.status === 'success'"
                      class="h-4 w-4 inline text-green-500"
                    />
                    <Loader2
                      v-else-if="assignment.status === 'uploading'"
                      class="h-4 w-4 inline animate-spin"
                    />
                    <AlertTriangle
                      v-else-if="assignment.status === 'error'"
                      class="h-4 w-4 inline text-destructive"
                      :title="assignment.error"
                    />
                    <Button
                      v-else
                      variant="ghost"
                      size="sm"
                      class="h-6 w-6 p-0"
                      :disabled="isUploading"
                      @click="removeFile(index)"
                    >
                      <X class="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </ScrollArea>
        </template>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isUploading"
          @click="emit('update:open', false)"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canUpload"
          data-testid="batch-upload-submit"
          @click="uploadAll"
        >
          <Loader2 v-if="isUploading" class="h-4 w-4 mr-2 animate-spin" />
          <FileUp v-else class="h-4 w-4 mr-2" />
          Upload {{ matchedCount }} PDF(s)
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
