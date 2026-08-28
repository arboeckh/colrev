<script setup lang="ts">
import { AlertCircle, RefreshCw } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

withDefaults(defineProps<{
  title?: string;
  message?: string | null;
  testId?: string;
}>(), {
  title: 'Failed to load data',
  message: null,
  testId: 'load-error-state',
});

const emit = defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div
    class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8"
    :data-testid="testId"
  >
    <AlertCircle class="h-10 w-10 text-destructive" />
    <div>
      <h3 class="text-lg font-medium">{{ title }}</h3>
      <p v-if="message" class="text-sm text-muted-foreground mt-1">{{ message }}</p>
    </div>
    <Button variant="outline" :data-testid="`${testId}-retry`" @click="emit('retry')">
      <RefreshCw class="h-4 w-4 mr-2" />
      Retry
    </Button>
  </div>
</template>
