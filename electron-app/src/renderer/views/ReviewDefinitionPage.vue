<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { Save, ExternalLink } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { CriteriaList } from '@/components/review-definition';
import { useReviewDefinitionStore } from '@/stores/reviewDefinition';
import { useNotificationsStore } from '@/stores/notifications';
import { useReadOnly } from '@/composables/useReadOnly';
import { useGitStore } from '@/stores/git';

const store = useReviewDefinitionStore();
const notifications = useNotificationsStore();
const gitStore = useGitStore();
const { isReadOnly } = useReadOnly();

// Local form state
const protocolUrl = ref('');
const objectives = ref('');

const isValidProtocolUrl = computed(() => {
  const url = protocolUrl.value.trim();
  return url.startsWith('http://') || url.startsWith('https://');
});

// Tracks criteria changes staged to git but not yet committed
const hasPendingCriteriaChanges = ref(false);

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

</script>

<template>
  <div class="h-full overflow-auto" data-testid="review-definition-page">
    <!-- Sticky header with always-visible Save -->
    <header
      class="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
    >
      <div class="max-w-6xl mx-auto px-8 py-4 flex items-center gap-6">
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-semibold tracking-tight-heading leading-tight truncate">
            {{ store.definition?.title || 'Untitled Review' }}
          </h1>
        </div>
        <div v-if="!isReadOnly" class="shrink-0 flex items-center gap-3">
          <span v-if="isDirty" class="text-xs text-muted-foreground hidden sm:inline">
            Unsaved changes
          </span>
          <Button
            size="sm"
            data-testid="save-definition-btn"
            :disabled="!isDirty || store.isSaving"
            class="gap-1.5"
            @click="saveAll"
          >
            <Save class="h-3.5 w-3.5" />
            {{ store.isSaving ? 'Saving...' : 'Save changes' }}
          </Button>
        </div>
      </div>
    </header>

    <div class="max-w-6xl mx-auto px-8 pt-10 pb-20">
      <!-- Metadata row -->
      <section class="pb-8 border-b border-border">
        <div class="flex items-center gap-2 mb-2">
          <label class="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Protocol URL
          </label>
          <a
            v-if="isValidProtocolUrl"
            :href="protocolUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :title="`Open ${protocolUrl}`"
            data-testid="protocol-url-open"
          >
            <ExternalLink class="h-3.5 w-3.5" />
          </a>
        </div>
        <Input
          v-model="protocolUrl"
          placeholder="https://... (e.g., PROSPERO registration)"
          data-testid="protocol-url-input"
          :disabled="isReadOnly"
          class="max-w-xl"
        />
      </section>

      <!-- Two-column body: RQ centerpiece + screening criteria sidebar -->
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-10 pt-10">
        <!-- Research Question & Objectives (centerpiece) -->
        <section class="min-w-0">
          <div class="mb-5">
            <h2 class="text-xl font-semibold tracking-tight-heading">
              Research question &amp; objectives
            </h2>
          </div>

          <RichTextEditor
            v-model="objectives"
            placeholder="Describe the research question or objectives of this review..."
            data-testid="objectives-textarea"
            min-height="26rem"
            :disabled="isReadOnly"
          />
        </section>

        <!-- Screening Criteria -->
        <section class="min-w-0">
          <div class="mb-5">
            <h2 class="text-xl font-semibold tracking-tight-heading">
              Inclusion &amp; exclusion criteria
            </h2>
            <p class="text-sm text-muted-foreground mt-1.5">
              Criteria applied during prescreen and screen decisions.
            </p>
          </div>

          <CriteriaList
            :criteria="store.definition?.criteria || {}"
            :is-saving="store.isSaving"
            :read-only="isReadOnly"
            @add-criterion="handleAddCriterion"
            @update-criterion="handleUpdateCriterion"
            @delete-criterion="handleDeleteCriterion"
          />
        </section>
      </div>
    </div>
  </div>
</template>
