<script setup lang="ts">
import { Check, X, Pencil, CircleCheck } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

defineProps<{
  includedCount: number;
  excludedCount: number;
}>();

const emit = defineEmits<{
  editDecisions: [];
}>();
</script>

<template>
  <div
    class="flex-1 flex flex-col items-center justify-center text-center"
    data-testid="screen-complete"
  >
    <div class="rounded-full bg-green-600/15 p-4 mb-4">
      <CircleCheck class="h-8 w-8 text-green-500" />
    </div>
    <h3 class="text-lg font-medium mb-1">Screening complete</h3>
    <p class="text-sm text-muted-foreground mb-6">
      All records have been reviewed.
    </p>

    <div class="flex items-center gap-6">
      <div class="flex flex-col items-center gap-1">
        <span
          class="text-2xl font-semibold text-green-500"
          data-testid="screen-complete-included"
        >
          {{ includedCount }}
        </span>
        <span class="text-xs text-muted-foreground flex items-center gap-1">
          <Check class="h-3 w-3" /> Included
        </span>
      </div>
      <Separator orientation="vertical" class="h-10" />
      <div class="flex flex-col items-center gap-1">
        <span
          class="text-2xl font-semibold text-red-400"
          data-testid="screen-complete-excluded"
        >
          {{ excludedCount }}
        </span>
        <span class="text-xs text-muted-foreground flex items-center gap-1">
          <X class="h-3 w-3" /> Excluded
        </span>
      </div>
      <Separator orientation="vertical" class="h-10" />
      <div class="flex flex-col items-center gap-1">
        <span class="text-2xl font-semibold" data-testid="screen-complete-total">
          {{ includedCount + excludedCount }}
        </span>
        <span class="text-xs text-muted-foreground">Total reviewed</span>
      </div>
    </div>

    <Button
      variant="outline"
      size="sm"
      class="mt-6"
      data-testid="screen-edit-decisions-btn"
      @click="emit('editDecisions')"
    >
      <Pencil class="h-4 w-4 mr-1.5" />
      Edit Decisions
    </Button>
  </div>
</template>
