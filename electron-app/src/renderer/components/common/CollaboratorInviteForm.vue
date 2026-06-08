<script setup lang="ts">
import { UserPlus } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import GitHubUserAutocomplete from './GitHubUserAutocomplete.vue';

defineProps<{
  modelValue: string;
  remoteUrl: string;
  excludeLogins?: string[];
  disabled?: boolean;
  isInviting?: boolean;
  sendLabel?: string;
  placeholder?: string;
  class?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
  cancel: [];
}>();
</script>

<template>
  <div
    class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
    :class="$props.class"
  >
    <UserPlus class="h-4 w-4 text-muted-foreground shrink-0" />
    <GitHubUserAutocomplete
      :model-value="modelValue"
      :remote-url="remoteUrl"
      :exclude-logins="excludeLogins"
      :disabled="disabled"
      :placeholder="placeholder"
      @update:model-value="emit('update:modelValue', $event)"
      @submit="emit('submit')"
    />
    <Button
      size="sm"
      class="h-6 text-xs px-2"
      :disabled="!modelValue || isInviting || disabled"
      :title="disabled ? 'Requires internet' : undefined"
      @click="emit('submit')"
    >
      {{ isInviting ? 'Sending...' : (sendLabel || 'Send Invite') }}
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 text-xs px-2"
      @click="emit('cancel')"
    >
      Cancel
    </Button>
  </div>
</template>
