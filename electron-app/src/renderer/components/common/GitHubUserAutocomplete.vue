<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { Loader2, User } from 'lucide-vue-next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { GitHubCollaborator } from '@/types/window';

const props = defineProps<{
  modelValue: string;
  remoteUrl: string;
  excludeLogins?: string[];
  disabled?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
}>();

const open = ref(false);
const suggestions = ref<GitHubCollaborator[]>([]);
const isLoading = ref(false);
const activeIndex = ref(-1);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let requestId = 0;

async function loadSuggestions(query: string) {
  if (!props.remoteUrl || props.disabled) {
    suggestions.value = [];
    return;
  }

  const currentRequest = ++requestId;
  isLoading.value = true;
  try {
    const result = await window.github.inviteUserSuggestions({
      remoteUrl: props.remoteUrl,
      query,
      excludeLogins: props.excludeLogins ?? [],
    });
    if (currentRequest !== requestId) return;
    suggestions.value = result.success ? result.suggestions : [];
    activeIndex.value = suggestions.value.length > 0 ? 0 : -1;
  } finally {
    if (currentRequest === requestId) {
      isLoading.value = false;
    }
  }
}

function scheduleLoad(query: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void loadSuggestions(query);
  }, 350);
}

function onInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit('update:modelValue', value);
  open.value = true;
  scheduleLoad(value);
}

function onFocus() {
  if (props.disabled) return;
  open.value = true;
  if (suggestions.value.length === 0) {
    void loadSuggestions(props.modelValue);
  }
}

function onBlur() {
  window.setTimeout(() => {
    open.value = false;
    activeIndex.value = -1;
  }, 150);
}

function selectSuggestion(collaborator: GitHubCollaborator) {
  emit('update:modelValue', collaborator.login);
  open.value = false;
  activeIndex.value = -1;
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value && event.key !== 'Enter') return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!open.value) {
      open.value = true;
      if (suggestions.value.length === 0) void loadSuggestions(props.modelValue);
      return;
    }
    if (suggestions.value.length === 0) return;
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length;
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (suggestions.value.length === 0) return;
    activeIndex.value =
      activeIndex.value <= 0 ? suggestions.value.length - 1 : activeIndex.value - 1;
    return;
  }

  if (event.key === 'Escape') {
    open.value = false;
    activeIndex.value = -1;
    return;
  }

  if (event.key === 'Enter') {
    if (open.value && activeIndex.value >= 0 && suggestions.value[activeIndex.value]) {
      event.preventDefault();
      selectSuggestion(suggestions.value[activeIndex.value]);
      return;
    }
    emit('submit');
  }
}

watch(
  () => [props.remoteUrl, props.excludeLogins?.join(',')],
  () => {
    if (open.value) {
      scheduleLoad(props.modelValue);
    } else {
      suggestions.value = [];
    }
  },
);

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});
</script>

<template>
  <div class="relative flex-1 min-w-0">
    <input
      :value="modelValue"
      class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      :placeholder="placeholder || 'GitHub username...'"
      :disabled="disabled"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    >

    <div
      v-if="open && (isLoading || suggestions.length > 0)"
      class="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
    >
      <div
        v-if="isLoading"
        class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        Searching...
      </div>

      <div v-else class="max-h-[220px] overflow-y-auto py-1">
        <button
          v-for="(collaborator, index) in suggestions"
          :key="collaborator.login"
          type="button"
          class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors cursor-pointer"
          :class="index === activeIndex ? 'bg-accent' : 'hover:bg-accent'"
          :data-testid="`invite-suggestion-${collaborator.login}`"
          @mousedown.prevent="selectSuggestion(collaborator)"
        >
          <Avatar class="h-6 w-6 shrink-0">
            <AvatarImage :src="collaborator.avatarUrl" />
            <AvatarFallback class="text-[9px]">
              <User class="h-3 w-3" />
            </AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">
              {{ collaborator.name || collaborator.login }}
            </div>
            <div
              v-if="collaborator.name"
              class="truncate text-xs text-muted-foreground"
            >
              @{{ collaborator.login }}
            </div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
