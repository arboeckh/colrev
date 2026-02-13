<script setup lang="ts">
import {
  CheckSquare,
  Check,
  X,
  Loader2,
  ArrowRight,
  Pencil,
  Settings2,
} from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ScreenCriteriaChecklist from './ScreenCriteriaChecklist.vue';
import ScreenProgressBar from './ScreenProgressBar.vue';
import type { ScreenQueueRecord, ScreenCriterionDefinition } from '@/types/api';

type DecisionState = 'undecided' | 'included' | 'excluded';

defineProps<{
  record: ScreenQueueRecord & { _decision: DecisionState; _criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'> };
  criteria: Record<string, ScreenCriterionDefinition>;
  criteriaDecisions: Record<string, 'in' | 'out' | 'TODO'>;
  hasCriteria: boolean;
  // Header props
  decidedCount: number;
  includedCount: number;
  excludedCount: number;
  totalCount: number;
  // Decision props
  isDeciding: boolean;
  isCurrentDecided: boolean;
  derivedDecision: 'include' | 'exclude' | null;
  canSubmitCriteria: boolean;
  nextUndecidedIndex: number;
  mode: 'screening' | 'edit' | 'complete';
  // Progress bar props
  queueRecords: Array<{ id: string; _decision: DecisionState }>;
  currentIndex: number;
  // Read-only mode (main branch)
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  toggleCriterion: [name: string, value: 'in' | 'out' | 'TODO'];
  makeDecision: [decision: 'include' | 'exclude'];
  submitCriteriaDecision: [];
  skipToNextUndecided: [];
  enterEditMode: [];
  showCriteriaDialog: [];
  navigate: [index: number];
}>();
</script>

<template>
  <div class="h-full flex flex-col" data-testid="screen-record-panel">
    <!-- Header row -->
    <div class="px-3 py-2 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-2">
        <CheckSquare class="h-4 w-4 text-muted-foreground" />
        <h2 class="text-sm font-semibold" data-testid="screen-title">Screen</h2>
      </div>

      <div class="flex items-center gap-2">
        <Badge variant="secondary" class="px-2 py-0.5 text-xs" data-testid="screen-included-count">
          <Check class="h-3 w-3 mr-1" />
          {{ includedCount }}
        </Badge>
        <Badge variant="outline" class="px-2 py-0.5 text-xs" data-testid="screen-excluded-count">
          <X class="h-3 w-3 mr-1" />
          {{ excludedCount }}
        </Badge>
        <Badge variant="secondary" class="px-2 py-0.5 text-xs" data-testid="screen-remaining-count">
          {{ totalCount }} left
        </Badge>

        <Button variant="ghost" size="icon" class="h-7 w-7" data-testid="screen-manage-criteria-btn"
          @click="emit('showCriteriaDialog')">
          <Settings2 class="h-3.5 w-3.5" />
        </Button>

        <Button v-if="decidedCount > 0 && !readOnly" variant="ghost" size="icon" class="h-7 w-7" data-testid="screen-edit-mode-btn"
          @click="emit('enterEditMode')">
          <Pencil class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <Separator />

    <!-- Decision bar -->
    <div class="flex items-center justify-center gap-3 px-3 py-2 shrink-0" data-testid="screen-decision-bar">
      <!-- Undecided: show buttons -->
      <template v-if="!isCurrentDecided">
        <!-- No criteria mode: simple include/exclude -->
        <template v-if="!hasCriteria">
          <Button variant="destructive" size="sm" class="min-w-[100px] h-8" data-testid="screen-btn-exclude"
            :disabled="isDeciding || readOnly" @click="emit('makeDecision', 'exclude')">
            <Loader2 v-if="isDeciding" class="h-4 w-4 mr-1.5 animate-spin" />
            <X v-else class="h-4 w-4 mr-1.5" />
            Exclude
            <kbd class="ml-1.5 text-xs opacity-60 bg-white/20 px-1 py-0.5 rounded">&larr;</kbd>
          </Button>

          <Button size="sm" class="min-w-[100px] h-8 bg-green-600 hover:bg-green-700 text-white"
            data-testid="screen-btn-include" :disabled="isDeciding || readOnly" @click="emit('makeDecision', 'include')">
            <Loader2 v-if="isDeciding" class="h-4 w-4 mr-1.5 animate-spin" />
            <Check v-else class="h-4 w-4 mr-1.5" />
            Include
            <kbd class="ml-1.5 text-xs opacity-60 bg-white/20 px-1 py-0.5 rounded">&rarr;</kbd>
          </Button>
        </template>

        <!-- Criteria mode: submit derived decision -->
        <template v-else>
          <Button v-if="derivedDecision" size="sm" class="min-w-[120px] h-8" :class="derivedDecision === 'include'
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-destructive hover:bg-destructive/90 text-white'
            " data-testid="screen-btn-submit-criteria" :disabled="!canSubmitCriteria || isDeciding || readOnly"
            @click="emit('submitCriteriaDecision')">
            <Loader2 v-if="isDeciding" class="h-4 w-4 mr-1.5 animate-spin" />
            <Check v-else-if="derivedDecision === 'include'" class="h-4 w-4 mr-1.5" />
            <X v-else class="h-4 w-4 mr-1.5" />
            {{ derivedDecision === 'include' ? 'Include' : 'Exclude' }}
          </Button>
          <span v-else class="text-xs text-muted-foreground">
            Evaluate all criteria to submit
          </span>
        </template>
      </template>

      <!-- Decided: show indicator -->
      <template v-else>
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm" :class="record._decision === 'included'
          ? 'bg-green-600/15 text-green-500 border border-green-600/30'
          : 'bg-destructive/15 text-red-400 border border-destructive/30'
          " data-testid="screen-decision-indicator">
          <Check v-if="record._decision === 'included'" class="h-4 w-4" />
          <X v-else class="h-4 w-4" />
          <span class="font-medium">
            {{ record._decision === 'included' ? 'Included' : 'Excluded' }}
          </span>
        </div>

        <Button v-if="nextUndecidedIndex !== -1" variant="outline" size="sm" data-testid="screen-btn-skip-to-undecided"
          @click="emit('skipToNextUndecided')">
          <ArrowRight class="h-4 w-4 mr-1" />
          Next
        </Button>
      </template>
    </div>

    <!-- Progress bar -->
    <ScreenProgressBar :records="queueRecords" :current-index="currentIndex" class="px-3 mb-4 shrink-0"
      @navigate="(index) => emit('navigate', index)" />

    <Separator />

    <!-- Record ID + title -->
    <div class="px-3 py-2 flex items-center gap-2 min-w-0 shrink-0">
      <Badge variant="outline" class="font-mono text-xs shrink-0" data-testid="screen-record-id">
        {{ record.id }}
      </Badge>
      <span class="text-sm font-medium truncate" data-testid="screen-record-title">
        {{ record.title }}
      </span>
    </div>

    <Separator />

    <!-- Tabs -->
    <Tabs :default-value="hasCriteria ? 'criteria' : 'details'" class="flex-1 flex flex-col min-h-0">
      <TabsList class="mx-3 mt-2 shrink-0">
        <TabsTrigger v-if="hasCriteria" value="criteria" data-testid="screen-tab-criteria">
          Criteria
        </TabsTrigger>
        <TabsTrigger value="details" data-testid="screen-tab-details">
          Details
        </TabsTrigger>
      </TabsList>

      <!-- Criteria tab -->
      <TabsContent v-if="hasCriteria" value="criteria" class="flex-1 min-h-0 overflow-auto px-3 pb-3">
        <ScreenCriteriaChecklist :criteria="criteria" :decisions="criteriaDecisions"
          @toggle="(name, value) => emit('toggleCriterion', name, value)" />
      </TabsContent>

      <!-- Details tab -->
      <TabsContent value="details" class="flex-1 min-h-0 overflow-auto px-3 pb-3">
        <div class="space-y-3">
          <div>
            <h4 class="text-sm font-semibold leading-tight">{{ record.title }}</h4>
            <p class="text-sm text-muted-foreground mt-1">
              {{ record.author }} ({{ record.year }})
            </p>
            <p v-if="record.journal" class="text-sm text-muted-foreground">
              {{ record.journal }}
            </p>
            <p v-else-if="record.booktitle" class="text-sm text-muted-foreground">
              {{ record.booktitle }}
            </p>
          </div>

          <Separator />

          <div>
            <h4 class="text-sm font-medium mb-1">Abstract</h4>
            <p class="text-sm text-muted-foreground whitespace-pre-wrap">
              {{ record.abstract || 'No abstract available' }}
            </p>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
