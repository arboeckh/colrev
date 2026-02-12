<script setup lang="ts">
import { computed } from 'vue';
import { FileText } from 'lucide-vue-next';
import { useProjectsStore } from '@/stores/projects';

const props = defineProps<{
  pdfPath?: string;
}>();

const projects = useProjectsStore();

const pdfUrl = computed(() => {
  if (!props.pdfPath || !projects.currentProjectId) return null;
  return `colrev-pdf://pdf/${encodeURIComponent(projects.currentProjectId)}/${props.pdfPath}`;
});
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
      <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <FileText class="h-12 w-12 mb-3 opacity-30" />
        <p class="text-sm">No PDF available</p>
      </div>
    </template>
  </div>
</template>
