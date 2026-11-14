<script setup lang="ts">
// Prescreen and Screen are two routes on one component (ManagedReviewWorkflowPage).
// Without a key Vue reuses that instance when the user moves between them, and
// the other step's phase, task lists and open walkthrough carry over. Keyed by
// the managed-review kind so switching steps remounts the page. Every other
// route has no kind, so nothing else changes: different components remount
// anyway, and one component across params keeps its instance.
</script>

<template>
  <router-view v-slot="{ Component, route: viewRoute }">
    <component :is="Component" :key="viewRoute.meta.managedReviewKind" />
  </router-view>
</template>
