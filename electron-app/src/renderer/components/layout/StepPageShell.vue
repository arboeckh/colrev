<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, AlertCircle, HelpCircle, ChevronRight } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useProjectsStore } from '@/stores/projects';
import { resolveNextStepRoute } from '@/lib/stepPageShell';
import type { WorkflowStep } from '@/types/project';
import type { Component } from 'vue';

const props = defineProps<{
  step: WorkflowStep | null;
  subtitle: string;
  pageHelp: Component;
  nextOverride?: string;
}>();

const projects = useProjectsStore();
const route = useRoute();
const router = useRouter();

const isHelpOpen = ref(false);

const stepStatus = computed(() =>
  props.step ? projects.getStepStatus(props.step) : null,
);

const title = computed(() => (route.meta.title as string | undefined) ?? '');

const nextRoute = computed(() =>
  resolveNextStepRoute(props.step, projects.currentProjectId ?? null, props.nextOverride),
);

watch(route, () => {
  isHelpOpen.value = false;
});

function goNext() {
  if (nextRoute.value) {
    router.push(nextRoute.value);
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Shell header -->
    <div
      class="flex items-center justify-between px-6 py-4 border-b shrink-0"
      data-testid="step-page-shell-header"
    >
      <!-- Left: status circle + title block + help button -->
      <div class="flex items-center gap-4">
        <!-- Status circle (omitted when step === null) -->
        <div
          v-if="step && stepStatus"
          class="flex h-6 w-6 items-center justify-center rounded-full border-2 shrink-0 transition-all"
          :class="[
            stepStatus === 'complete'
              ? 'border-eucalyptus-600 bg-eucalyptus-600 text-cream-50'
              : stepStatus === 'active'
                ? 'border-eucalyptus-700 bg-card text-eucalyptus-700'
                : stepStatus === 'warning'
                  ? 'border-amber-accent bg-amber-accent text-cream-50'
                  : 'border-ink-200 bg-card',
          ]"
          data-testid="step-status-circle"
          :data-step-status="stepStatus"
        >
          <Check v-if="stepStatus === 'complete'" class="h-3.5 w-3.5" />
          <AlertCircle v-else-if="stepStatus === 'warning'" class="h-3.5 w-3.5" />
          <div v-else-if="stepStatus === 'active'" class="h-2 w-2 rounded-full bg-current" />
        </div>

        <!-- Title + subtitle -->
        <div>
          <h2 class="text-xl font-bold leading-tight" data-testid="page-title">{{ title }}</h2>
          <p class="text-sm text-muted-foreground" data-testid="page-subtitle">{{ subtitle }}</p>
        </div>

        <!-- Help button -->
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid="help-button"
          @click="isHelpOpen = true"
        >
          <HelpCircle class="h-4 w-4" />
          Help
        </Button>
      </div>

      <!-- Right: Next button (always enabled when next route exists) -->
      <Button
        v-if="nextRoute"
        data-testid="next-button"
        @click="goNext"
      >
        Next
        <ChevronRight class="h-4 w-4 ml-1" />
      </Button>
    </div>

    <!-- Page body -->
    <div class="flex-1 overflow-auto">
      <slot />
    </div>

    <!-- Help sheet -->
    <Sheet v-model:open="isHelpOpen">
      <SheetContent side="right" class="w-[520px] sm:max-w-[520px] overflow-y-auto">
        <component :is="pageHelp" />
      </SheetContent>
    </Sheet>
  </div>
</template>
