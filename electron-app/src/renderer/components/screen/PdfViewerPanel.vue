<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FileText } from 'lucide-vue-next';
import { useProjectsStore } from '@/stores/projects';
import PdfShareActions from '@/components/shared/PdfShareActions.vue';

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

async function checkExistence() {
  if (!props.pdfPath || !projects.currentProjectId) {
    fileExists.value = null;
    return;
  }
  try {
    const res = await window.pdfFiles.exists({
      projectId: projects.currentProjectId,
      relativePath: props.pdfPath,
    });
    fileExists.value = res.exists;
  } catch {
    // If the IPC fails for any reason, fall back to letting the iframe try.
    fileExists.value = true;
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
  return `colrev-pdf://pdf/${encodeURIComponent(projects.currentProjectId)}/${props.pdfPath}${suffix}`;
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
