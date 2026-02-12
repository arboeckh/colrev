<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import type { ScreenCriterionDefinition } from '@/types/api';

const props = defineProps<{
  criteria: Record<string, ScreenCriterionDefinition>;
  decisions: Record<string, 'in' | 'out' | 'TODO'>;
}>();

const emit = defineEmits<{
  toggle: [name: string, value: 'in' | 'out' | 'TODO'];
}>();

const inclusionCriteria = computed(() =>
  Object.entries(props.criteria).filter(([, c]) => c.criterion_type !== 'exclusion_criterion')
);

const exclusionCriteria = computed(() =>
  Object.entries(props.criteria).filter(([, c]) => c.criterion_type === 'exclusion_criterion')
);

function handleToggle(name: string) {
  const current = props.decisions[name] || 'TODO';
  const criterion = props.criteria[name];
  const isExclusion = criterion?.criterion_type === 'exclusion_criterion';
  if (current === 'TODO') {
    emit('toggle', name, isExclusion ? 'out' : 'in');
  } else {
    emit('toggle', name, 'TODO');
  }
}
</script>

<template>
  <div class="space-y-4" data-testid="screen-criteria-checklist">
    <!-- Inclusion criteria -->
    <div v-if="inclusionCriteria.length > 0">
      <h5 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Inclusion</h5>
      <div class="space-y-1.5">
        <div
          v-for="[name, criterion] in inclusionCriteria"
          :key="name"
          class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors"
          :class="decisions[name] === 'in' ? 'bg-green-600/15 border border-green-600/30' : 'bg-muted/50 hover:bg-muted'"
          :data-testid="`criterion-check-${name}`"
          @click="handleToggle(name)"
        >
          <span class="text-sm font-medium flex-1">{{ name }}</span>
          <Badge
            v-if="decisions[name] === 'in'"
            variant="default"
            class="text-xs bg-green-600 shrink-0"
          >Met</Badge>
          <p v-if="criterion.explanation" class="hidden" />
        </div>
      </div>
    </div>

    <!-- Exclusion criteria -->
    <div v-if="exclusionCriteria.length > 0">
      <h5 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Exclusion</h5>
      <div class="space-y-1.5">
        <div
          v-for="[name, criterion] in exclusionCriteria"
          :key="name"
          class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors"
          :class="decisions[name] === 'out' ? 'bg-destructive/15 border border-destructive/30' : 'bg-muted/50 hover:bg-muted'"
          :data-testid="`criterion-check-${name}`"
          @click="handleToggle(name)"
        >
          <span class="text-sm font-medium flex-1">{{ name }}</span>
          <Badge
            v-if="decisions[name] === 'out'"
            variant="destructive"
            class="text-xs shrink-0"
          >Applies</Badge>
          <p v-if="criterion.explanation" class="hidden" />
        </div>
      </div>
    </div>
  </div>
</template>
