<script setup lang="ts">
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-vue-next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface DisplayRecord {
  id: string;
  title?: string;
  author?: string;
  year?: string | number;
  journal?: string;
  booktitle?: string;
  abstract?: string;
  _enrichmentStatus?: 'pending' | 'loading' | 'complete' | 'failed';
}

withDefaults(
  defineProps<{
    record: DisplayRecord;
    canPrev?: boolean;
    canNext?: boolean;
    testIdPrefix?: string;
  }>(),
  {
    canPrev: false,
    canNext: false,
    testIdPrefix: 'prescreen',
  },
);

const emit = defineEmits<{
  (e: 'prev'): void;
  (e: 'next'): void;
}>();
</script>

<template>
  <Card
    class="flex-1 flex flex-col min-h-0 border-0 shadow-none"
    :data-testid="`${testIdPrefix}-record-card`"
  >
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <Badge variant="outline" class="font-mono" :data-testid="`${testIdPrefix}-record-id`">
          {{ record.id }}
        </Badge>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="!canPrev"
            :data-testid="`${testIdPrefix}-btn-previous`"
            @click="emit('prev')"
          >
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="!canNext"
            :data-testid="`${testIdPrefix}-btn-next`"
            @click="emit('next')"
          >
            <ChevronRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
      <CardTitle
        class="text-lg leading-tight break-words"
        :data-testid="`${testIdPrefix}-record-title`"
      >
        {{ record.title || 'Untitled record' }}
      </CardTitle>
      <CardDescription>
        <span>{{ record.author || 'Unknown author' }}<span v-if="record.year"> ({{ record.year }})</span></span>
        <span v-if="record.journal" class="block">{{ record.journal }}</span>
        <span v-else-if="record.booktitle" class="block">{{ record.booktitle }}</span>
      </CardDescription>
    </CardHeader>

    <CardContent class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <h4 class="text-sm font-medium mb-2">Abstract</h4>
      <ScrollArea class="flex-1 pr-4">
        <div
          v-if="record._enrichmentStatus === 'loading'"
          class="space-y-3 max-w-prose"
        >
          <div class="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            <Loader2 class="h-4 w-4 animate-spin" />
            <span>Fetching abstract from external sources...</span>
          </div>
          <div class="space-y-2.5 animate-pulse">
            <div class="h-3.5 bg-muted rounded w-full" />
            <div class="h-3.5 bg-muted rounded w-full" />
            <div class="h-3.5 bg-muted rounded w-[95%]" />
            <div class="h-3.5 bg-muted rounded w-full" />
            <div class="h-3.5 bg-muted rounded w-[88%]" />
            <div class="h-3.5 bg-muted rounded w-full" />
            <div class="h-3.5 bg-muted rounded w-[70%]" />
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground whitespace-pre-wrap max-w-prose">
          {{ record.abstract || 'No abstract available' }}
        </p>
      </ScrollArea>
    </CardContent>
  </Card>
</template>
