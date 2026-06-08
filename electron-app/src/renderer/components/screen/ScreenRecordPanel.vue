<script setup lang="ts">
import {
  CheckSquare,
  Check,
  X,
  Pencil,
} from 'lucide-vue-next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ScreenCriteriaChecklist from './ScreenCriteriaChecklist.vue';
import ScreenCriteriaDecisionButtons from './ScreenCriteriaDecisionButtons.vue';
import ScreenProgressBar from './ScreenProgressBar.vue';
import type { ScreenQueueRecord, ScreenCriterionDefinition } from '@/types/api';
import type { CriterionDecision } from '@/lib/screen-decision';

type DecisionState = 'undecided' | 'included' | 'excluded';

defineProps<{
  record: ScreenQueueRecord & { _decision: DecisionState; _criteriaDecisions: Record<string, CriterionDecision> };
  criteria: Record<string, ScreenCriterionDefinition>;
  criteriaDecisions: Record<string, CriterionDecision>;
  hasCriteria: boolean;
  decidedCount: number;
  includedCount: number;
  excludedCount: number;
  totalCount: number;
  isDeciding: boolean;
  isCurrentDecided: boolean;
  nextUndecidedIndex: number;
  mode: 'screening' | 'edit' | 'complete';
  queueRecords: Array<{ id: string; _decision: DecisionState }>;
  currentIndex: number;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  toggleCriterion: [name: string, value: CriterionDecision];
  confirmDecision: [decision: 'include' | 'exclude'];
  skipToNextUndecided: [];
  enterEditMode: [];
  navigate: [index: number];
}>();
</script>

<template>
  <div class="h-full flex flex-col min-h-0" data-testid="screen-record-panel">
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

        <Button
          v-if="decidedCount > 0 && !readOnly"
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          data-testid="screen-edit-mode-btn"
          @click="emit('enterEditMode')"
        >
          <Pencil class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <Separator />

    <ScreenProgressBar
      :records="queueRecords"
      :current-index="currentIndex"
      class="px-3 my-3 shrink-0"
      @navigate="(index) => emit('navigate', index)"
    />

    <Separator />

    <div class="px-3 py-2 flex items-center gap-2 min-w-0 shrink-0">
      <Badge variant="outline" class="font-mono text-xs shrink-0" data-testid="screen-record-id">
        {{ record.id }}
      </Badge>
      <span class="text-sm font-medium truncate" data-testid="screen-record-title">
        {{ record.title }}
      </span>
    </div>

    <Separator />

    <Tabs default-value="criteria" class="flex-1 flex flex-col min-h-0">
      <TabsList class="mx-3 mt-2 shrink-0">
        <TabsTrigger value="criteria" data-testid="screen-tab-criteria">
          Criteria
        </TabsTrigger>
        <TabsTrigger value="details" data-testid="screen-tab-details">
          Details
        </TabsTrigger>
      </TabsList>

      <TabsContent value="criteria" class="flex-1 min-h-0 flex flex-col mt-0 data-[state=inactive]:hidden">
        <div class="flex-1 min-h-0 overflow-auto px-3 py-3">
          <ScreenCriteriaChecklist
            :criteria="criteria"
            :decisions="criteriaDecisions"
            @toggle="(name, value) => emit('toggleCriterion', name, value)"
          />
        </div>
      </TabsContent>

      <TabsContent value="details" class="flex-1 min-h-0 overflow-auto px-3 pb-3 mt-0 data-[state=inactive]:hidden">
        <div class="space-y-3 pt-3">
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

    <ScreenCriteriaDecisionButtons
      :criteria="criteria"
      :decisions="criteriaDecisions"
      :confirmed-decision="
        isCurrentDecided
          ? record._decision === 'included'
            ? 'include'
            : 'exclude'
          : null
      "
      :is-submitting="isDeciding"
      :disabled="readOnly"
      :show-next-button="isCurrentDecided && nextUndecidedIndex !== -1"
      test-id-prefix="screen"
      @confirm="(decision) => emit('confirmDecision', decision)"
      @skip-to-next="emit('skipToNextUndecided')"
    />
  </div>
</template>
