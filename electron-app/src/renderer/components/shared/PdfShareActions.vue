<script setup lang="ts">
import { ref } from 'vue';
import { Download, Upload, Loader2, AlertTriangle } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBackendStore } from '@/stores/backend';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';

interface ExportResponse {
  success: boolean;
  file_count: number;
  total_bytes: number;
  path: string;
}

interface ImportResponse {
  success: boolean;
  imported_count: number;
  skipped_count: number;
  overwritten_count: number;
  conflicts: string[];
  manifest_project_id?: string | null;
  manifest_mismatch?: boolean;
}

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'compact';
    actions?: 'both' | 'import-only' | 'export-only';
  }>(),
  {
    variant: 'default',
    actions: 'both',
  },
);

const emit = defineEmits<{
  (e: 'imported', count: number): void;
  (e: 'exported', count: number): void;
}>();

const backend = useBackendStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();

const isExporting = ref(false);
const isImporting = ref(false);

const conflictPrompt = ref<{ zipPath: string; conflicts: string[] } | null>(null);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function onExport() {
  const projectId = projects.currentProjectId;
  if (!projectId) {
    notifications.error('No project selected', 'Open a project first.');
    return;
  }
  if (isExporting.value) return;

  const defaultName = `${projectId}-pdfs-${new Date().toISOString().slice(0, 10)}.zip`;
  const chosen = await window.fileOps.chooseSavePath({
    defaultName,
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  });
  if (!chosen.success || !chosen.filePath) return;

  isExporting.value = true;
  try {
    const res = await backend.call<ExportResponse>('export_pdfs', {
      project_id: projectId,
      output_path: chosen.filePath,
    });

    if (res.file_count === 0) {
      notifications.info(
        'No PDFs to export',
        `An empty archive was written to ${chosen.filePath}.`,
      );
    } else {
      notifications.success(
        `Exported ${res.file_count} PDF${res.file_count === 1 ? '' : 's'}`,
        `${formatBytes(res.total_bytes)} saved to ${chosen.filePath}`,
      );
    }
    emit('exported', res.file_count);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notifications.error('Export failed', msg);
  } finally {
    isExporting.value = false;
  }
}

async function runImport(zipPath: string, onConflict: 'skip' | 'overwrite') {
  const projectId = projects.currentProjectId;
  if (!projectId) return;

  isImporting.value = true;
  try {
    const res = await backend.call<ImportResponse>('import_pdfs', {
      project_id: projectId,
      zip_path: zipPath,
      on_conflict: onConflict,
    });

    if (res.manifest_mismatch) {
      notifications.warning(
        'Zip is from a different project',
        `Manifest project_id was "${res.manifest_project_id}". PDFs were still imported.`,
      );
    }

    if (onConflict === 'skip' && res.conflicts.length > 0) {
      conflictPrompt.value = { zipPath, conflicts: res.conflicts };
      notifications.info(
        `${res.imported_count} imported, ${res.skipped_count} already existed`,
        'Review conflicts to overwrite.',
      );
    } else {
      const parts: string[] = [];
      if (res.imported_count) parts.push(`${res.imported_count} imported`);
      if (res.overwritten_count) parts.push(`${res.overwritten_count} overwritten`);
      if (res.skipped_count) parts.push(`${res.skipped_count} skipped`);
      notifications.success(
        'PDFs imported',
        parts.length ? parts.join(', ') : 'Nothing to do.',
      );
    }

    emit('imported', res.imported_count + res.overwritten_count);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notifications.error('Import failed', msg);
  } finally {
    isImporting.value = false;
  }
}

async function onImport() {
  if (!projects.currentProjectId) {
    notifications.error('No project selected', 'Open a project first.');
    return;
  }
  if (isImporting.value) return;

  const chosen = await window.fileOps.openDialog({
    title: 'Import PDFs from zip',
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  });
  if (!chosen.success || !chosen.filePath) return;

  await runImport(chosen.filePath, 'skip');
}

async function overwriteAll() {
  if (!conflictPrompt.value) return;
  const { zipPath } = conflictPrompt.value;
  conflictPrompt.value = null;
  await runImport(zipPath, 'overwrite');
}

function dismissConflicts() {
  conflictPrompt.value = null;
}
</script>

<template>
  <div class="inline-flex items-center gap-2">
    <Button
      v-if="actions !== 'import-only'"
      :variant="variant === 'compact' ? 'ghost' : 'outline'"
      :size="variant === 'compact' ? 'icon' : 'sm'"
      :disabled="isExporting || !projects.currentProjectId"
      :title="'Export PDFs as zip'"
      data-testid="pdf-share-export"
      @click="onExport"
    >
      <Loader2 v-if="isExporting" class="h-4 w-4 animate-spin" />
      <Download v-else class="h-4 w-4" />
      <span v-if="variant !== 'compact'">Export PDFs</span>
    </Button>

    <Button
      v-if="actions !== 'export-only'"
      :variant="variant === 'compact' ? 'ghost' : 'outline'"
      :size="variant === 'compact' ? 'icon' : 'sm'"
      :disabled="isImporting || !projects.currentProjectId"
      :title="'Import PDFs from zip'"
      data-testid="pdf-share-import"
      @click="onImport"
    >
      <Loader2 v-if="isImporting" class="h-4 w-4 animate-spin" />
      <Upload v-else class="h-4 w-4" />
      <span v-if="variant !== 'compact'">Import PDFs</span>
    </Button>

    <Dialog
      :open="conflictPrompt !== null"
      @update:open="(v) => { if (!v) dismissConflicts(); }"
    >
      <DialogContent class="sm:max-w-[520px]" data-testid="pdf-share-conflict-dialog">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <AlertTriangle class="h-5 w-5 text-amber-500" />
            {{ conflictPrompt?.conflicts.length ?? 0 }} PDF(s) already existed
          </DialogTitle>
          <DialogDescription>
            They were skipped to avoid overwriting work. Overwrite them with the versions from the zip?
          </DialogDescription>
        </DialogHeader>

        <div
          v-if="conflictPrompt"
          class="max-h-40 overflow-y-auto rounded border bg-muted/30 p-2 text-xs font-mono"
        >
          <div v-for="name in conflictPrompt.conflicts.slice(0, 50)" :key="name">
            {{ name }}
          </div>
          <div v-if="conflictPrompt.conflicts.length > 50" class="italic text-muted-foreground">
            …and {{ conflictPrompt.conflicts.length - 50 }} more
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isImporting" @click="dismissConflicts">
            Keep existing
          </Button>
          <Button
            variant="default"
            :disabled="isImporting"
            data-testid="pdf-share-overwrite-all"
            @click="overwriteAll"
          >
            <Loader2 v-if="isImporting" class="h-4 w-4 animate-spin" />
            Overwrite all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
