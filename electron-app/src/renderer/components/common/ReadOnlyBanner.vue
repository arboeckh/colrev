<script setup lang="ts">
import { Lock, ArrowRightLeft } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/composables/useReadOnly';

const { isReadOnly, switchToDev } = useReadOnly();
</script>

<template>
  <div
    v-if="isReadOnly"
    class="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-2"
    data-testid="read-only-banner"
  >
    <Lock class="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
    <span class="text-sm text-amber-600 dark:text-amber-400">
      You are viewing the main branch (read-only). Switch to dev to make changes.
    </span>
    <Button
      variant="outline"
      size="sm"
      class="ml-auto h-7 text-xs"
      data-testid="switch-to-dev-button"
      @click="switchToDev"
    >
      <ArrowRightLeft class="h-3 w-3 mr-1" />
      Switch to dev
    </Button>
  </div>
</template>
