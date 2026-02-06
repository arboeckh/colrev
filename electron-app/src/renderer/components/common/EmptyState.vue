<script setup lang="ts">
import { computed } from 'vue';
import type { Component } from 'vue';
import { FileQuestion } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    icon?: Component;
    title: string;
    description?: string;
  }>(),
  {
    icon: () => FileQuestion,
  }
);
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 text-center">
    <div class="rounded-full bg-muted p-4 mb-4">
      <component :is="icon" class="h-8 w-8 text-muted-foreground" />
    </div>
    <h3 class="text-lg font-medium mb-1">{{ title }}</h3>
    <p v-if="description" class="text-sm text-muted-foreground max-w-sm">
      {{ description }}
    </p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
