<script setup lang="ts">
import { onMounted, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Toaster } from '@/components/ui/sonner';
import AppLayout from '@/components/layout/AppLayout.vue';
import DebugPanel from '@/components/common/DebugPanel.vue';
import { useBackendStore } from '@/stores/backend';

const route = useRoute();
const backend = useBackendStore();

// Determine which layout to use based on route meta
const useProjectLayout = computed(() => {
  return route.meta.layout === 'project' || route.matched.some((r) => r.meta.layout === 'project');
});

// Auto-start backend on mount
onMounted(async () => {
  if (backend.canStart) {
    await backend.start();
  }
});

// Watch for backend errors
watch(
  () => backend.error,
  (error) => {
    if (error) {
      console.error('Backend error:', error);
    }
  }
);
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Toast notifications -->
    <Toaster position="top-right" :expand="true" rich-colors />

    <!-- Debug panel (floating button in bottom right) -->
    <DebugPanel />

    <!-- Main content with conditional layout -->
    <AppLayout v-if="useProjectLayout">
      <router-view />
    </AppLayout>

    <router-view v-else />
  </div>
</template>
