<script setup lang="ts">
import { Pencil, Trash2 } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ScreenCriterionDefinition } from '@/types/api';

defineProps<{
  criteria: Record<string, ScreenCriterionDefinition>;
}>();

const emit = defineEmits<{
  edit: [name: string, criterion: ScreenCriterionDefinition];
  remove: [name: string];
}>();
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(criterion, name) in criteria"
      :key="name"
      class="flex items-start justify-between gap-3 p-3 bg-muted rounded-lg"
      :data-testid="`criterion-item-${name}`"
    >
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-medium text-sm">{{ name }}</span>
          <Badge
            :variant="criterion.criterion_type === 'inclusion_criterion' ? 'default' : 'destructive'"
            class="text-xs"
            :class="criterion.criterion_type === 'inclusion_criterion' ? 'bg-green-600 hover:bg-green-700' : ''"
          >
            {{ criterion.criterion_type === 'inclusion_criterion' ? 'Inclusion' : 'Exclusion' }}
          </Badge>
        </div>
        <p class="text-sm text-muted-foreground">{{ criterion.explanation }}</p>
        <p v-if="criterion.comment" class="text-xs text-muted-foreground/70 mt-1">
          {{ criterion.comment }}
        </p>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          :data-testid="`criterion-edit-${name}`"
          @click="emit('edit', name as string, criterion)"
        >
          <Pencil class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-destructive hover:text-destructive"
          :data-testid="`criterion-remove-${name}`"
          @click="emit('remove', name as string)"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <div
      v-if="Object.keys(criteria).length === 0"
      class="text-sm text-muted-foreground text-center py-4"
    >
      No screening criteria defined yet.
    </div>
  </div>
</template>
