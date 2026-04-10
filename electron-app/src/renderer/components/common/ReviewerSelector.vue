<script setup lang="ts">
import { ref, computed } from 'vue';
import { ChevronsUpDown, Check, User } from 'lucide-vue-next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { GitHubCollaborator } from '@/types/window';

const props = defineProps<{
  collaborators: GitHubCollaborator[];
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
  excludeLogin?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const open = ref(false);
const search = ref('');

const selectedCollaborator = computed(() =>
  props.collaborators.find((c) => c.login === props.modelValue) ?? null,
);

const filteredCollaborators = computed(() => {
  let list = props.collaborators;
  if (props.excludeLogin) {
    list = list.filter((c) => c.login !== props.excludeLogin);
  }
  if (!search.value) return list;
  const q = search.value.toLowerCase();
  return list.filter(
    (c) =>
      c.login.toLowerCase().includes(q) ||
      (c.name && c.name.toLowerCase().includes(q)),
  );
});

function select(login: string) {
  emit('update:modelValue', login);
  open.value = false;
  search.value = '';
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        role="combobox"
        :aria-expanded="open"
        :disabled="disabled"
        class="w-full justify-between font-normal h-9"
      >
        <div class="flex items-center gap-2 min-w-0">
          <template v-if="selectedCollaborator">
            <Avatar class="h-5 w-5 shrink-0">
              <AvatarImage :src="selectedCollaborator.avatarUrl" />
              <AvatarFallback class="text-[9px]">
                <User class="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
            <span class="truncate text-sm">{{ selectedCollaborator.name || selectedCollaborator.login }}</span>
          </template>
          <span v-else class="text-muted-foreground text-sm">{{ placeholder || 'Select reviewer...' }}</span>
        </div>
        <ChevronsUpDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      </Button>
    </PopoverTrigger>

    <PopoverContent class="w-[--reka-popover-trigger-width] p-0" align="start">
      <!-- Search input -->
      <div class="border-b border-border px-3 py-2">
        <input
          v-model="search"
          class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          placeholder="Search collaborators..."
          @keydown.stop
        >
      </div>

      <!-- List -->
      <div class="max-h-[200px] overflow-y-auto py-1">
        <div
          v-if="filteredCollaborators.length === 0"
          class="px-3 py-4 text-center text-xs text-muted-foreground"
        >
          No collaborators found
        </div>

        <button
          v-for="collaborator in filteredCollaborators"
          :key="collaborator.login"
          class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors cursor-pointer"
          @click="select(collaborator.login)"
        >
          <Avatar class="h-6 w-6 shrink-0">
            <AvatarImage :src="collaborator.avatarUrl" />
            <AvatarFallback class="text-[9px]">
              <User class="h-3 w-3" />
            </AvatarFallback>
          </Avatar>
          <div class="flex-1 min-w-0">
            <div class="truncate text-sm">{{ collaborator.name || collaborator.login }}</div>
            <div v-if="collaborator.name" class="truncate text-xs text-muted-foreground">@{{ collaborator.login }}</div>
          </div>
          <Check
            v-if="collaborator.login === modelValue"
            class="h-3.5 w-3.5 shrink-0 text-primary"
          />
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
