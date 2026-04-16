<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  Search,
  Loader2,
  Undo2,
  Upload,
  Ban,
  CheckCircle2,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Copy,
  Check,
  ExternalLink,
  FileWarning,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getDefects,
  getDefectLabel,
  getDefectSentence,
  getVenue,
  statusLabel,
  statusPillClass,
  statusPillDotClass,
  type PdfRecord,
  type StatusFilterPill,
  type UploadResult,
} from './pdf-record-utils';

export type { PdfRecord, StatusFilterPill, UploadResult };

type SortKey = 'title' | 'author' | 'year' | 'status';
type SortDir = 'asc' | 'desc';

const props = withDefaults(
  defineProps<{
    records: PdfRecord[];
    title?: string;
    showStatus?: boolean;
    showActions?: boolean;
    testId?: string;
    uploadingRecordId?: string | null;
    markingRecordId?: string | null;
    undoingRecordId?: string | null;
    uploadResults?: globalThis.Record<string, UploadResult>;
    filterPills?: StatusFilterPill[];
    defaultPillIdx?: number;
    defectsAsProse?: boolean;
  }>(),
  {
    title: 'records',
    showStatus: true,
    showActions: false,
    defaultPillIdx: 0,
    defectsAsProse: false,
  },
);

defineEmits<{
  upload: [recordId: string];
  'mark-not-available': [recordId: string];
  'undo-not-available': [recordId: string];
  'upload-missing': [recordId: string];
}>();

const search = ref('');
const activePillIdx = ref(props.defaultPillIdx);

const sortKey = ref<SortKey | null>(null);
const sortDir = ref<SortDir>('asc');

const activePill = computed<StatusFilterPill | null>(() => {
  if (!props.filterPills?.length) return null;
  return props.filterPills[activePillIdx.value] ?? props.filterPills[0];
});

function matchesPill(record: PdfRecord, pill: StatusFilterPill): boolean {
  if (pill.statuses !== null) {
    if (!pill.statuses.includes(record.colrev_status)) return false;
  }
  if (pill.requireOnDisk && record.file_on_disk !== true) return false;
  if (pill.requireMissing && record.file_on_disk !== false) return false;
  return true;
}

function pillCount(pill: StatusFilterPill): number {
  return props.records.filter((r) => matchesPill(r, pill)).length;
}

function toggleSort(key: SortKey) {
  if (sortKey.value !== key) {
    sortKey.value = key;
    sortDir.value = 'asc';
    return;
  }
  if (sortDir.value === 'asc') {
    sortDir.value = 'desc';
    return;
  }
  sortKey.value = null;
  sortDir.value = 'asc';
}

function sortValue(r: PdfRecord, key: SortKey): string | number {
  switch (key) {
    case 'title':
      return (r.title || '').toLowerCase();
    case 'author':
      return (r.author || '').toLowerCase();
    case 'year': {
      const n = parseInt(r.year || '', 10);
      return isNaN(n) ? -Infinity : n;
    }
    case 'status':
      return statusLabel(r.colrev_status).toLowerCase();
  }
}

const copiedRecordId = ref<string | null>(null);

function doiUrl(record: PdfRecord): string | null {
  const doi = record.doi?.trim();
  if (!doi) return null;
  if (doi.startsWith('http://') || doi.startsWith('https://')) return doi;
  return `https://doi.org/${doi.replace(/^doi:/i, '')}`;
}

async function copyDoi(record: PdfRecord) {
  const url = doiUrl(record);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    copiedRecordId.value = record.ID;
    setTimeout(() => {
      if (copiedRecordId.value === record.ID) copiedRecordId.value = null;
    }, 1500);
  } catch {
    // ignore
  }
}

function openDoi(record: PdfRecord) {
  const url = doiUrl(record);
  if (!url) return;
  window.open(url, '_blank');
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const pill = activePill.value;
  const matched = props.records.filter((r) => {
    if (pill && !matchesPill(r, pill)) return false;
    if (!q) return true;
    return (
      r.title?.toLowerCase().includes(q) ||
      r.author?.toLowerCase().includes(q) ||
      r.ID?.toLowerCase().includes(q) ||
      r.year?.toLowerCase().includes(q) ||
      getVenue(r).toLowerCase().includes(q) ||
      r.doi?.toLowerCase().includes(q)
    );
  });
  if (!sortKey.value) return matched;
  const key = sortKey.value;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...matched].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
});

const columnCount = computed(
  () => 4 + (props.showStatus ? 1 : 0) + (props.showActions ? 1 : 0),
);
// 1 (copy) + 1 (title) + 1 (author) + 1 (year) + status? + actions?

function hasDefects(record: PdfRecord): boolean {
  return (
    record.colrev_status === 'pdf_needs_manual_preparation' &&
    getDefects(record).length > 0
  );
}

function defectStatusLabel(record: PdfRecord): string {
  const defects = getDefects(record);
  if (defects.length === 0) return statusLabel(record.colrev_status);
  if (defects.length === 1) return getDefectLabel(defects[0]);
  return `${getDefectLabel(defects[0])} +${defects.length - 1}`;
}

function defectTooltip(record: PdfRecord): string {
  return getDefects(record).map(getDefectSentence).join(' ');
}
</script>

<template>
  <section :data-testid="testId" class="flex flex-col h-full min-h-0">
    <div class="flex items-center justify-between gap-3 mb-2 flex-wrap shrink-0">
      <div class="text-sm text-muted-foreground flex items-center gap-2">
        <span class="tabular-nums font-medium text-foreground">{{ records.length }}</span>
        <span>{{ title }}</span>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <div v-if="filterPills?.length" class="flex items-center gap-1">
          <button v-for="(pill, idx) in filterPills" :key="pill.label" type="button"
            class="inline-flex items-center justify-center h-7 px-3 rounded-full text-xs leading-none border transition-colors tabular-nums whitespace-nowrap shrink-0"
            :class="idx === activePillIdx
              ? 'bg-foreground text-background border-foreground'
              : 'bg-transparent text-muted-foreground border-border/60 hover:text-foreground hover:border-border'
              " :data-testid="testId ? `${testId}-pill-${pill.label.toLowerCase().replace(/\s+/g, '-')}` : undefined"
            @click="activePillIdx = idx">
            {{ pill.label }}
            <span class="ml-1 opacity-70">{{ pillCount(pill) }}</span>
          </button>
        </div>
        <div class="relative w-64 max-w-full">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input v-model="search" placeholder="Filter title, author, ID…" class="pl-8 h-8 text-xs"
            :data-testid="testId ? `${testId}-search` : undefined" />
        </div>
      </div>
    </div>

    <div class="border border-border/60 rounded-md flex flex-col flex-1 min-h-0 overflow-hidden">
      <div class="overflow-auto flex-1 min-h-0">
        <Table class="table-fixed w-full text-xs">
          <TableHeader class="sticky top-0 bg-background z-10">
            <TableRow class="hover:bg-transparent">
              <TableHead class="h-8 px-2 w-[68px]"><span class="sr-only">DOI actions</span></TableHead>
              <TableHead class="h-8 px-3">
                <button type="button" class="inline-flex items-center gap-1 hover:text-foreground"
                  :class="sortKey === 'title' ? 'text-foreground' : ''" @click="toggleSort('title')">
                  Title
                  <ArrowUp v-if="sortKey === 'title' && sortDir === 'asc'" class="h-3 w-3" />
                  <ArrowDown v-else-if="sortKey === 'title' && sortDir === 'desc'" class="h-3 w-3" />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-40" />
                </button>
              </TableHead>
              <TableHead class="h-8 px-3 w-[22%]">
                <button type="button" class="inline-flex items-center gap-1 hover:text-foreground"
                  :class="sortKey === 'author' ? 'text-foreground' : ''" @click="toggleSort('author')">
                  Author
                  <ArrowUp v-if="sortKey === 'author' && sortDir === 'asc'" class="h-3 w-3" />
                  <ArrowDown v-else-if="sortKey === 'author' && sortDir === 'desc'" class="h-3 w-3" />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-40" />
                </button>
              </TableHead>
              <TableHead class="h-8 px-3 w-[64px]">
                <button type="button" class="inline-flex items-center gap-1 hover:text-foreground"
                  :class="sortKey === 'year' ? 'text-foreground' : ''" @click="toggleSort('year')">
                  Year
                  <ArrowUp v-if="sortKey === 'year' && sortDir === 'asc'" class="h-3 w-3" />
                  <ArrowDown v-else-if="sortKey === 'year' && sortDir === 'desc'" class="h-3 w-3" />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-40" />
                </button>
              </TableHead>
              <TableHead v-if="showStatus" class="h-8 px-3 w-[132px] whitespace-nowrap">
                <button type="button" class="inline-flex items-center gap-1 hover:text-foreground"
                  :class="sortKey === 'status' ? 'text-foreground' : ''" @click="toggleSort('status')">
                  Status
                  <ArrowUp v-if="sortKey === 'status' && sortDir === 'asc'" class="h-3 w-3" />
                  <ArrowDown v-else-if="sortKey === 'status' && sortDir === 'desc'" class="h-3 w-3" />
                  <ArrowUpDown v-else class="h-3 w-3 opacity-40" />
                </button>
              </TableHead>
              <TableHead v-if="showActions" class="h-8 pl-4 pr-3 w-[260px] text-right whitespace-nowrap">Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-for="record in filtered" :key="record.ID">
              <TableRow class="hover:bg-muted/30" :data-testid="`pdf-record-row-${record.ID}`">
                <TableCell class="py-1.5 px-2 pr-0 align-middle">
                  <div class="flex items-center gap-0.5">
                    <TooltipProvider :disable-hoverable-content="true">
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <button type="button"
                            class="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            :disabled="!doiUrl(record)" :data-testid="`pdf-copy-doi-btn-${record.ID}`"
                            @click="copyDoi(record)">
                            <Check v-if="copiedRecordId === record.ID" class="h-3.5 w-3.5 text-green-600" />
                            <Copy v-else class="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p v-if="!doiUrl(record)">No DOI</p>
                          <p v-else-if="copiedRecordId === record.ID">Copied!</p>
                          <p v-else>Copy DOI link</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider :disable-hoverable-content="true">
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <button type="button"
                            class="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            :disabled="!doiUrl(record)" :data-testid="`pdf-open-doi-btn-${record.ID}`"
                            @click="openDoi(record)">
                            <ExternalLink class="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p v-if="!doiUrl(record)">No DOI</p>
                          <p v-else>Open DOI in browser</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableCell>
                <TableCell class="py-1.5  overflow-hidden">
                  <div class="truncate font-medium text-foreground" :title="record.title">
                    {{ record.title }}
                  </div>
                  <div class="truncate font-mono text-[10px] text-muted-foreground/70" :title="record.ID">
                    {{ record.ID }}
                  </div>
                </TableCell>
                <TableCell class="py-1.5 px-3 overflow-hidden">
                  <span class="block truncate" :title="record.author">{{ record.author }}</span>
                </TableCell>
                <TableCell class="py-1.5 px-3 tabular-nums">{{ record.year }}</TableCell>
                <TableCell v-if="showStatus" class="py-1.5 px-3 whitespace-nowrap overflow-hidden">
                  <div class="flex items-center gap-1.5">
                    <TooltipProvider v-if="defectsAsProse && hasDefects(record)">
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <span :class="statusPillClass(record.colrev_status)" :data-testid="`pdf-defects-${record.ID}`">
                            <span class="h-1.5 w-1.5 rounded-full shrink-0"
                              :class="statusPillDotClass(record.colrev_status)" />
                            <template v-for="defect in getDefects(record)" :key="defect">
                              <span :data-testid="`pdf-defect-badge-${defect}`" class="sr-only">{{ defect }}</span>
                            </template>
                            {{ defectStatusLabel(record) }}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" class="max-w-xs">
                          <p class="leading-relaxed">{{ defectTooltip(record) }}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span v-else :class="statusPillClass(record.colrev_status)">
                      <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="statusPillDotClass(record.colrev_status)" />
                      {{ statusLabel(record.colrev_status) }}
                    </span>
                    <TooltipProvider v-if="record.file_on_disk === false">
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <span
                            class="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300 shrink-0"
                            :data-testid="`pdf-missing-badge-${record.ID}`"
                            aria-label="Missing on disk"
                          >
                            <FileWarning class="h-3 w-3" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" class="max-w-xs">
                          <p class="leading-relaxed">
                            PDF file not on this machine — import a teammate's zip or upload the file manually.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableCell>
                <TableCell v-if="showActions" class="py-1 pl-4 pr-3 text-right overflow-hidden">
                  <div class="flex items-center justify-end gap-1">
                    <template v-if="record.colrev_status === 'pdf_needs_manual_retrieval'">
                      <Button v-if="uploadingRecordId === record.ID" size="sm" variant="ghost" disabled
                        class="h-7 px-2.5 text-xs" :data-testid="`pdf-upload-btn-${record.ID}`">
                        <Loader2 class="h-3 w-3 mr-1 animate-spin" />
                        Uploading
                      </Button>
                      <Button v-else-if="uploadResults?.[record.ID]?.status === 'success'" size="sm" variant="ghost"
                        disabled class="h-7 px-2.5 text-xs text-green-600" :data-testid="`pdf-upload-btn-${record.ID}`">
                        <CheckCircle2 class="h-3 w-3 mr-1" />
                        Prepared
                      </Button>
                      <TooltipProvider v-else-if="uploadResults?.[record.ID]?.status === 'prep-failed'">
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Button size="sm" variant="ghost" disabled class="h-7 px-2.5 text-xs text-amber-600"
                              :data-testid="`pdf-upload-btn-${record.ID}`">
                              <AlertTriangle class="h-3 w-3 mr-1" />
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
                            <Button size="sm" variant="ghost" disabled class="h-7 px-2.5 text-xs text-red-600"
                              :data-testid="`pdf-upload-btn-${record.ID}`">
                              <AlertTriangle class="h-3 w-3 mr-1" />
                              Error
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{{ uploadResults?.[record.ID]?.message || 'Upload failed' }}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button v-else size="sm" variant="ghost" class="h-7 px-2.5 text-xs"
                        :data-testid="`pdf-upload-btn-${record.ID}`" @click="$emit('upload', record.ID)">
                        <Upload class="h-3 w-3 mr-1" />
                        Upload
                      </Button>
                      <Button size="sm" variant="ghost"
                        class="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="markingRecordId === record.ID" :data-testid="`pdf-not-available-btn-${record.ID}`"
                        @click="$emit('mark-not-available', record.ID)">
                        <Loader2 v-if="markingRecordId === record.ID" class="h-3 w-3 mr-1 animate-spin" />
                        <Ban v-else class="h-3 w-3 mr-1" />
                        Unavailable
                      </Button>
                    </template>

                    <template v-else-if="record.colrev_status === 'pdf_not_available'">
                      <Button size="sm" variant="ghost"
                        class="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="undoingRecordId === record.ID" :data-testid="`pdf-undo-btn-${record.ID}`"
                        @click="$emit('undo-not-available', record.ID)">
                        <Loader2 v-if="undoingRecordId === record.ID" class="h-3 w-3 mr-1 animate-spin" />
                        <Undo2 v-else class="h-3 w-3 mr-1" />
                        Undo
                      </Button>
                      <Button size="sm" variant="ghost" class="h-7 px-2.5 text-xs"
                        :disabled="uploadingRecordId === record.ID || undoingRecordId === record.ID"
                        :data-testid="`pdf-upload-btn-${record.ID}`" @click="$emit('upload', record.ID)">
                        <Loader2 v-if="uploadingRecordId === record.ID" class="h-3 w-3 mr-1 animate-spin" />
                        <Upload v-else class="h-3 w-3 mr-1" />
                        Upload
                      </Button>
                    </template>

                    <template v-else-if="record.colrev_status === 'pdf_needs_manual_preparation'">
                      <Button v-if="uploadingRecordId === record.ID" size="sm" variant="ghost" disabled
                        class="h-7 px-2.5 text-xs" :data-testid="`pdf-reupload-btn-${record.ID}`">
                        <Loader2 class="h-3 w-3 mr-1 animate-spin" />
                        Uploading
                      </Button>
                      <Button v-else-if="uploadResults?.[record.ID]?.status === 'success'" size="sm" variant="ghost"
                        disabled class="h-7 px-2.5 text-xs text-green-600"
                        :data-testid="`pdf-reupload-btn-${record.ID}`">
                        <CheckCircle2 class="h-3 w-3 mr-1" />
                        Prepared
                      </Button>
                      <TooltipProvider v-else-if="uploadResults?.[record.ID]?.status === 'error'">
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Button size="sm" variant="ghost" disabled class="h-7 px-2.5 text-xs text-red-600"
                              :data-testid="`pdf-reupload-btn-${record.ID}`">
                              <AlertTriangle class="h-3 w-3 mr-1" />
                              Error
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{{ uploadResults?.[record.ID]?.message || 'Re-upload failed' }}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button v-else size="sm" variant="ghost" class="h-7 px-2.5 text-xs"
                        :data-testid="`pdf-reupload-btn-${record.ID}`" @click="$emit('upload', record.ID)">
                        <Upload class="h-3 w-3 mr-1" />
                        Re-upload
                      </Button>
                      <Button size="sm" variant="ghost"
                        class="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        :disabled="markingRecordId === record.ID || uploadingRecordId === record.ID"
                        :data-testid="`pdf-not-available-btn-${record.ID}`"
                        @click="$emit('mark-not-available', record.ID)">
                        <Loader2 v-if="markingRecordId === record.ID" class="h-3 w-3 mr-1 animate-spin" />
                        <Ban v-else class="h-3 w-3 mr-1" />
                        Unavailable
                      </Button>
                    </template>

                    <template v-else-if="record.file_on_disk === false">
                      <Button v-if="uploadingRecordId === record.ID" size="sm" variant="ghost" disabled
                        class="h-7 px-2.5 text-xs" :data-testid="`pdf-upload-missing-btn-${record.ID}`">
                        <Loader2 class="h-3 w-3 mr-1 animate-spin" />
                        Uploading
                      </Button>
                      <Button v-else-if="uploadResults?.[record.ID]?.status === 'success'" size="sm" variant="ghost"
                        disabled class="h-7 px-2.5 text-xs text-green-600"
                        :data-testid="`pdf-upload-missing-btn-${record.ID}`">
                        <CheckCircle2 class="h-3 w-3 mr-1" />
                        Restored
                      </Button>
                      <Button v-else size="sm" variant="ghost" class="h-7 px-2.5 text-xs"
                        :data-testid="`pdf-upload-missing-btn-${record.ID}`"
                        @click="$emit('upload-missing', record.ID)">
                        <Upload class="h-3 w-3 mr-1" />
                        Upload file
                      </Button>
                    </template>
                  </div>
                </TableCell>
              </TableRow>
            </template>
            <TableRow v-if="filtered.length === 0" class="hover:bg-transparent">
              <TableCell :colspan="columnCount" class="py-6 text-center text-muted-foreground">
                {{ search ? 'No records match.' : 'No records.' }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  </section>
</template>
