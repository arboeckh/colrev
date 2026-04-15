<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Database } from 'lucide-vue-next';
import type { DbConnector } from './db-catalog';

const props = withDefaults(
  defineProps<{
    connector: DbConnector;
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' },
);

const LOGO_URLS = import.meta.glob('../../assets/db-logos/*.{svg,png,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const logoUrl = computed<string | null>(() => {
  const match = Object.entries(LOGO_URLS).find(([path]) => {
    const file = path.split('/').pop() ?? '';
    const name = file.replace(/\.(svg|png|jpe?g)$/i, '');
    return name === props.connector.id;
  });
  return match ? match[1] : null;
});

const imageBroken = ref(false);
watch(logoUrl, () => {
  imageBroken.value = false;
});
const showImage = computed(() => !!logoUrl.value && !imageBroken.value);

const sizeClass = computed(() =>
  props.size === 'md' ? 'h-10 w-10' : 'h-9 w-9',
);
</script>

<template>
  <div
    :class="[
      'flex items-center justify-center shrink-0 rounded-md overflow-hidden border border-border bg-background',
      sizeClass,
    ]"
  >
    <img
      v-if="showImage"
      :src="logoUrl!"
      :alt="connector.name"
      class="h-full w-full object-contain p-1.5"
      draggable="false"
      @error="imageBroken = true"
    />
    <Database v-else class="h-4 w-4 text-muted-foreground" />
  </div>
</template>
