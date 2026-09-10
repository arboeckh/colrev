import { computed } from 'vue';
import { useSyncStore } from '@/stores/sync';
import { escalationSeverity, type SyncEscalation } from '@/lib/syncPolicy';

export interface SyncGate {
  /** True when an unresolved sync situation should block starting an operation. */
  isBlocked: import('vue').ComputedRef<boolean>;
  /** What is blocking, or null. */
  reason: import('vue').ComputedRef<SyncEscalation | null>;
  /** One line to render next to the disabled action. */
  message: import('vue').ComputedRef<string | null>;
}

const MESSAGES: Record<SyncEscalation, string> = {
  'merge-conflict':
    'Finish resolving the merge conflict before starting — the repository is mid-merge.',
  diverged:
    'You and a collaborator both made changes. Combine them first, or you will be working from a stale copy.',
  'dirty-blocks-pull':
    'There are changes waiting from collaborators. Save or discard your local work to receive them first.',
  'behind-auto-disabled':
    'There are changes waiting from collaborators. Pull them before starting.',
};

/**
 * Block an *operation boundary* on an unresolved sync situation.
 *
 * This is the only sanctioned way for sync to interrupt: at the moment the
 * user starts something that divergence would corrupt or waste (launching a
 * managed review, publishing dev into main, cutting a release). Everything
 * short of a boundary gets the passive banner instead — an interruption
 * mid-review teaches users to dismiss sync prompts, which costs more than it
 * ever saves.
 *
 * `escalationSeverity` decides which situations are severe enough to gate, so
 * a new escalation kind has to state its severity and cannot silently default
 * to interrupting everything.
 */
export function useSyncGate(): SyncGate {
  const sync = useSyncStore();

  const reason = computed<SyncEscalation | null>(() => {
    const escalation = sync.escalation;
    if (!escalation) return null;
    return escalationSeverity(escalation) === 'gate' ? escalation : null;
  });

  return {
    reason,
    isBlocked: computed(() => reason.value !== null),
    message: computed(() => (reason.value ? MESSAGES[reason.value] : null)),
  };
}
