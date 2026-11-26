<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FileText } from 'lucide-vue-next';
import { useProjectsStore } from '@/stores/projects';
import PdfShareActions from '@/components/shared/PdfShareActions.vue';
import { pdfFileUrl } from '@/lib/web-bridge';

const props = withDefaults(
  defineProps<{
    pdfPath?: string;
    showImportHint?: boolean;
  }>(),
  {
    showImportHint: true,
  },
);

const projects = useProjectsStore();

const emit = defineEmits<{
  imported: [count: number];
}>();

// Bumped when a successful import happens so the existence check re-runs
// and (if the file is now present) the iframe remounts with the new file.
const reloadKey = ref(0);
const fileExists = ref<boolean | null>(null);

// Guards against an older check resolving after a newer one has started.
let checkToken = 0;

async function checkExistence() {
  const token = ++checkToken;
  // Drop the previous record's answer right away: the panel is reused across
  // records, and a stale `false` would show "No PDF available" until the
  // async check for the new path returns.
  fileExists.value = null;
  if (!props.pdfPath || !projects.currentProjectId) return;
  try {
    const res = await window.pdfFiles.exists({
      projectId: projects.currentProjectId,
      relativePath: props.pdfPath,
    });
    if (token === checkToken) fileExists.value = res.exists;
  } catch {
    // If the IPC fails for any reason, fall back to letting the iframe try.
    if (token === checkToken) fileExists.value = true;
  }
}

watch(
  () => [props.pdfPath, projects.currentProjectId, reloadKey.value],
  () => {
    void checkExistence();
  },
  { immediate: true },
);

const pdfUrl = computed(() => {
  if (!props.pdfPath || !projects.currentProjectId) return null;
  if (fileExists.value === false) return null;
  // Cache-bust the iframe src when reloadKey changes so an import takes effect.
  const suffix = reloadKey.value ? `?v=${reloadKey.value}` : '';
  return pdfFileUrl(projects.currentProjectId, props.pdfPath, suffix);
});

function onImported(count: number) {
  reloadKey.value += 1;
  emit('imported', count);
}
</script>

<template>
  <div class="h-full flex flex-col bg-muted/30 rounded-lg overflow-hidden" data-testid="pdf-viewer-panel">
    <template v-if="pdfUrl">
      <iframe
        :src="pdfUrl"
        class="flex-1 w-full border-0"
        data-testid="pdf-iframe"
      />
    </template>
    <template v-else>
      <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 px-6 text-center">
        <FileText class="h-12 w-12 opacity-30" />
        <p class="text-sm">No PDF available</p>
        <template v-if="showImportHint">
          <p class="text-xs text-muted-foreground/70 max-w-xs">
            If a teammate shared PDFs as a zip, import them to make this file available.
          </p>
          <PdfShareActions
            variant="default"
            actions="import-only"
            @imported="onImported"
          />
        </template>
      </div>
    </template>
  </div>
</template>
