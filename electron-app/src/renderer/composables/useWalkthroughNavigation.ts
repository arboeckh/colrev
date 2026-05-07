import { computed, onMounted, onUnmounted, ref, toValue, type MaybeRefOrGetter } from 'vue';

export interface UseWalkthroughNavigationOptions<T> {
  items: MaybeRefOrGetter<T[]>;
  isUndecided: (item: T) => boolean;
  // If true, nextUndecidedIndex wraps around to scan from the start.
  wrapAround?: boolean;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  // Return false to disable keyboard navigation (e.g. while in an edit mode).
  shouldHandleKey?: () => boolean;
}

export function useWalkthroughNavigation<T>(options: UseWalkthroughNavigationOptions<T>) {
  const currentIndex = ref(0);
  const items = computed(() => toValue(options.items));
  const currentItem = computed<T | null>(() => items.value[currentIndex.value] ?? null);

  const wrapAround = options.wrapAround ?? false;

  const nextUndecidedIndex = computed(() => {
    const list = items.value;
    for (let i = currentIndex.value + 1; i < list.length; i++) {
      if (options.isUndecided(list[i])) return i;
    }
    if (wrapAround) {
      for (let i = 0; i < currentIndex.value; i++) {
        if (options.isUndecided(list[i])) return i;
      }
    }
    return -1;
  });

  function goTo(index: number) {
    if (index >= 0 && index < items.value.length) {
      currentIndex.value = index;
    }
  }
  function next() {
    goTo(currentIndex.value + 1);
  }
  function prev() {
    goTo(currentIndex.value - 1);
  }
  function skipToNextUndecided() {
    if (nextUndecidedIndex.value !== -1) {
      currentIndex.value = nextUndecidedIndex.value;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (options.shouldHandleKey && !options.shouldHandleKey()) return;
    if (!currentItem.value) return;
    switch (e.key) {
      case 'ArrowLeft':
        if (options.onArrowLeft) {
          e.preventDefault();
          options.onArrowLeft();
        }
        break;
      case 'ArrowRight':
        if (options.onArrowRight) {
          e.preventDefault();
          options.onArrowRight();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        prev();
        break;
      case 'ArrowDown':
        e.preventDefault();
        next();
        break;
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown));
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

  return {
    currentIndex,
    currentItem,
    nextUndecidedIndex,
    goTo,
    next,
    prev,
    skipToNextUndecided,
  };
}
