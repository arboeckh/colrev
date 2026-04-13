<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import { Check, Filter, CheckSquare } from 'lucide-vue-next';
import { ManagedReviewLaunchPanel, ManagedReviewReconcilePanel } from '@/components/managed-review';
import PrescreenPage from '@/views/PrescreenPage.vue';
import ScreenPage from '@/views/ScreenPage.vue';
import { useManagedReviewStore } from '@/stores/managedReview';
import { useGitStore } from '@/stores/git';
import { useAuthStore } from '@/stores/auth';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';

type Phase = 'launch' | 'review' | 'reconcile';

const route = useRoute();
const managedReview = useManagedReviewStore();
const git = useGitStore();
const auth = useAuthStore();
const projects = useProjectsStore();
const backend = useBackendStore();

const kind = computed<'prescreen' | 'screen'>(() =>
  route.meta.managedReviewKind === 'screen' ? 'screen' : 'prescreen',
);
const kindLabel = computed(() => kind.value === 'screen' ? 'Screen' : 'Prescreen');
const kindIcon = computed(() => kind.value === 'screen' ? CheckSquare : Filter);

// Phase state machine
const userOverridePhase = ref<Phase | null>(null);

const activeTask = computed(() =>
  kind.value === 'prescreen'
    ? managedReview.activePrescreenTask
    : managedReview.activeScreenTask,
);
const completedTask = computed(() =>
  kind.value === 'prescreen'
    ? managedReview.latestCompletedPrescreenTask
    : managedReview.latestCompletedScreenTask,
);

const autoPhase = computed<Phase>(() => {
  if (completedTask.value && !activeTask.value) return 'reconcile';
  if (!activeTask.value) return 'launch';

  const allDone = activeTask.value.reviewer_progress.every((r) => r.pending_count === 0);
  if (allDone || activeTask.value.state === 'reconciling') return 'reconcile';

  // Check if the current user is an assigned reviewer
  const login = auth.user?.login?.toLowerCase();
  if (login) {
    const myProgress = activeTask.value.reviewer_progress.find(
      (r) => r.github_login.toLowerCase() === login,
    );
    if (myProgress && myProgress.pending_count > 0) return 'review';
  }

  return 'launch';
});

const currentPhase = computed<Phase>(() => userOverridePhase.value ?? autoPhase.value);

// Stepper phase definitions
const phases: { id: Phase; label: string }[] = [
  { id: 'launch', label: 'Launch' },
  { id: 'review', label: 'Review' },
  { id: 'reconcile', label: 'Reconcile' },
];

function phaseStatus(phaseId: Phase): 'complete' | 'active' | 'pending' {
  const task = activeTask.value;
  const completed = completedTask.value;

  if (phaseId === 'launch') {
    if (task || completed) return 'complete';
    return currentPhase.value === 'launch' ? 'active' : 'pending';
  }

  if (phaseId === 'review') {
    if (completed && !task) return 'complete';
    if (task) {
      const allDone = task.reviewer_progress.every((r) => r.pending_count === 0);
      if (allDone) return 'complete';
      return currentPhase.value === 'review' ? 'active' : 'pending';
    }
    return 'pending';
  }

  if (phaseId === 'reconcile') {
    if (completed) return 'complete';
    if (task) {
      const allDone = task.reviewer_progress.every((r) => r.pending_count === 0);
      if (allDone && currentPhase.value === 'reconcile') return 'active';
    }
    return 'pending';
  }

  return 'pending';
}

function canNavigateToPhase(phaseId: Phase): boolean {
  const task = activeTask.value;
  const completed = completedTask.value;

  if (phaseId === 'launch') return true;
  if (phaseId === 'review') return !!(task || completed);
  if (phaseId === 'reconcile') return !!(task || completed);
  return false;
}

async function selectPhase(phaseId: Phase) {
  if (!canNavigateToPhase(phaseId)) return;
  userOverridePhase.value = phaseId;

  // Auto-switch branches: launch/reconcile need dev, review handles its own
  if ((phaseId === 'launch' || phaseId === 'reconcile') && !git.isOnDev) {
    await git.switchBranch('dev');
  }
}

function onTaskCreated() {
  // After task creation, refresh managed review and auto-advance
  managedReview.refresh();
  userOverridePhase.value = null; // Let autoPhase take over
}

onMounted(async () => {
  if (backend.isRunning && projects.currentProjectId) {
    await managedReview.refresh();
  }

  // Ensure we're on dev if starting on launch/reconcile phase
  if ((currentPhase.value === 'launch' || currentPhase.value === 'reconcile') && !git.isOnDev) {
    await git.switchBranch('dev');
  }
});

// Auto-switch back to dev when leaving from a reviewer branch
onBeforeRouteLeave(async (_to, _from, next) => {
  if (!git.isOnDev && !git.isOnMain && git.currentBranch.startsWith('review/')) {
    await git.switchBranch('dev');
  }
  next();
});
</script>

<template>
  <div class="p-6 h-full flex flex-col">
    <!-- Page header -->
    <div class="flex items-center gap-2 mb-4">
      <component :is="kindIcon" class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-xl font-semibold">{{ kindLabel }}</h2>
    </div>

    <!-- Stepper -->
    <div class="flex items-center gap-1 mb-6">
      <template v-for="(phase, index) in phases" :key="phase.id">
        <!-- Connector line -->
        <div
          v-if="index > 0"
          class="flex-1 h-px max-w-12"
          :class="phaseStatus(phase.id) === 'complete' || phaseStatus(phases[index - 1].id) === 'complete' ? 'bg-emerald-500' : 'bg-border'"
        />

        <!-- Phase button -->
        <button
          class="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors"
          :class="[
            currentPhase === phase.id
              ? 'bg-primary/10 text-foreground font-medium'
              : canNavigateToPhase(phase.id)
                ? 'text-muted-foreground hover:text-foreground hover:bg-accent/30 cursor-pointer'
                : 'text-muted-foreground/40 cursor-not-allowed',
          ]"
          :disabled="!canNavigateToPhase(phase.id)"
          @click="selectPhase(phase.id)"
        >
          <!-- Step indicator -->
          <div
            class="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all text-xs"
            :class="[
              phaseStatus(phase.id) === 'complete'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : phaseStatus(phase.id) === 'active'
                  ? 'border-foreground bg-background'
                  : 'border-muted-foreground/30 bg-background',
            ]"
          >
            <Check v-if="phaseStatus(phase.id) === 'complete'" class="h-3 w-3" />
            <div v-else-if="phaseStatus(phase.id) === 'active'" class="h-1.5 w-1.5 rounded-full bg-foreground" />
            <span v-else class="text-muted-foreground/40">{{ index + 1 }}</span>
          </div>

          <span>{{ phase.label }}</span>
        </button>
      </template>
    </div>

    <!-- Phase content -->
    <div class="flex-1 min-h-0">
      <ManagedReviewLaunchPanel
        v-if="currentPhase === 'launch'"
        :kind="kind"
        @task-created="onTaskCreated"
      />
      <template v-else-if="currentPhase === 'review'">
        <PrescreenPage v-if="kind === 'prescreen'" embedded />
        <ScreenPage v-else embedded />
      </template>
      <ManagedReviewReconcilePanel
        v-else-if="currentPhase === 'reconcile'"
        :kind="kind"
      />
    </div>
  </div>
</template>
