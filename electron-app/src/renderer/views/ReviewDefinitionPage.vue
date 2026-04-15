<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { ArrowRight, Save } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { CriteriaList } from '@/components/review-definition';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useProjectsStore } from '@/stores/projects';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';
import { useGitStore } from '@/stores/git';

const router = useRouter();
const store = useReviewDefinitionStore();
const projects = useProjectsStore();
const notifications = useNotificationsStore();
const gitStore = useGitStore();
const { isReadOnly } = useReadOnly();

// Local form state
const protocolUrl = ref('');
const objectives = ref('');

// Tracks criteria changes staged to git but not yet committed
const hasPendingCriteriaChanges = ref(false);

// Quick stats
const criteriaCount = computed(() => {
  return Object.keys(store.definition?.criteria || {}).length;
});

// Dirty tracking
const hasTextChanges = computed(() => {
  if (!store.definition) return false;
  return (
    protocolUrl.value !== store.definition.protocol_url ||
    objectives.value !== store.definition.objectives
  );
});

const isDirty = computed(() => {
  return hasTextChanges.value || hasPendingCriteriaChanges.value;
});

onMounted(async () => {
  await store.loadDefinition();
  if (store.definition) {
    protocolUrl.value = store.definition.protocol_url;
    objectives.value = store.definition.objectives;
  }
});

// Warn before navigating away with unsaved changes
onBeforeRouteLeave((_to, _from, next) => {
  if (isDirty.value) {
    const leave = window.confirm('You have unsaved changes. Discard them?');
    next(leave);
  } else {
    next();
  }
});

// Save all pending changes in a single commit
async function saveAll() {
  const updates: { protocol_url?: string; objectives?: string; keywords?: string[] } = {};

  if (store.definition) {
    if (protocolUrl.value !== store.definition.protocol_url) {
      updates.protocol_url = protocolUrl.value;
    }
    if (objectives.value !== store.definition.objectives) {
      updates.objectives = objectives.value;
    }
  }

  // If only criteria changed, send current values to trigger a commit
  if (Object.keys(updates).length === 0 && hasPendingCriteriaChanges.value) {
    updates.objectives = objectives.value;
  }

  const success = await store.updateDefinition(updates);
  if (success) {
    hasPendingCriteriaChanges.value = false;
    notifications.success('Saved', 'Review definition updated');
    gitStore.refreshStatus();
  } else {
    notifications.error('Save failed', 'Could not update review definition');
  }
}

// Criteria: each change stages immediately; the user commits via the header's Commit dialog
async function handleAddCriterion(data: {
  name: string;
  explanation: string;
  comment?: string;
  criterion_type: 'inclusion_criterion' | 'exclusion_criterion';
}) {
  const success = await store.addCriterion(data);
  if (success) {
    hasPendingCriteriaChanges.value = true;
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
    hasPendingCriteriaChanges.value = true;
  } else {
    notifications.error('Failed', 'Could not update criterion');
  }
}

async function handleDeleteCriterion(name: string) {
  const success = await store.removeCriterion(name);
  if (success) {
    hasPendingCriteriaChanges.value = true;
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
      <div v-if="isDirty && !isReadOnly" class="ml-auto flex items-center gap-2.5">
        <span class="text-xs text-muted-foreground">Unsaved changes</span>
        <Button
          size="sm"
          data-testid="save-definition-btn"
          :disabled="store.isSaving"
          @click="saveAll"
          class="gap-1.5"
        >
          <Save class="h-3.5 w-3.5" />
          {{ store.isSaving ? 'Saving...' : 'Save' }}
        </Button>
      </div>
    </div>

    <Separator />

    <!-- Overview form -->
    <div class="pt-4 space-y-5 max-w-xl">
      <!-- Title (read-only) -->
      <div>
        <label class="text-sm font-medium text-muted-foreground">Title</label>
        <p class="text-sm mt-1">{{ store.definition?.title || 'Untitled Review' }}</p>
      </div>

      <!-- Protocol URL -->
      <div>
        <label class="text-sm font-medium mb-1.5 block">Protocol URL</label>
        <Input
          v-model="protocolUrl"
          placeholder="https://... (e.g., PROSPERO registration)"
          data-testid="protocol-url-input"
          :disabled="isReadOnly"
        />
      </div>

      <!-- Objectives -->
      <div>
        <label class="text-sm font-medium mb-1.5 block">Research Question & Objectives</label>
        <Textarea
          v-model="objectives"
          placeholder="Describe the research question or objectives of this review..."
          rows="5"
          data-testid="objectives-textarea"
          :disabled="isReadOnly"
        />
      </div>
    </div>

    <Separator class="mt-5" />

    <!-- Screening Criteria -->
    <div class="pt-4 max-w-xl">
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
