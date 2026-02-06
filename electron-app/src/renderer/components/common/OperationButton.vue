<script setup lang="ts">
import { ref } from 'vue';
import { Play, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useBackendStore } from '@/stores/backend';
import { useNotificationsStore } from '@/stores/notifications';

const props = defineProps<{
  operation: string;
  projectId: string;
  label?: string;
  disabled?: boolean;
  params?: Record<string, unknown>;
  testId?: string;
}>();

const emit = defineEmits<{
  success: [result: unknown];
  error: [error: Error];
}>();

const backend = useBackendStore();
const notifications = useNotificationsStore();
const isRunning = ref(false);

async function run() {
  if (isRunning.value || props.disabled || !backend.isRunning) return;

  isRunning.value = true;

  try {
    const result = await backend.call(props.operation, {
      project_id: props.projectId,
      ...props.params,
    });

    notifications.success(`${props.label || props.operation} completed`);
    emit('success', result);
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    notifications.error(`${props.label || props.operation} failed`, error.message);
    emit('error', error);
  } finally {
    isRunning.value = false;
  }
}
</script>

<template>
  <Button
    :disabled="disabled || isRunning || !backend.isRunning"
    :data-testid="testId || `run-${operation}-button`"
    @click="run"
  >
    <Loader2 v-if="isRunning" class="h-4 w-4 mr-2 animate-spin" />
    <Play v-else class="h-4 w-4 mr-2" />
    {{ label || operation }}
  </Button>
</template>
