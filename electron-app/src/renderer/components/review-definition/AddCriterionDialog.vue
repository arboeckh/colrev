<script setup lang="ts">
import { ref, computed } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Loader2 } from 'lucide-vue-next';

const props = defineProps<{
  open: boolean;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [data: {
    name: string;
    explanation: string;
    comment?: string;
    criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
  }];
}>();

const name = ref('');
const explanation = ref('');
const comment = ref('');
const criterionType = ref<'inclusion_criterion' | 'exclusion_criterion'>('inclusion_criterion');

const canSubmit = computed(() => name.value.trim() && explanation.value.trim());

function handleSubmit() {
  if (!canSubmit.value) return;
  emit('submit', {
    name: name.value.trim(),
    explanation: explanation.value.trim(),
    comment: comment.value.trim() || undefined,
    criterion_type: criterionType.value,
  });
  resetForm();
}

function resetForm() {
  name.value = '';
  explanation.value = '';
  comment.value = '';
  criterionType.value = 'inclusion_criterion';
}

function handleOpenChange(value: boolean) {
  if (!value) resetForm();
  emit('update:open', value);
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Add Screening Criterion</DialogTitle>
        <DialogDescription>
          Define a criterion for full-text screening decisions.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <div class="space-y-2">
          <label class="text-sm font-medium">Name</label>
          <Input
            v-model="name"
            placeholder="e.g., population_relevant"
            data-testid="criterion-name-input"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Type</label>
          <NativeSelect
            v-model="criterionType"
            data-testid="criterion-type-select"
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
            data-testid="criterion-explanation-input"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Comment (optional)</label>
          <Input
            v-model="comment"
            placeholder="Additional notes..."
            data-testid="criterion-comment-input"
          />
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          data-testid="criterion-cancel-btn"
          @click="handleOpenChange(false)"
        >
          Cancel
        </Button>
        <Button
          :disabled="!canSubmit || isSaving"
          data-testid="criterion-submit-btn"
          @click="handleSubmit"
        >
          <Loader2 v-if="isSaving" class="h-4 w-4 mr-1.5 animate-spin" />
          Add Criterion
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
