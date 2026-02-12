<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { BookOpen, Save, Plus, ArrowRight, Loader2 } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  CriteriaList,
  AddCriterionDialog,
  EditCriterionDialog,
  KeywordEditor,
} from '@/components/review-definition';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import type { ScreenCriterionDefinition } from '@/types/api';

const router = useRouter();
const store = useReviewDefinitionStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();

// Local form state
const protocolUrl = ref('');
const objectives = ref('');
const showAddCriterion = ref(false);
const showEditCriterion = ref(false);
const editCriterionName = ref('');
const editCriterionData = ref<ScreenCriterionDefinition | null>(null);

onMounted(async () => {
  await store.loadDefinition();
  if (store.definition) {
    protocolUrl.value = store.definition.protocol_url;
    objectives.value = store.definition.objectives;
  }
});

async function saveProtocol() {
  const success = await store.updateDefinition({ protocol_url: protocolUrl.value });
  if (success) {
    notifications.success('Saved', 'Protocol URL updated');
  } else {
    notifications.error('Save failed', 'Could not update protocol URL');
  }
}

async function saveObjectives() {
  const success = await store.updateDefinition({ objectives: objectives.value });
  if (success) {
    notifications.success('Saved', 'Objectives updated');
  } else {
    notifications.error('Save failed', 'Could not update objectives');
  }
}

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
    showAddCriterion.value = false;
    notifications.success('Added', `Criterion "${data.name}" added`);
  } else {
    notifications.error('Failed', 'Could not add criterion');
  }
}

function openEditCriterion(name: string, criterion: ScreenCriterionDefinition) {
  editCriterionName.value = name;
  editCriterionData.value = criterion;
  showEditCriterion.value = true;
}

async function handleEditCriterion(data: {
  criterion_name: string;
  explanation?: string;
  comment?: string;
  criterion_type?: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.updateCriterion(data);
  if (success) {
    showEditCriterion.value = false;
    notifications.success('Updated', `Criterion "${data.criterion_name}" updated`);
  } else {
    notifications.error('Failed', 'Could not update criterion');
  }
}

async function handleRemoveCriterion(name: string) {
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

    <div class="max-w-2xl space-y-6">
      <!-- Review Type -->
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base">Review Type</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary" class="text-sm" data-testid="review-type-badge">
            {{ store.definition?.review_type || 'Not set' }}
          </Badge>
        </CardContent>
      </Card>

      <!-- Protocol -->
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base">Protocol</CardTitle>
          <CardDescription>Link to your review protocol (e.g., PROSPERO registration)</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex gap-2">
            <Input
              v-model="protocolUrl"
              placeholder="https://..."
              class="flex-1"
              data-testid="protocol-url-input"
            />
            <Button
              variant="outline"
              size="sm"
              :disabled="store.isSaving"
              data-testid="protocol-save-btn"
              @click="saveProtocol"
            >
              <Loader2 v-if="store.isSaving" class="h-4 w-4 mr-1 animate-spin" />
              <Save v-else class="h-4 w-4 mr-1" />
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Keywords -->
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

      <!-- Objectives -->
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base">Objectives</CardTitle>
          <CardDescription>Research question or review objectives</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            <Textarea
              v-model="objectives"
              placeholder="Describe the research question or objectives of this review..."
              rows="4"
              data-testid="objectives-textarea"
            />
            <div class="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                :disabled="store.isSaving"
                data-testid="objectives-save-btn"
                @click="saveObjectives"
              >
                <Loader2 v-if="store.isSaving" class="h-4 w-4 mr-1 animate-spin" />
                <Save v-else class="h-4 w-4 mr-1" />
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Screening Criteria -->
      <Card>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <div>
              <CardTitle class="text-base">Screening Criteria</CardTitle>
              <CardDescription>Criteria used for full-text screening decisions</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              data-testid="add-criterion-btn"
              @click="showAddCriterion = true"
            >
              <Plus class="h-4 w-4 mr-1" />
              Add Criterion
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CriteriaList
            :criteria="store.definition?.criteria || {}"
            @edit="openEditCriterion"
            @remove="handleRemoveCriterion"
          />
        </CardContent>
      </Card>

      <!-- Next Step -->
      <div class="flex justify-end pt-4 pb-8">
        <Button data-testid="goto-search-btn" @click="goToSearch">
          Continue to Search
          <ArrowRight class="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>

    <!-- Dialogs -->
    <AddCriterionDialog
      v-model:open="showAddCriterion"
      :is-saving="store.isSaving"
      @submit="handleAddCriterion"
    />

    <EditCriterionDialog
      v-model:open="showEditCriterion"
      :criterion-name="editCriterionName"
      :criterion="editCriterionData"
      :is-saving="store.isSaving"
      @submit="handleEditCriterion"
    />
  </div>
</template>
