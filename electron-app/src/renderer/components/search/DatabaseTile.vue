<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Database } from 'lucide-vue-next';
import type { DbConnector } from './db-catalog';

const props = defineProps<{
  connector: DbConnector;
  disabled?: boolean;
  added?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', connector: DbConnector): void;
}>();

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

const tileClass = computed(() => {
  if (props.disabled) return 'opacity-45 cursor-not-allowed';
  return 'hover:opacity-80 cursor-pointer';
});

function handleClick() {
  if (props.disabled) return;
  emit('select', props.connector);
}
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :data-testid="`db-tile-${connector.id}`"
    :class="[
      'flex flex-col items-center gap-2 rounded-md p-2 text-center transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      tileClass,
    ]"
    @click="handleClick"
  >
    <div class="flex h-16 w-16 items-center justify-center">
      <img
        v-if="showImage"
        :src="logoUrl!"
        :alt="connector.name"
        class="max-h-16 max-w-full object-contain"
        draggable="false"
        @error="imageBroken = true"
      />
      <Database v-else class="h-10 w-10 text-muted-foreground" />
    </div>

    <div class="flex items-center gap-1">
      <span class="text-[12.5px] font-medium leading-tight text-foreground/90 line-clamp-1">
        {{ connector.name }}
      </span>
      <Check
        v-if="added"
        class="h-3 w-3 text-muted-foreground"
      />
    </div>
  </button>
</template>
