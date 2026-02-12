<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Loader2 } from 'lucide-vue-next';
import type { ScreenCriterionDefinition } from '@/types/api';

const props = defineProps<{
  open: boolean;
  criterionName: string;
  criterion: ScreenCriterionDefinition | null;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [data: {
    criterion_name: string;
    explanation?: string;
    comment?: string;
    criterion_type?: 'inclusion_criterion' | 'exclusion_criterion';
  }];
}>();

const explanation = ref('');
const comment = ref('');
const criterionType = ref<'inclusion_criterion' | 'exclusion_criterion'>('inclusion_criterion');

// Sync form when criterion changes
watch(
  () => props.criterion,
  (val) => {
    if (val) {
      explanation.value = val.explanation || '';
      comment.value = val.comment || '';
      criterionType.value = val.criterion_type || 'inclusion_criterion';
    }
  },
  { immediate: true },
);

const canSubmit = computed(() => explanation.value.trim());

function handleSubmit() {
  if (!canSubmit.value) return;
  emit('submit', {
    criterion_name: props.criterionName,
    explanation: explanation.value.trim(),
    comment: comment.value.trim() || undefined,
    criterion_type: criterionType.value,
  });
}

function handleOpenChange(value: boolean) {
  emit('update:open', value);
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Edit Criterion: {{ criterionName }}</DialogTitle>
        <DialogDescription>
          Update this screening criterion.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <div class="space-y-2">
          <label class="text-sm font-medium">Type</label>
          <NativeSelect
            v-model="criterionType"
            data-testid="edit-criterion-type-select"
          >
            <option value="inclusion_criterion">Inclusion criterion</option>
            <option value="exclusion_criterion">Exclusion criterion</option>
          </NativeSelect>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Explanation</label>
          <Textarea
            v-model="explanation"
            placeholder="Describe what this criterion evaluates..."
            rows="3"
            data-testid="edit-criterion-explanation-input"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Comment (optional)</label>
          <Input
            v-model="comment"
            placeholder="Additional notes..."
            data-testid="edit-criterion-comment-input"
          />
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          data-testid="edit-criterion-cancel-btn"
          @click="handleOpenChange(false)"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSubmit || isSaving"
          data-testid="edit-criterion-submit-btn"
          @click="handleSubmit"
        >
          <Loader2 v-if="isSaving" class="h-4 w-4 mr-1.5 animate-spin" />
          Save Changes
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
