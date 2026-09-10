<script setup lang="ts">
/**
 * The one place sync asks the user for something.
 *
 * It renders exactly what `computeSyncEscalation` reports and nothing else —
 * when auto-sync is coping (the overwhelmingly common case) this component
 * renders nothing at all. It is persistent and non-blocking by design: an
 * unprompted modal mid-review trains users to dismiss sync prompts, which is
 * strictly worse than never showing one. Blocking belongs at operation
 * boundaries instead (see `useSyncGate`).
 */
import { computed } from 'vue';
import { AlertTriangle, ArrowDown, GitMerge, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useGitStore } from '@/stores/git';
import { useSyncStore } from '@/stores/sync';

const git = useGitStore();
const sync = useSyncStore();

type Tone = 'destructive' | 'warning' | 'info';

interface BannerView {
  tone: Tone;
  icon: typeof AlertTriangle;
  message: string;
  actionLabel: string;
  testId: string;
  onAction: () => void;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

const banner = computed<BannerView | null>(() => {
  switch (sync.escalation) {
    case 'merge-conflict':
      return {
        tone: 'destructive',
        icon: AlertTriangle,
        message: 'Merge conflict detected. Resolve manually or abort the merge.',
        actionLabel: 'Abort merge',
        testId: 'abort-merge-button',
        onAction: () => void git.abortMerge(),
      };
    case 'diverged':
      return {
        tone: 'destructive',
        icon: GitMerge,
        message:
          `You and a collaborator both made changes (${git.ahead} yours, ` +
          `${git.behind} theirs). They need to be combined before syncing.`,
        actionLabel: 'Review & combine',
        testId: 'resolve-divergence-button',
        onAction: () => void git.startDivergenceResolution(),
      };
    case 'dirty-blocks-pull':
      return {
        tone: 'warning',
        icon: ArrowDown,
        message:
          `${git.behind} new ${plural(git.behind, 'change', 'changes')} waiting, ` +
          'but you have unsaved local work. Save or discard it to receive them.',
        actionLabel: 'Choose…',
        testId: 'sync-dirty-button',
        onAction: () => {
          git.showPullBlockedDialog = true;
        },
      };
    case 'behind-auto-disabled':
      return {
        tone: 'info',
        icon: ArrowDown,
        message: `${git.behind} new ${plural(git.behind, 'change', 'changes')} from collaborators.`,
        actionLabel: 'Pull now',
        testId: 'pull-changes-button',
        onAction: () => void sync.pullNow(),
      };
    case null:
      // Auto-sync only ever moves `main` when it is the checked-out branch, so
      // a collaborator's push to `main` while the user works on `dev` still
      // needs a nudge — it is not a divergence, just an out-of-date ref.
      if (git.mainBehind > 0 && !git.isOnMain) {
        return {
          tone: 'info',
          icon: ArrowDown,
          message:
            `Collaborators pushed ${git.mainBehind} ` +
            `${plural(git.mainBehind, 'commit', 'commits')} to main.`,
          actionLabel: 'Update main',
          testId: 'update-main-button',
          onAction: () => void sync.fastForwardMainNow(),
        };
      }
      return null;
  }
});

const toneClass = computed(() => {
  switch (banner.value?.tone) {
    case 'destructive':
      return 'bg-destructive/10 border-destructive/30 text-destructive';
    case 'warning':
      return 'bg-amber-50 border-amber-300/60 text-amber-800';
    default:
      return 'bg-eucalyptus-50 border-eucalyptus-300/50 text-eucalyptus-700';
  }
});
</script>

<template>
  <div
    v-if="banner"
    class="border-b px-4 py-2 flex items-center gap-2"
    :class="toneClass"
    data-testid="sync-status-banner"
  >
    <component :is="banner.icon" class="h-4 w-4 shrink-0" />
    <span class="text-sm">{{ banner.message }}</span>
    <Button
      variant="outline"
      size="sm"
      class="ml-auto h-7 text-xs"
      :disabled="sync.busy || git.isResolving"
      :data-testid="banner.testId"
      @click="banner.onAction"
    >
      <X v-if="banner.testId === 'abort-merge-button'" class="h-3 w-3 mr-1" />
      {{ banner.actionLabel }}
    </Button>
  </div>
</template>
