import { onUnmounted, watch, type MaybeRefOrGetter, toValue } from 'vue';
import { useSyncStore } from '@/stores/sync';

/**
 * Hold off automatic pulls while this component is mounted (or while
 * `active` is true), because a working-tree change underneath it would
 * disrupt something the user is in the middle of.
 *
 * The suspension is released on unmount without the caller doing anything, so
 * it cannot leak and wedge auto-sync off. Fetching continues throughout —
 * only operations that touch the working tree are held.
 *
 * You rarely need to call this directly: `useWalkthroughNavigation` already
 * does, so every walkthrough surface is covered by construction. Reach for it
 * when you build a *new* kind of long-lived interaction over project data.
 */
export function useSyncSuspense(
  reason: string,
  active: MaybeRefOrGetter<boolean> = true,
): void {
  const sync = useSyncStore();
  let release: (() => void) | null = null;

  function apply(shouldSuspend: boolean): void {
    if (shouldSuspend && !release) {
      release = sync.suspend(reason);
    } else if (!shouldSuspend && release) {
      release();
      release = null;
    }
  }

  apply(toValue(active));
  watch(() => toValue(active), apply);

  onUnmounted(() => {
    release?.();
    release = null;
  });
}
