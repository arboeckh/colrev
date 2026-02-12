<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  FileUp,
  Loader2,
  Check,
  AlertTriangle,
  X,
  File,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import type { UploadPdfResponse, MatchPdfToRecordsResponse, MatchCandidate } from '@/types/api';
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

type Phase = 'SELECT_FILES' | 'ANALYZING' | 'REVIEW_MATCHES' | 'UPLOADING';

interface FileAssignment {
  file: File;
  recordId: string | null;
  matchType: 'high' | 'medium' | 'filename' | 'manual' | 'none';
  matchConfidence: number;
  extractedMetadata: {
    title?: string;
    author?: string;
    year?: string;
    doi?: string;
  } | null;
  alternativeMatches: MatchCandidate[];
  analysisStatus: 'pending' | 'analyzing' | 'done' | 'error';
  uploadStatus: 'pending' | 'uploading' | 'success' | 'error';
  uploadError?: string;
  showAlternatives?: boolean;
}

const phase = ref<Phase>('SELECT_FILES');
const assignments = ref<FileAssignment[]>([]);
const analyzeIndex = ref(0);
const cancelAnalysis = ref(false);

const matchedCount = computed(
  () => assignments.value.filter((a) => a.recordId !== null).length,
);
const unmatchedCount = computed(
  () => assignments.value.filter((a) => a.recordId === null).length,
);
const highConfCount = computed(
  () =>
    assignments.value.filter(
      (a) => a.recordId !== null && a.matchConfidence > 0.8,
    ).length,
);
const medConfCount = computed(
  () =>
    assignments.value.filter(
      (a) => a.recordId !== null && a.matchConfidence > 0.5 && a.matchConfidence <= 0.8,
    ).length,
);
const canUpload = computed(
  () => matchedCount.value > 0 && phase.value === 'REVIEW_MATCHES',
);

const analyzeProgress = computed(() => {
  if (assignments.value.length === 0) return 0;
  const done = assignments.value.filter(
    (a) => a.analysisStatus === 'done' || a.analysisStatus === 'error',
  ).length;
  return Math.round((done / assignments.value.length) * 100);
});

const uploadProgress = computed(() => {
  const toUpload = assignments.value.filter((a) => a.recordId !== null);
  if (toUpload.length === 0) return 0;
  const done = toUpload.filter(
    (a) => a.uploadStatus === 'success' || a.uploadStatus === 'error',
  ).length;
  return Math.round((done / toUpload.length) * 100);
});

// Available records for dropdown (not already assigned to another file)
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
      phase.value = 'SELECT_FILES';
      assignments.value = [];
      analyzeIndex.value = 0;
      cancelAnalysis.value = false;
    }
  },
);

// --- Phase 1: SELECT_FILES ---

function selectFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf';
  input.multiple = true;
  input.onchange = () => handleFileSelection(input.files);
  input.click();
}

function selectFolder() {
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('webkitdirectory', '');
  input.onchange = () => handleFileSelection(input.files);
  input.click();
}

function handleFileSelection(files: FileList | null) {
  if (!files || files.length === 0) return;

  const pdfFiles = Array.from(files).filter((f) =>
    f.name.toLowerCase().endsWith('.pdf'),
  );

  if (pdfFiles.length === 0) {
    notifications.warning('No PDFs found', 'No PDF files were found in your selection.');
    return;
  }

  assignments.value = pdfFiles.map((file) => ({
    file,
    recordId: null,
    matchType: 'none' as const,
    matchConfidence: 0,
    extractedMetadata: null,
    alternativeMatches: [],
    analysisStatus: 'pending' as const,
    uploadStatus: 'pending' as const,
  }));

  startAnalysis();
}

// --- Phase 2: ANALYZING ---

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

async function startAnalysis() {
  phase.value = 'ANALYZING';
  cancelAnalysis.value = false;
  analyzeIndex.value = 0;

  for (let i = 0; i < assignments.value.length; i++) {
    if (cancelAnalysis.value) break;

    analyzeIndex.value = i;
    const assignment = assignments.value[i];
    assignment.analysisStatus = 'analyzing';

    try {
      const content = await readFileAsBase64(assignment.file);
      const response = await backend.call<MatchPdfToRecordsResponse>(
        'match_pdf_to_records',
        {
          project_id: projects.currentProjectId,
          filename: assignment.file.name,
          content,
        },
      );

      if (response.success) {
        assignment.extractedMetadata = response.extracted_metadata
          ? {
              title: response.extracted_metadata.title,
              author: response.extracted_metadata.author,
              year: response.extracted_metadata.year,
              doi: response.extracted_metadata.doi,
            }
          : null;
        assignment.alternativeMatches = response.matches;

        if (response.best_match) {
          assignment.recordId = response.best_match.record_id;
          assignment.matchConfidence = response.best_match.similarity;

          if (response.extraction_method === 'pdf_metadata') {
            assignment.matchType =
              response.best_match.similarity > 0.8 ? 'high' : 'medium';
          } else {
            assignment.matchType = 'filename';
          }
        }

        assignment.analysisStatus = 'done';
      } else {
        assignment.analysisStatus = 'error';
        applyClientFallback(assignment);
      }
    } catch (err) {
      assignment.analysisStatus = 'error';
      applyClientFallback(assignment);
    }
  }

  phase.value = 'REVIEW_MATCHES';
}

function applyClientFallback(assignment: FileAssignment) {
  const stem = assignment.file.name.replace(/\.pdf$/i, '').toLowerCase();

  // Exact match on record ID
  const exactMatch = props.records.find((r) => r.ID.toLowerCase() === stem);
  if (exactMatch) {
    assignment.recordId = exactMatch.ID;
    assignment.matchType = 'filename';
    assignment.matchConfidence = 0.9;
    assignment.analysisStatus = 'done';
    return;
  }

  // Fuzzy match: filename contains author last name + year
  for (const record of props.records) {
    const authorLastName = record.author?.split(',')[0]?.trim().toLowerCase();
    const year = record.year;
    if (
      authorLastName &&
      year &&
      stem.includes(authorLastName) &&
      stem.includes(year)
    ) {
      assignment.recordId = record.ID;
      assignment.matchType = 'filename';
      assignment.matchConfidence = 0.6;
      assignment.analysisStatus = 'done';
      return;
    }
  }

  assignment.analysisStatus = 'done';
}

function stopAnalysisEarly() {
  cancelAnalysis.value = true;
}

// --- Phase 3: REVIEW_MATCHES ---

function assignRecord(index: number, recordId: string | null) {
  if (index >= 0 && index < assignments.value.length) {
    assignments.value[index].recordId = recordId;
    assignments.value[index].matchType = recordId ? 'manual' : 'none';
    assignments.value[index].matchConfidence = recordId ? 0.5 : 0;
  }
}

function selectAlternative(index: number, candidate: MatchCandidate) {
  if (index >= 0 && index < assignments.value.length) {
    assignments.value[index].recordId = candidate.record_id;
    assignments.value[index].matchConfidence = candidate.similarity;
    assignments.value[index].matchType =
      candidate.similarity > 0.8 ? 'high' : 'medium';
    assignments.value[index].showAlternatives = false;
  }
}

function toggleAlternatives(index: number) {
  if (index >= 0 && index < assignments.value.length) {
    assignments.value[index].showAlternatives =
      !assignments.value[index].showAlternatives;
  }
}

function removeFile(index: number) {
  assignments.value.splice(index, 1);
  if (assignments.value.length === 0) {
    phase.value = 'SELECT_FILES';
  }
}

function confidenceLabel(confidence: number): string {
  if (confidence > 0.8) return 'High';
  if (confidence > 0.5) return 'Medium';
  return 'No match';
}

function confidenceVariant(
  confidence: number,
): 'default' | 'secondary' | 'destructive' {
  if (confidence > 0.8) return 'default';
  if (confidence > 0.5) return 'secondary';
  return 'destructive';
}

// --- Phase 4: UPLOADING ---

async function uploadAll() {
  if (!projects.currentProjectId) return;

  phase.value = 'UPLOADING';
  let successCount = 0;
  let errorCount = 0;

  for (const assignment of assignments.value) {
    if (!assignment.recordId) continue;

    assignment.uploadStatus = 'uploading';
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
        assignment.uploadStatus = 'success';
        successCount++;
      } else {
        assignment.uploadStatus = 'error';
        assignment.uploadError = 'Upload failed';
        errorCount++;
      }
    } catch (err) {
      assignment.uploadStatus = 'error';
      assignment.uploadError =
        err instanceof Error ? err.message : 'Unknown error';
      errorCount++;
    }
  }

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
    <DialogContent class="max-w-4xl max-h-[85vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FileUp class="h-5 w-5" />
          Batch Upload PDFs
        </DialogTitle>
        <DialogDescription>
          Upload PDFs and automatically match them to records using metadata extraction.
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 min-h-0 flex flex-col gap-4">
        <!-- Phase 1: SELECT_FILES -->
        <div
          v-if="phase === 'SELECT_FILES'"
          class="flex flex-col items-center gap-4 py-8"
        >
          <FileUp class="h-12 w-12 text-muted-foreground" />
          <p class="text-sm text-muted-foreground text-center max-w-md">
            Select PDF files or a folder. Metadata will be extracted from each
            PDF and matched against records that need PDFs.
          </p>
          <div class="flex gap-3">
            <Button
              variant="outline"
              data-testid="batch-upload-select-files"
              @click="selectFiles"
            >
              <File class="h-4 w-4 mr-2" />
              Select Files
            </Button>
            <Button
              variant="outline"
              data-testid="batch-upload-select-folder"
              @click="selectFolder"
            >
              <FolderOpen class="h-4 w-4 mr-2" />
              Select Folder
            </Button>
          </div>
        </div>

        <!-- Phase 2: ANALYZING -->
        <div
          v-else-if="phase === 'ANALYZING'"
          class="flex flex-col gap-4 py-4"
        >
          <div class="flex items-center justify-between text-sm">
            <span>
              Analyzing {{ analyzeIndex + 1 }} of {{ assignments.length }}...
              <span class="text-muted-foreground">(extracting metadata)</span>
            </span>
            <Button variant="ghost" size="sm" @click="stopAnalysisEarly">
              Cancel
            </Button>
          </div>
          <Progress :model-value="analyzeProgress" class="h-2" />

          <ScrollArea class="flex-1 max-h-[40vh]">
            <div class="space-y-1">
              <div
                v-for="(a, i) in assignments"
                :key="i"
                class="flex items-center gap-2 text-sm px-2 py-1 rounded"
                :class="{
                  'bg-muted/50': a.analysisStatus === 'analyzing',
                }"
              >
                <Loader2
                  v-if="a.analysisStatus === 'analyzing'"
                  class="h-3.5 w-3.5 animate-spin text-primary shrink-0"
                />
                <Check
                  v-else-if="a.analysisStatus === 'done'"
                  class="h-3.5 w-3.5 text-green-500 shrink-0"
                />
                <AlertTriangle
                  v-else-if="a.analysisStatus === 'error'"
                  class="h-3.5 w-3.5 text-yellow-500 shrink-0"
                />
                <div
                  v-else
                  class="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0"
                />
                <span class="truncate text-muted-foreground">{{ a.file.name }}</span>
                <Badge
                  v-if="a.analysisStatus === 'done' && a.recordId"
                  variant="default"
                  class="text-[10px] px-1.5 ml-auto shrink-0"
                >
                  Matched
                </Badge>
              </div>
            </div>
          </ScrollArea>
        </div>

        <!-- Phase 3: REVIEW_MATCHES -->
        <template v-else-if="phase === 'REVIEW_MATCHES'">
          <!-- Summary bar -->
          <div class="flex items-center gap-2 flex-wrap">
            <Badge variant="default">{{ highConfCount }} high</Badge>
            <Badge variant="secondary">{{ medConfCount }} medium</Badge>
            <Badge v-if="unmatchedCount > 0" variant="destructive">
              {{ unmatchedCount }} unmatched
            </Badge>
            <span class="text-xs text-muted-foreground ml-auto">
              {{ matchedCount }} of {{ assignments.length }} matched
            </span>
          </div>

          <ScrollArea class="flex-1">
            <Table class="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead class="w-[25%]">PDF File</TableHead>
                  <TableHead class="w-[25%]">Extracted Info</TableHead>
                  <TableHead class="w-[30%]">Assigned Record</TableHead>
                  <TableHead class="w-[80px]">Confidence</TableHead>
                  <TableHead class="w-[60px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <template v-for="(assignment, index) in assignments" :key="index">
                  <TableRow
                    :data-testid="'batch-upload-row-' + index"
                    :class="{
                      'bg-yellow-500/5': !assignment.recordId,
                    }"
                  >
                    <!-- PDF File -->
                    <TableCell class="overflow-hidden">
                      <div class="flex items-center gap-2">
                        <File class="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span class="text-sm truncate">{{ assignment.file.name }}</span>
                      </div>
                    </TableCell>

                    <!-- Extracted Info -->
                    <TableCell>
                      <div v-if="assignment.extractedMetadata" class="text-xs space-y-0.5">
                        <p
                          v-if="assignment.extractedMetadata.title"
                          class="truncate text-foreground"
                          :title="assignment.extractedMetadata.title"
                        >
                          {{ assignment.extractedMetadata.title }}
                        </p>
                        <p class="text-muted-foreground truncate">
                          {{ assignment.extractedMetadata.author }}
                          <span v-if="assignment.extractedMetadata.year">
                            ({{ assignment.extractedMetadata.year }})
                          </span>
                        </p>
                      </div>
                      <span v-else class="text-xs text-muted-foreground italic">
                        No metadata
                      </span>
                    </TableCell>

                    <!-- Assigned Record -->
                    <TableCell>
                      <select
                        :value="assignment.recordId ?? ''"
                        class="w-full text-sm bg-background border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                        :data-testid="'batch-upload-select-' + index"
                        @change="
                          assignRecord(
                            index,
                            ($event.target as HTMLSelectElement).value || null,
                          )
                        "
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

                    <!-- Confidence -->
                    <TableCell>
                      <Badge
                        v-if="assignment.recordId"
                        :variant="confidenceVariant(assignment.matchConfidence)"
                        class="text-[10px] px-1.5"
                      >
                        {{ confidenceLabel(assignment.matchConfidence) }}
                      </Badge>
                      <Badge
                        v-else
                        variant="destructive"
                        class="text-[10px] px-1.5"
                      >
                        No match
                      </Badge>
                    </TableCell>

                    <!-- Actions -->
                    <TableCell class="text-right">
                      <div class="flex items-center justify-end gap-1">
                        <Button
                          v-if="assignment.alternativeMatches.length > 0 && !assignment.recordId"
                          variant="ghost"
                          size="sm"
                          class="h-6 w-6 p-0"
                          title="Show alternatives"
                          @click="toggleAlternatives(index)"
                        >
                          <ChevronDown
                            v-if="assignment.showAlternatives"
                            class="h-3.5 w-3.5"
                          />
                          <ChevronRight v-else class="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-6 w-6 p-0"
                          @click="removeFile(index)"
                        >
                          <X class="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  <!-- Alternative matches (expandable) -->
                  <TableRow
                    v-if="assignment.showAlternatives && assignment.alternativeMatches.length > 0"
                    class="bg-muted/30"
                  >
                    <TableCell colspan="5" class="py-2 px-4">
                      <p class="text-xs font-medium mb-1 text-muted-foreground">
                        Alternative candidates:
                      </p>
                      <div class="space-y-1">
                        <div
                          v-for="candidate in assignment.alternativeMatches"
                          :key="candidate.record_id"
                          class="flex items-center gap-2 text-xs"
                        >
                          <span class="font-medium">{{ candidate.record_id }}</span>
                          <span class="text-muted-foreground truncate">
                            {{ candidate.author?.split(',')[0] }}
                            ({{ candidate.year }})
                            &mdash; {{ candidate.title }}
                          </span>
                          <Badge
                            :variant="confidenceVariant(candidate.similarity)"
                            class="text-[9px] px-1 shrink-0"
                          >
                            {{ (candidate.similarity * 100).toFixed(0) }}%
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            class="h-5 text-[10px] px-2 ml-auto shrink-0"
                            @click="selectAlternative(index, candidate)"
                          >
                            Select
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                </template>
              </TableBody>
            </Table>
          </ScrollArea>
        </template>

        <!-- Phase 4: UPLOADING -->
        <div
          v-else-if="phase === 'UPLOADING'"
          class="flex flex-col gap-4 py-4"
        >
          <div class="flex items-center justify-between text-sm">
            <span>Uploading PDFs...</span>
            <span class="text-muted-foreground">{{ uploadProgress }}%</span>
          </div>
          <Progress :model-value="uploadProgress" class="h-2" />

          <ScrollArea class="flex-1 max-h-[40vh]">
            <div class="space-y-1">
              <div
                v-for="(a, i) in assignments.filter((x) => x.recordId !== null)"
                :key="i"
                class="flex items-center gap-2 text-sm px-2 py-1"
              >
                <Loader2
                  v-if="a.uploadStatus === 'uploading'"
                  class="h-3.5 w-3.5 animate-spin text-primary shrink-0"
                />
                <Check
                  v-else-if="a.uploadStatus === 'success'"
                  class="h-3.5 w-3.5 text-green-500 shrink-0"
                />
                <AlertTriangle
                  v-else-if="a.uploadStatus === 'error'"
                  class="h-3.5 w-3.5 text-destructive shrink-0"
                />
                <div
                  v-else
                  class="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0"
                />
                <span class="truncate">{{ a.file.name }}</span>
                <span class="text-muted-foreground ml-auto shrink-0">
                  &rarr; {{ a.recordId }}
                </span>
                <span
                  v-if="a.uploadError"
                  class="text-destructive text-xs shrink-0"
                >
                  {{ a.uploadError }}
                </span>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="phase === 'UPLOADING'"
          @click="emit('update:open', false)"
        >
          {{ phase === 'UPLOADING' ? 'Please wait...' : 'Cancel' }}
        </Button>
        <Button
          v-if="phase === 'REVIEW_MATCHES'"
          :disabled="!canUpload"
          data-testid="batch-upload-submit"
          @click="uploadAll"
        >
          <FileUp class="h-4 w-4 mr-2" />
          Upload {{ matchedCount }} PDF(s)
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
