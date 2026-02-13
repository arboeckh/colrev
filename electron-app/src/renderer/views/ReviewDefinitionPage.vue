<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, Check } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { CriteriaList, KeywordEditor } from '@/components/review-definition';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';

const router = useRouter();
const store = useReviewDefinitionStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();
const { isReadOnly } = useReadOnly();

// Local form state
const protocolUrl = ref('');
const objectives = ref('');

// Auto-save state
const protocolSaveTimer = ref<number | null>(null);
const objectivesSaveTimer = ref<number | null>(null);
const protocolSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle');
const objectivesSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle');

// Quick stats
const criteriaCount = computed(() => {
  return Object.keys(store.definition?.criteria || {}).length;
});

onMounted(async () => {
  await store.loadDefinition();
  if (store.definition) {
    protocolUrl.value = store.definition.protocol_url;
    objectives.value = store.definition.objectives;
  }
});

// Auto-save for Protocol URL
watch(protocolUrl, (newValue) => {
  if (isReadOnly.value) return;

  if (protocolSaveTimer.value) {
    clearTimeout(protocolSaveTimer.value);
  }

  protocolSaveStatus.value = 'idle';

  protocolSaveTimer.value = window.setTimeout(async () => {
    protocolSaveStatus.value = 'saving';
    const success = await store.updateDefinition({ protocol_url: newValue });
    if (success) {
      protocolSaveStatus.value = 'saved';
      setTimeout(() => {
        protocolSaveStatus.value = 'idle';
      }, 2000);
    } else {
      protocolSaveStatus.value = 'idle';
      notifications.error('Save failed', 'Could not update protocol URL');
    }
  }, 1000);
});

// Auto-save for Objectives
watch(objectives, (newValue) => {
  if (isReadOnly.value) return;

  if (objectivesSaveTimer.value) {
    clearTimeout(objectivesSaveTimer.value);
  }

  objectivesSaveStatus.value = 'idle';

  objectivesSaveTimer.value = window.setTimeout(async () => {
    objectivesSaveStatus.value = 'saving';
    const success = await store.updateDefinition({ objectives: newValue });
    if (success) {
      objectivesSaveStatus.value = 'saved';
      setTimeout(() => {
        objectivesSaveStatus.value = 'idle';
      }, 2000);
    } else {
      objectivesSaveStatus.value = 'idle';
      notifications.error('Save failed', 'Could not update objectives');
    }
  }, 1000);
});

async function handleKeywordsUpdate(keywords: string[]) {
  const success = await store.updateDefinition({ keywords });
  if (success) {
    notifications.success('Saved', 'Keywords updated');
  } else {
    notifications.error('Save failed', 'Could not update keywords');
  }
}

async function handleAddCriterion(data: {
  name: string;
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.addCriterion(data);
  if (success) {
    notifications.success('Added', `Criterion "${data.name}" added`);
  } else {
    notifications.error('Failed', 'Could not add criterion');
  }
}

async function handleUpdateCriterion(name: string, data: {
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.updateCriterion({
    criterion_name: name,
    ...data,
  });
  if (success) {
    notifications.success('Updated', `Criterion "${name}" updated`);
  } else {
    notifications.error('Failed', 'Could not update criterion');
  }
}

async function handleDeleteCriterion(name: string) {
  const success = await store.removeCriterion(name);
  if (success) {
    notifications.success('Removed', `Criterion "${name}" removed`);
  } else {
    notifications.error('Failed', 'Could not remove criterion');
  }
}

function goToSearch() {
  if (projects.currentProjectId) {
    router.push(`/project/${projects.currentProjectId}/search`);
  }
}
</script>

<template>
  <div class="p-6 h-full overflow-auto max-w-4xl" data-testid="review-definition-page">
    <!-- Header -->
    <div class="flex items-center gap-2 pb-4">
      <h2 class="text-xl font-semibold">Review Definition</h2>
      <Badge variant="secondary" class="text-xs" data-testid="review-type-badge">
        {{ store.definition?.review_type || 'Not set' }}
      </Badge>
    </div>

    <Separator />

    <!-- Two-column: Overview + Keywords/Stats -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-0 pt-4">
      <!-- Left: Overview form (3/5) -->
      <div class="lg:col-span-3 lg:pr-5 lg:border-r border-border space-y-5">
        <!-- Title (read-only) -->
        <div>
          <label class="text-sm font-medium text-muted-foreground">Title</label>
          <p class="text-sm mt-1">{{ store.definition?.title || 'Untitled Review' }}</p>
        </div>

        <!-- Protocol URL -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-sm font-medium">Protocol URL</label>
            <div
              v-if="protocolSaveStatus !== 'idle'"
              class="flex items-center gap-1 text-xs"
              :class="protocolSaveStatus === 'saved' ? 'text-green-600' : 'text-muted-foreground'"
            >
              <Check v-if="protocolSaveStatus === 'saved'" class="h-3 w-3" />
              <span>{{ protocolSaveStatus === 'saved' ? 'Saved' : 'Saving...' }}</span>
            </div>
          </div>
          <Input
            v-model="protocolUrl"
            placeholder="https://... (e.g., PROSPERO registration)"
            data-testid="protocol-url-input"
            :disabled="isReadOnly"
          />
        </div>

        <!-- Objectives -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-sm font-medium">Research Question & Objectives</label>
            <div
              v-if="objectivesSaveStatus !== 'idle'"
              class="flex items-center gap-1 text-xs"
              :class="objectivesSaveStatus === 'saved' ? 'text-green-600' : 'text-muted-foreground'"
            >
              <Check v-if="objectivesSaveStatus === 'saved'" class="h-3 w-3" />
              <span>{{ objectivesSaveStatus === 'saved' ? 'Saved' : 'Saving...' }}</span>
            </div>
          </div>
          <Textarea
            v-model="objectives"
            placeholder="Describe the research question or objectives of this review..."
            rows="5"
            data-testid="objectives-textarea"
            :disabled="isReadOnly"
          />
        </div>
      </div>

      <!-- Right: Keywords + Stats (2/5) -->
      <div class="lg:col-span-2 lg:pl-5 pt-4 lg:pt-0 border-t lg:border-t-0 border-border space-y-5">
        <!-- Keywords -->
        <div>
          <h3 class="text-sm font-medium text-muted-foreground mb-2">Keywords</h3>
          <KeywordEditor
            :keywords="store.definition?.keywords || []"
            :read-only="isReadOnly"
            @update="handleKeywordsUpdate"
          />
        </div>

        <!-- Quick Stats -->
        <div>
          <h3 class="text-sm font-medium text-muted-foreground mb-2">Stats</h3>
          <div class="text-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Screening criteria</span>
              <span>{{ criteriaCount }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Keywords</span>
              <span>{{ store.definition?.keywords?.length || 0 }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Separator class="mt-5" />

    <!-- Screening Criteria (full width) -->
    <div class="pt-4">
      <h3 class="text-sm font-medium text-muted-foreground mb-1">Screening Criteria</h3>
      <p class="text-xs text-muted-foreground/70 mb-3">Define inclusion and exclusion criteria for screening decisions</p>

      <CriteriaList
        :criteria="store.definition?.criteria || {}"
        :is-saving="store.isSaving"
        :read-only="isReadOnly"
        @add-criterion="handleAddCriterion"
        @update-criterion="handleUpdateCriterion"
        @delete-criterion="handleDeleteCriterion"
      />
    </div>

    <!-- Next Step -->
    <div class="flex justify-end pt-5 pb-8">
      <Button size="sm" data-testid="goto-search-btn" @click="goToSearch" class="gap-2">
        Continue to Search
        <ArrowRight class="h-3.5 w-3.5" />
      </Button>
    </div>
  </div>
</template>
