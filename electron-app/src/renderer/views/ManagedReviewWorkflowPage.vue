<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Check } from 'lucide-vue-next';
import { ManagedReviewLaunchPanel, ManagedReviewReconcilePanel } from '@/components/managed-review';
import PrescreenPage from '@/views/PrescreenPage.vue';
import ScreenPage from '@/views/ScreenPage.vue';
import StepPageShell from '@/components/layout/StepPageShell.vue';
import PrescreenPageHelp from '@/views/PrescreenPageHelp.vue';
import ScreenPageHelp from '@/views/ScreenPageHelp.vue';
import { useReconcileGate } from '@/composables/useReconcileGate';
import { useManagedReviewStore } from '@/stores/managedReview';
import { useGitStore } from '@/stores/git';
import { ensureWorkingBranch, shareUnpublishedReviews } from '@/composables/useManagedTaskAccess';
import { useNotificationsStore } from '@/stores/notifications';
import { useAuthStore } from '@/stores/auth';
import { useProjectsStore } from '@/stores/projects';
import { useBackendStore } from '@/stores/backend';
import {
  canEnterReviewPhase,
  computeReviewPhaseStatus,
  isReviewRoundComplete,
  type ReviewPhase,
} from '@/lib/stepStatus';
import { useProjectDataChanged } from '@/composables/useProjectDataChanged';

type Phase = ReviewPhase;

const route = useRoute();
const managedReview = useManagedReviewStore();
const git = useGitStore();
const auth = useAuthStore();
const projects = useProjectsStore();
const backend = useBackendStore();
const notifications = useNotificationsStore();
const { canNavigateToReconcile } = useReconcileGate();

const kind = computed<'prescreen' | 'screen'>(() =>
  route.meta.managedReviewKind === 'screen' ? 'screen' : 'prescreen',
);
const pageHelp = computed(() => kind.value === 'screen' ? ScreenPageHelp : PrescreenPageHelp);
const subtitle = computed(() =>
  kind.value === 'screen'
    ? 'Screen full-text records against inclusion criteria'
    : 'Screen records based on title and abstract',
);

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

const currentPhase = computed<Phase>(() => userOverridePhase.value ?? 'launch');

// Stepper phase definitions
const phases: { id: Phase; label: string }[] = [
  { id: 'launch', label: 'Launch' },
  { id: 'review', label: 'Review' },
  { id: 'reconcile', label: 'Reconcile' },
];

const eligibleCount = computed(() => projects.payloadSteps?.[kind.value]?.pending_records ?? null);

// The stepper describes the current round, not the project's history: a round
// reconciled earlier says nothing about new records that became eligible since.
const roundComplete = computed(() =>
  isReviewRoundComplete({
    hasActiveTask: activeTask.value != null,
    hasCompletedTask: completedTask.value != null,
    // Unknown counts must not declare a round finished.
    eligibleCount: eligibleCount.value ?? 1,
  }),
);

// Data collection only — the phase derivation lives in the shared status
// module (lib/stepStatus.ts). reviewer_progress reads the branch HEAD
// (committed state), but review decisions only update the working tree until
// the user explicitly commits — so "on my reviewer branch + nothing eligible
// left in the payload" also counts as done for the current user.
function phaseStatus(phaseId: Phase): 'complete' | 'active' | 'pending' {
  const task = activeTask.value;
  const login = auth.user?.login?.toLowerCase();
  const myProgress =
    task && login
      ? task.reviewer_progress.find((r) => r.github_login.toLowerCase() === login) ?? null
      : null;

  return computeReviewPhaseStatus(phaseId, {
    currentPhase: currentPhase.value,
    hasActiveTask: task != null,
    roundComplete: roundComplete.value,
    allReviewersDone:
      task != null && task.reviewer_progress.every((r) => r.pending_count === 0),
    myProgressDone: myProgress ? myProgress.pending_count === 0 : null,
    onOwnBranchNothingEligible:
      myProgress != null &&
      git.currentBranch === myProgress.branch_name &&
      eligibleCount.value === 0,
  });
}

function canNavigateToPhase(phaseId: Phase): boolean {
  return canEnterReviewPhase(phaseId, {
    hasActiveTask: activeTask.value != null,
    roundComplete: roundComplete.value,
    reconcileGateOpen: canNavigateToReconcile.value,
  });
}

const isSwitchingPhase = ref(false);
const launchPanelRef = ref<InstanceType<typeof ManagedReviewLaunchPanel> | null>(null);
const reconcilePanelRef = ref<InstanceType<typeof ManagedReviewReconcilePanel> | null>(null);

async function selectPhase(phaseId: Phase): Promise<boolean> {
  if (!canNavigateToPhase(phaseId)) return false;
  if (isSwitchingPhase.value) return false;

  // Switch branch BEFORE changing phase so the new panel mounts on the right branch.
  // This avoids the new panel's onMounted triggering a competing switchBranch.
  if ((phaseId === 'launch' || phaseId === 'reconcile') && !git.isOnDev) {
    isSwitchingPhase.value = true;
    try {
      if (!(await ensureWorkingBranch())) {
        // The switch was refused — unsaved decisions opened the save-or-discard
        // dialog. Stay on this phase; opening the panel anyway mounted it on
        // the reviewer branch, where it asked to switch (and opened the dialog)
        // a second time. Once the user resolves the dialog, carry on to where
        // they were heading.
        if (git.showBranchSwitchBlockedDialog) {
          git.blockedSwitchResume = () => {
            userOverridePhase.value = phaseId;
          };
        }
        return false;
      }
    } finally {
      isSwitchingPhase.value = false;
    }
  }

  userOverridePhase.value = phaseId;
  return true;
}

function onTaskCreated() {
  // After task creation, refresh managed review and auto-advance
  managedReview.refresh();
  userOverridePhase.value = null; // Let autoPhase take over
}

async function onNavigateReconcile() {
  if (!canNavigateToReconcile.value) return;
  if (!(await selectPhase('reconcile'))) return;
  await nextTick();
  await reconcilePanelRef.value?.tryAutoStart();
}

// A pull / reset / merge replaced the working tree: reviewer task state comes
// from it. No fetch — a full invalidation is a *local* tree replacement
// (branch switch, pull that already fetched), and entering the review phase
// triggers one, so fetching here would put a network round trip on the
// critical path of every entry.
useProjectDataChanged(async (event) => {
  if (!event.full) return;
  if (backend.isRunning && projects.currentProjectId) {
    await managedReview.refresh();
  }
});

onMounted(async () => {
  if (backend.isRunning && projects.currentProjectId) {
    // The one place a fetch is worth its latency: arriving at the workflow
    // page is when the user asks "where is the other reviewer at?".
    await managedReview.refresh({ fetch: true });

    // …and when the other reviewer asks it about us: decisions saved on a
    // reviewer branch but never pushed are invisible to them.
    const shared = await shareUnpublishedReviews([
      ...managedReview.prescreenTasks,
      ...managedReview.screenTasks,
    ]);
    if (shared.length > 0) {
      notifications.success(
        'Shared your saved decisions',
        'They had been saved on this device only. Your co-reviewer can see them now.',
      );
      await managedReview.refresh();
      await (launchPanelRef.value ?? reconcilePanelRef.value)?.refreshData();
    }
  }
});

</script>

<template>
  <StepPageShell
    :step="kind"
    :subtitle="subtitle"
    :page-help="pageHelp"
  >
  <div class="p-6 h-full flex flex-col" :data-testid="`managed-review-${kind}`">
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
          :data-testid="`workflow-phase-${phase.id}`"
          :data-phase-status="phaseStatus(phase.id)"
          @click="selectPhase(phase.id)"
        >
          <!-- Step indicator -->
          <div
            class="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all text-xs"
            :class="[
              phaseStatus(phase.id) === 'complete'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : phaseStatus(phase.id) === 'active'
                  ? 'border-foreground bg-background ring-2 ring-foreground/20'
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
        ref="launchPanelRef"
        :kind="kind"
        @task-created="onTaskCreated"
        @navigate-review="selectPhase('review')"
        @navigate-reconcile="onNavigateReconcile"
      />
      <template v-else-if="currentPhase === 'review'">
        <PrescreenPage
          v-if="kind === 'prescreen'"
          embedded
          @navigate-reconcile="onNavigateReconcile"
        />
        <ScreenPage
          v-else
          embedded
          @navigate-reconcile="onNavigateReconcile"
        />
      </template>
      <ManagedReviewReconcilePanel
        v-else-if="currentPhase === 'reconcile'"
        ref="reconcilePanelRef"
        :kind="kind"
      />
    </div>
  </div>
  </StepPageShell>
</template>
