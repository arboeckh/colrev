<script setup lang="ts">
import { SheetTitle, SheetDescription } from '@/components/ui/sheet';

defineProps<{
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <div class="flex flex-col h-full bg-background">
    <header class="px-8 pt-10 pb-7 border-b">
      <SheetTitle
        class="font-display text-[26px] font-normal leading-tight text-ink-900 tracking-tight"
      >
        {{ title }}
      </SheetTitle>
      <SheetDescription class="mt-2 text-[13.5px] text-ink-500 leading-relaxed">
        {{ subtitle }}
      </SheetDescription>
    </header>

    <div class="flex-1 px-8 py-8">
      <slot />
    </div>
  </div>
</template>
