<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <h3
    data-slot="card-title"
    :class="cn('font-display text-[19px] font-normal leading-tight tracking-[-0.015em] text-ink-900', props.class)"
  >
    <slot />
  </h3>
</template>
