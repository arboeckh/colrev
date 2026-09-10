<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { Bug, Trash2, Copy, Check } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useBackendStore } from '@/stores/backend';

const backend = useBackendStore();

const isOpen = ref(false);
const autoScroll = ref(true);
const copied = ref(false);

const OPT_IN_KEY = 'colrev:debug-panel';

// The panel is a developer/support tool, not a product feature. Shipping its
// floating trigger unconditionally put a bug icon with a log-line badge in the
// corner of every screen — including the sign-in page, before the user has an
// app to debug. It now shows in dev builds, or when someone deliberately opts
// in with Ctrl/Cmd+Shift+D (persisted, so a support session survives reloads).
const optedIn = ref(readOptIn());
const isVisible = computed(() => import.meta.env.DEV || optedIn.value);

function readOptIn(): boolean {
  try {
    return localStorage.getItem(OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() !== 'd') return;
  event.preventDefault();
  optedIn.value = !optedIn.value;
  if (!optedIn.value) isOpen.value = false;
  try {
    localStorage.setItem(OPT_IN_KEY, optedIn.value ? '1' : '0');
  } catch {
    // Opt-in is a convenience; a storage failure must not break the shortcut.
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

// Errors in the backend log stream. Only these warrant a badge — the previous
// badge counted every log line, so a healthy app advertised "7 problems".
const errorCount = computed(() => {
  return backend.logs.filter(log =>
    log.toLowerCase().includes('error') ||
    log.toLowerCase().includes('exception') ||
    log.toLowerCase().includes('traceback')
  ).length;
});

const hasErrors = computed(() => errorCount.value > 0);

function copyAllLogs() {
  const text = backend.logs.join('\n');
  navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function clearLogs() {
  backend.clearLogs();
}

// Auto-scroll to bottom when new logs arrive
watch(
  () => backend.logs.length,
  async () => {
    if (autoScroll.value && isOpen.value) {
      await nextTick();
      const scrollArea = document.querySelector('[data-debug-scroll]');
      if (scrollArea) {
        scrollArea.scrollTop = scrollArea.scrollHeight;
      }
    }
  }
);
</script>

<template>
  <Sheet v-if="isVisible" v-model:open="isOpen">
    <SheetTrigger as-child>
      <Button
        variant="outline"
        size="icon"
        class="fixed bottom-20 right-4 z-50 rounded-full shadow-lg"
        :class="{ 'bg-red-500/20 border-red-500': hasErrors }"
        aria-label="Backend logs"
        data-testid="debug-panel-trigger"
      >
        <Bug class="h-4 w-4" />
        <span
          v-if="hasErrors"
          class="absolute -top-1 -right-1 h-4 w-4 rounded-full text-[10px] flex items-center justify-center bg-red-500 text-white"
        >
          {{ errorCount > 99 ? '!' : errorCount }}
        </span>
      </Button>
    </SheetTrigger>

    <SheetContent side="right" class="w-[700px] sm:max-w-[700px] flex flex-col">
      <SheetHeader>
        <SheetTitle class="flex items-center gap-2">
          <Bug class="h-5 w-5" />
          Backend Logs
        </SheetTitle>
        <SheetDescription class="flex items-center gap-2">
          Status:
          <Badge
            :variant="backend.isRunning ? 'default' : 'secondary'"
            :class="{ 'bg-green-500': backend.isRunning, 'bg-red-500': backend.status === 'error' }"
          >
            {{ backend.status }}
          </Badge>
          <span class="text-muted-foreground">|</span>
          <span>{{ backend.logs.length }} lines</span>
        </SheetDescription>
      </SheetHeader>

      <!-- Toolbar -->
      <div class="flex items-center justify-between py-2 border-b">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="autoScroll" type="checkbox" class="rounded" />
          Auto-scroll
        </label>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="gap-2"
            :disabled="backend.logs.length === 0"
            @click="copyAllLogs"
          >
            <Check v-if="copied" class="h-4 w-4 text-green-500" />
            <Copy v-else class="h-4 w-4" />
            {{ copied ? 'Copied!' : 'Copy All' }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="gap-2"
            :disabled="backend.logs.length === 0"
            @click="clearLogs"
          >
            <Trash2 class="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      <!-- Logs -->
      <div class="flex-1 min-h-0 mt-2 overflow-hidden">
        <ScrollArea class="h-full w-full">
          <div class="space-y-0.5 font-mono text-xs pr-4">
            <div v-if="backend.logs.length === 0" class="text-center text-muted-foreground py-8">
              No logs yet. Backend logs will appear here.
            </div>

            <div
              v-for="(log, i) in backend.logs"
              :key="i"
              class="py-0.5 px-1 rounded break-words overflow-hidden"
              :class="{
                'bg-red-500/20 text-red-400': log.toLowerCase().includes('error') || log.toLowerCase().includes('exception') || log.toLowerCase().includes('traceback'),
                'bg-yellow-500/10 text-yellow-400': log.toLowerCase().includes('warning'),
                'text-muted-foreground': !log.toLowerCase().includes('error') && !log.toLowerCase().includes('warning') && !log.toLowerCase().includes('exception'),
              }"
            ><pre class="whitespace-pre-wrap break-words overflow-hidden m-0 font-mono text-xs">{{ log }}</pre></div>
          </div>
        </ScrollArea>
      </div>
    </SheetContent>
  </Sheet>
</template>
