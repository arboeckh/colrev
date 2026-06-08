<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{
  icon: Component;
  title: string;
}>();
</script>

<template>
  <section class="flex gap-4">
    <div class="shrink-0 mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-cream-50">
      <component :is="icon" class="h-[18px] w-[18px] text-eucalyptus-700" :stroke-width="1.5" />
    </div>
    <div class="flex-1 min-w-0 space-y-1.5">
      <h3 class="text-[14px] font-medium text-ink-900 leading-tight">{{ title }}</h3>
      <div class="text-[13.5px] text-ink-500 leading-[1.65]">
        <slot />
      </div>
    </div>
  </section>
</template>
