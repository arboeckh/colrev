<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import type { RecordStatus } from '@/types/project';

const props = defineProps<{
  status: RecordStatus | string;
  size?: 'sm' | 'default';
}>();

// Map status to display text and variant
const statusConfig = computed(() => {
  const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    // Metadata states
    md_retrieved: { label: 'Retrieved', variant: 'outline' },
    md_imported: { label: 'Imported', variant: 'outline' },
    md_needs_manual_preparation: { label: 'Needs Prep', variant: 'destructive' },
    md_prepared: { label: 'Prepared', variant: 'secondary' },
    md_processed: { label: 'Processed', variant: 'default' },

    // Prescreen states
    rev_prescreen_excluded: { label: 'Pre-Excluded', variant: 'destructive' },
    rev_prescreen_included: { label: 'Pre-Included', variant: 'default' },

    // PDF states
    pdf_needs_manual_retrieval: { label: 'Needs PDF', variant: 'destructive' },
    pdf_imported: { label: 'PDF Imported', variant: 'secondary' },
    pdf_needs_manual_preparation: { label: 'PDF Needs Prep', variant: 'destructive' },
    pdf_prepared: { label: 'PDF Ready', variant: 'default' },

    // Screen states
    rev_excluded: { label: 'Excluded', variant: 'destructive' },
    rev_included: { label: 'Included', variant: 'default' },
    rev_synthesized: { label: 'Synthesized', variant: 'default' },
  };

  return configs[props.status] || { label: props.status, variant: 'outline' as const };
});
</script>

<template>
  <Badge
    :variant="statusConfig.variant"
    :class="[
      size === 'sm' ? 'text-[10px] px-1.5 py-0' : '',
    ]"
  >
    {{ statusConfig.label }}
  </Badge>
</template>
