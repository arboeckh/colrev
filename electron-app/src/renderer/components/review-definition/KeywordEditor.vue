<script setup lang="ts">
import { ref } from 'vue';
import { X, Plus } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const props = defineProps<{
  keywords: string[];
}>();

const emit = defineEmits<{
  update: [keywords: string[]];
}>();

const newKeyword = ref('');

function addKeyword() {
  const kw = newKeyword.value.trim();
  if (!kw || props.keywords.includes(kw)) return;
  emit('update', [...props.keywords, kw]);
  newKeyword.value = '';
}

function removeKeyword(index: number) {
  const updated = [...props.keywords];
  updated.splice(index, 1);
  emit('update', updated);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addKeyword();
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <Badge
        v-for="(keyword, index) in keywords"
        :key="keyword"
        variant="secondary"
        class="pl-2.5 pr-1.5 py-1 gap-1"
        :data-testid="`keyword-badge-${index}`"
      >
        {{ keyword }}
        <button
          class="ml-1 rounded-full hover:bg-foreground/10 p-0.5"
          :data-testid="`keyword-remove-${index}`"
          @click="removeKeyword(index)"
        >
          <X class="h-3 w-3" />
        </button>
      </Badge>
      <span
        v-if="keywords.length === 0"
        class="text-sm text-muted-foreground"
      >
        No keywords defined
      </span>
    </div>

    <div class="flex gap-2">
      <Input
        v-model="newKeyword"
        placeholder="Add keyword..."
        class="flex-1"
        data-testid="keyword-input"
        @keydown="handleKeydown"
      />
      <Button
        variant="outline"
        size="sm"
        :disabled="!newKeyword.trim()"
        data-testid="keyword-add-btn"
        @click="addKeyword"
      >
        <Plus class="h-4 w-4 mr-1" />
        Add
      </Button>
    </div>
  </div>
</template>
