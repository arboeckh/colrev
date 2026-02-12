<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Trash2 } from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import type { ScreenCriterionDefinition } from '@/types/api';

interface Props {
  criterion?: {
    name: string;
    explanation: string;
    comment?: string;
    criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
  };
  mode: 'add' | 'edit' | 'view';
  isSaving?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  save: [criterion: {
    name?: string;
    explanation: string;
    comment?: string;
    criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
  }];
  cancel: [];
  delete: [];
}>();

const isEditing = ref(props.mode !== 'view');
const formData = ref({
  name: props.criterion?.name || '',
  explanation: props.criterion?.explanation || '',
  comment: props.criterion?.comment || '',
  criterion_type: props.criterion?.criterion_type || 'inclusion_criterion' as 'inclusion_criterion' | 'exclusion_criterion',
});

// Reset form data when criterion prop changes
watch(() => props.criterion, (newCriterion) => {
  if (newCriterion && props.mode !== 'add') {
    formData.value = {
      name: newCriterion.name,
      explanation: newCriterion.explanation,
      comment: newCriterion.comment || '',
      criterion_type: newCriterion.criterion_type,
    };
  }
}, { immediate: true });

const isFormValid = computed(() => {
  if (props.mode === 'add') {
    return formData.value.name.trim() && formData.value.explanation.trim();
  }
  return formData.value.explanation.trim();
});

function toggleEdit() {
  if (props.mode === 'view') {
    isEditing.value = !isEditing.value;
  }
}

function save() {
  if (!isFormValid.value) return;

  const data: any = {
    explanation: formData.value.explanation.trim(),
    comment: formData.value.comment.trim() || undefined,
    criterion_type: formData.value.criterion_type,
  };

  if (props.mode === 'add') {
    data.name = formData.value.name.trim();
  }

  emit('save', data);

  if (props.mode === 'view') {
    isEditing.value = false;
  }
}

function cancel() {
  if (props.mode === 'view' && props.criterion) {
    // Reset to original values
    formData.value = {
      name: props.criterion.name,
      explanation: props.criterion.explanation,
      comment: props.criterion.comment || '',
      criterion_type: props.criterion.criterion_type,
    };
    isEditing.value = false;
  } else {
    // Reset form for add mode
    formData.value = {
      name: '',
      explanation: '',
      comment: '',
      criterion_type: 'inclusion_criterion',
    };
    emit('cancel');
  }
}
</script>

<template>
  <!-- View Mode (collapsed) -->
  <div
    v-if="!isEditing && mode !== 'add'"
    class="p-4 bg-muted/50 rounded-lg hover:bg-muted cursor-pointer transition-all duration-200"
    :data-testid="`criterion-view-${criterion?.name}`"
    @click="toggleEdit"
  >
    <div class="flex items-start justify-between">
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-2">
          <span class="font-medium">{{ criterion?.name }}</span>
          <Badge
            :variant="criterion?.criterion_type === 'inclusion_criterion' ? 'default' : 'secondary'"
            class="text-xs"
            :class="criterion?.criterion_type === 'inclusion_criterion' ? 'bg-green-600 hover:bg-green-700' : ''"
          >
            {{ criterion?.criterion_type === 'inclusion_criterion' ? 'Inclusion' : 'Exclusion' }}
          </Badge>
        </div>
        <p class="text-sm text-muted-foreground">{{ criterion?.explanation }}</p>
        <p v-if="criterion?.comment" class="text-xs text-muted-foreground mt-1">
          {{ criterion?.comment }}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="text-destructive hover:text-destructive"
        :data-testid="`criterion-delete-${criterion?.name}`"
        @click.stop="emit('delete')"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>
  </div>

  <!-- Edit Mode (expanded) -->
  <div
    v-else
    class="p-4 border-2 border-primary rounded-lg space-y-4 transition-all duration-200"
    :data-testid="mode === 'add' ? 'criterion-add-form' : `criterion-edit-${criterion?.name}`"
  >
    <div class="space-y-4">
      <div v-if="mode === 'add'">
        <label class="text-sm font-medium">Criterion Name</label>
        <Input
          v-model="formData.name"
          placeholder="e.g., peer_reviewed"
          data-testid="criterion-name-input"
          class="mt-1.5"
        />
      </div>

      <div>
        <label class="text-sm font-medium">Type</label>
        <NativeSelect
          v-model="formData.criterion_type"
          data-testid="criterion-type-select"
          class="mt-1.5"
        >
          <option value="inclusion_criterion">Inclusion Criterion</option>
          <option value="exclusion_criterion">Exclusion Criterion</option>
        </NativeSelect>
      </div>

      <div>
        <label class="text-sm font-medium">Explanation</label>
        <Textarea
          v-model="formData.explanation"
          placeholder="Explain how this criterion should be applied..."
          rows="3"
          data-testid="criterion-explanation-input"
          class="mt-1.5"
        />
      </div>

      <div>
        <label class="text-sm font-medium">Comment (optional)</label>
        <Input
          v-model="formData.comment"
          placeholder="Additional notes..."
          data-testid="criterion-comment-input"
          class="mt-1.5"
        />
      </div>
    </div>

    <div class="flex gap-2">
      <Button
        :disabled="!isFormValid || isSaving"
        data-testid="criterion-save-btn"
        @click="save"
      >
        {{ mode === 'add' ? 'Add Criterion' : 'Save Changes' }}
      </Button>
      <Button
        variant="outline"
        data-testid="criterion-cancel-btn"
        @click="cancel"
      >
        Cancel
      </Button>
    </div>
  </div>
</template>
