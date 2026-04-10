<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  percentage: number;
  size?: number;
  strokeWidth?: number;
}>(), {
  size: 32,
  strokeWidth: 3,
});

const radius = computed(() => (props.size - props.strokeWidth * 2) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dashOffset = computed(() => {
  const clamped = Math.min(100, Math.max(0, props.percentage));
  return circumference.value * (1 - clamped / 100);
});
const center = computed(() => props.size / 2);
const fontSize = computed(() => Math.max(7, Math.round(props.size * 0.28)));
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    class="shrink-0"
    role="progressbar"
    :aria-valuenow="percentage"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <!-- Track -->
    <circle
      :cx="center"
      :cy="center"
      :r="radius"
      fill="none"
      stroke="currentColor"
      class="opacity-20"
      :stroke-width="strokeWidth"
    />
    <!-- Progress arc -->
    <circle
      :cx="center"
      :cy="center"
      :r="radius"
      fill="none"
      stroke="currentColor"
      class="transition-all duration-300"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="dashOffset"
      :transform="`rotate(-90, ${center}, ${center})`"
    />
    <!-- Percentage label -->
    <text
      :x="center"
      :y="center"
      dominant-baseline="central"
      text-anchor="middle"
      :font-size="fontSize"
      fill="currentColor"
    >{{ Math.round(percentage) }}</text>
  </svg>
</template>
