<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
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

// Check if there are any errors in the logs
const hasErrors = computed(() => {
  return backend.logs.some(log =>
    log.toLowerCase().includes('error') ||
    log.toLowerCase().includes('exception') ||
    log.toLowerCase().includes('traceback')
  );
});

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
  <Sheet v-model:open="isOpen">
    <SheetTrigger as-child>
      <Button
        variant="outline"
        size="icon"
        class="fixed bottom-4 right-4 z-50 rounded-full shadow-lg"
        :class="{ 'animate-pulse bg-red-500/20 border-red-500': hasErrors }"
      >
        <Bug class="h-4 w-4" />
        <span
          v-if="backend.logs.length > 0"
          class="absolute -top-1 -right-1 h-4 w-4 rounded-full text-[10px] flex items-center justify-center"
          :class="hasErrors ? 'bg-red-500 text-white' : 'bg-primary text-primary-foreground'"
        >
          {{ backend.logs.length > 99 ? '!' : backend.logs.length }}
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
