<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { BookOpen, ArrowRight, Check, X } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { CriteriaList, KeywordEditor } from '@/components/review-definition';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';

const router = useRouter();
const store = useReviewDefinitionStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();

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

const lastUpdated = computed(() => {
  return new Date().toLocaleDateString();
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
  <div class="p-6 h-full overflow-auto" data-testid="review-definition-page">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <BookOpen class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-xl font-semibold">Review Definition</h2>
      </div>
    </div>

    <Separator class="mb-6" />

    <!-- Dashboard Grid Layout -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <!-- Left Column: Overview (3/5 width on large screens) -->
      <div class="lg:col-span-3">
        <Card class="h-full">
          <CardHeader>
            <div class="flex items-center gap-2 mb-2">
              <CardTitle class="text-2xl">Overview</CardTitle>
              <Badge variant="secondary" class="text-sm" data-testid="review-type-badge">
                {{ store.definition?.review_type || 'Not set' }}
              </Badge>
            </div>
            <CardDescription>
              Core information about your literature review
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-6">
            <!-- Title (read-only from project) -->
            <div>
              <label class="text-sm font-medium text-muted-foreground">Title</label>
              <p class="text-base mt-1.5">{{ store.definition?.title || 'Untitled Review' }}</p>
            </div>

            <!-- Protocol URL (auto-save) -->
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
              />
            </div>

            <!-- Objectives (auto-save) -->
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
                rows="6"
                data-testid="objectives-textarea"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Right Column: Keywords & Stats (2/5 width on large screens) -->
      <div class="lg:col-span-2 space-y-6">
        <!-- Keywords Section -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-base">Keywords</CardTitle>
            <CardDescription>Keywords describing the review scope</CardDescription>
          </CardHeader>
          <CardContent>
            <KeywordEditor
              :keywords="store.definition?.keywords || []"
              @update="handleKeywordsUpdate"
            />
          </CardContent>
        </Card>

        <!-- Quick Stats Section -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-sm font-medium">Quick Stats</CardTitle>
          </CardHeader>
          <CardContent class="text-sm text-muted-foreground space-y-2">
            <div class="flex items-center justify-between">
              <span>Screening Criteria:</span>
              <span class="font-medium text-foreground">{{ criteriaCount }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span>Keywords:</span>
              <span class="font-medium text-foreground">{{ store.definition?.keywords?.length || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span>Last Updated:</span>
              <span class="font-medium text-foreground">{{ lastUpdated }}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Bottom Row: Screening Criteria (full width) -->
      <div class="lg:col-span-5">
        <Card>
          <CardHeader>
            <CardTitle class="text-xl">Screening Criteria</CardTitle>
            <CardDescription>
              Define inclusion and exclusion criteria for screening decisions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CriteriaList
              :criteria="store.definition?.criteria || {}"
              :is-saving="store.isSaving"
              @add-criterion="handleAddCriterion"
              @update-criterion="handleUpdateCriterion"
              @delete-criterion="handleDeleteCriterion"
            />
          </CardContent>
        </Card>
      </div>

      <!-- Next Step Button (full width) -->
      <div class="lg:col-span-5 flex justify-end pt-4 pb-8">
        <Button data-testid="goto-search-btn" @click="goToSearch">
          Continue to Search
          <ArrowRight class="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  </div>
</template>
