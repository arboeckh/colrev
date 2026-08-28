import { onMounted, onUnmounted } from 'vue';
import { useProjectDataStore, type ProjectDataEvent } from '@/stores/projectData';

/**
 * Register a page-level handler on the project-data invalidation seam:
 * "when project data changes and I'm active, reload my records."
 *
 * The handler is subscribed on mount and removed on unmount, so only the
 * active page reacts. Events fire after a writer RPC completes (coalesced)
 * and after full invalidations (pull, reset, merge, backend restart) —
 * check `event.full` to distinguish (walkthrough pages should only reload
 * on `full`; plain record tables can reload on every event).
 */
export function useProjectDataChanged(
  handler: (event: ProjectDataEvent) => void | Promise<void>,
): void {
  const projectData = useProjectDataStore();
  let unsubscribe: (() => void) | null = null;

  onMounted(() => {
    unsubscribe = projectData.subscribe(handler);
  });

  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });
}
