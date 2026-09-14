<script setup lang="ts">
import { computed } from 'vue';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Upload,
} from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import PdfViewerPanel from '@/components/screen/PdfViewerPanel.vue';
import {
  getDefectCheck,
  getDefectLabel,
  getDefects,
  getIgnoredDefects,
  formatPages,
  getVenue,
  statusLabel,
  statusPillClass,
  statusPillDotClass,
  type PdfRecord,
} from './pdf-record-utils';

/**
 * Full-page look at one record's PDF, next to what pdf-prep flagged about it.
 *
 * pdf-prep's defect checks are text heuristics ("author-not-in-pdf" only means
 * the author string wasn't matched in the extracted text). The user looking at
 * the file is the authority, so a flagged record can be accepted as-is from
 * here — or sent back for a re-upload / marked unavailable without leaving.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    record: PdfRecord | null;
    /** Position in the flagged queue, for prev/next. Null hides navigation. */
    queuePosition?: { index: number; total: number } | null;
    readOnly?: boolean;
    accepting?: boolean;
    marking?: boolean;
  }>(),
  {
    queuePosition: null,
    readOnly: false,
    accepting: false,
    marking: false,
  },
);

const emit = defineEmits<{
  'update:open': [value: boolean];
  accept: [recordId: string];
  upload: [recordId: string];
  'mark-not-available': [recordId: string];
  prev: [];
  next: [];
}>();

const defects = computed(() => (props.record ? getDefects(props.record) : []));
const ignoredDefects = computed(() =>
  props.record ? getIgnoredDefects(props.record) : [],
);
const isFlagged = computed(
  () => props.record?.colrev_status === 'pdf_needs_manual_preparation',
);
const fileMissing = computed(() => props.record?.file_on_disk !== true);
const busy = computed(() => props.accepting || props.marking);

const metaLine = computed(() => {
  const r = props.record;
  if (!r) return '';
  return [r.year, getVenue(r), r.pages ? `pp. ${formatPages(r.pages)}` : '']
    .filter(Boolean)
    .join(' · ');
});

function onKeydown(event: KeyboardEvent) {
  if (!props.queuePosition || busy.value) return;
  // Leave arrow keys alone while focus is inside the PDF or a form control.
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, iframe')) return;
  if (event.key === 'ArrowLeft' && props.queuePosition.index > 0) {
    event.preventDefault();
    emit('prev');
  } else if (
    event.key === 'ArrowRight' &&
    props.queuePosition.index < props.queuePosition.total - 1
  ) {
    event.preventDefault();
    emit('next');
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="w-[96vw] sm:max-w-[96vw] h-[94vh] p-0 gap-0 flex flex-col overflow-hidden"
      data-testid="pdf-review-dialog"
      @keydown="onKeydown"
    >
      <template v-if="record">
        <!-- Header: which record this is, and where it sits in the queue -->
        <header class="flex items-start gap-4 px-5 py-3 pr-12 border-b border-border/60 shrink-0">
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-sm font-medium leading-snug truncate" :title="record.title">
              {{ record.title || record.ID }}
            </DialogTitle>
            <DialogDescription class="text-xs text-muted-foreground truncate mt-0.5">
              <span class="font-mono">{{ record.ID }}</span>
              <template v-if="metaLine"> · {{ metaLine }}</template>
            </DialogDescription>
          </div>
          <div
            v-if="queuePosition && queuePosition.total > 1"
            class="flex items-center gap-1 shrink-0 text-xs text-muted-foreground tabular-nums"
            data-testid="pdf-review-nav"
          >
            <Button
              size="icon-sm"
              variant="ghost"
              :disabled="queuePosition.index === 0 || busy"
              aria-label="Previous flagged PDF"
              data-testid="pdf-review-prev"
              @click="emit('prev')"
            >
              <ChevronLeft class="h-4 w-4" />
            </Button>
            <span>{{ queuePosition.index + 1 }} of {{ queuePosition.total }} flagged</span>
            <Button
              size="icon-sm"
              variant="ghost"
              :disabled="queuePosition.index >= queuePosition.total - 1 || busy"
              aria-label="Next flagged PDF"
              data-testid="pdf-review-next"
              @click="emit('next')"
            >
              <ChevronRight class="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div class="flex-1 min-h-0 flex flex-col md:flex-row">
          <!-- The PDF gets the room -->
          <div class="flex-1 min-h-0 min-w-0 p-3 flex flex-col">
            <PdfViewerPanel :key="record.ID" :pdf-path="record.file" class="flex-1 min-h-0" />
          </div>

          <!-- The case for and against the flag, then the decision -->
          <aside
            class="md:w-[340px] shrink-0 border-t md:border-t-0 md:border-l border-border/60 flex flex-col min-h-0"
            data-testid="pdf-review-sidebar"
          >
            <div class="flex-1 min-h-0 overflow-auto px-5 py-4 space-y-5">
              <section>
                <h3 class="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Record</h3>
                <dl class="text-xs space-y-1.5">
                  <div>
                    <dt class="text-muted-foreground">Authors</dt>
                    <dd class="text-foreground leading-relaxed">{{ record.author || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-muted-foreground">Status</dt>
                    <dd>
                      <span :class="statusPillClass(record.colrev_status)">
                        <span
                          class="h-1.5 w-1.5 rounded-full shrink-0"
                          :class="statusPillDotClass(record.colrev_status)"
                        />
                        {{ statusLabel(record.colrev_status) }}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>

              <section v-if="isFlagged">
                <h3 class="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                  What CoLRev flagged
                </h3>
                <ul v-if="defects.length" class="space-y-3" data-testid="pdf-review-defects">
                  <li
                    v-for="defect in defects"
                    :key="defect"
                    class="text-xs"
                    :data-testid="`pdf-review-defect-${defect}`"
                  >
                    <div class="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                      <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
                      {{ getDefectLabel(defect) }}
                    </div>
                    <p class="text-muted-foreground leading-relaxed mt-1">
                      {{ getDefectCheck(defect, record) }}
                    </p>
                  </li>
                </ul>
                <p v-else class="text-xs text-muted-foreground leading-relaxed">
                  Preparation stopped on this PDF without naming a specific
                  problem. Check that it is the right article and readable.
                </p>
              </section>

              <section v-if="ignoredDefects.length" data-testid="pdf-review-ignored">
                <h3 class="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                  Accepted despite
                </h3>
                <p class="text-xs text-muted-foreground leading-relaxed">
                  {{ ignoredDefects.map(getDefectLabel).join(', ') }} — a
                  reviewer checked the PDF and overrode these flags.
                </p>
              </section>
            </div>

            <footer
              v-if="isFlagged && !readOnly"
              class="shrink-0 border-t border-border/60 px-5 py-4 space-y-2"
            >
              <p v-if="fileMissing" class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                The PDF isn't on this machine, so it can't be checked or accepted here.
              </p>
              <Button
                class="w-full"
                :disabled="fileMissing || busy"
                data-testid="pdf-review-accept"
                @click="emit('accept', record.ID)"
              >
                <Loader2 v-if="accepting" class="h-4 w-4 animate-spin" />
                <CheckCircle2 v-else class="h-4 w-4" />
                PDF is fine — accept it
              </Button>
              <p class="text-[11px] text-muted-foreground/80 leading-relaxed text-center">
                The flags are kept as overridden, so re-running preparation won't raise them again.
              </p>
              <div class="flex gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  class="flex-1 text-xs"
                  :disabled="busy"
                  data-testid="pdf-review-reupload"
                  @click="emit('upload', record.ID)"
                >
                  <Upload class="h-3.5 w-3.5" />
                  Re-upload
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="flex-1 text-xs text-muted-foreground hover:text-foreground"
                  :disabled="busy"
                  data-testid="pdf-review-not-available"
                  @click="emit('mark-not-available', record.ID)"
                >
                  <Loader2 v-if="marking" class="h-3.5 w-3.5 animate-spin" />
                  <Ban v-else class="h-3.5 w-3.5" />
                  Unavailable
                </Button>
              </div>
            </footer>
          </aside>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>
