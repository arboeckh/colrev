<script setup lang="ts">
import { Play, FileDown, Sparkles, Layers, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Preprocessing"
    subtitle="Turn raw search results into a clean, deduplicated dataset."
  >
    <div class="space-y-7">
      <HelpSection :icon="Play" title="What to do here">
        Click <span class="text-ink-800 font-medium">Run preprocessing</span> to
        process all search sources in one pass. The flow diagram shows your sources
        on the left, three processing stages in the middle, and the final record
        count on the right. You can run again any time new search results arrive.
      </HelpSection>

      <HelpSection :icon="FileDown" title="Loading">
        Converts raw search files into a unified record format. Every record from
        every source receives a unique CoLRev ID.
      </HelpSection>

      <HelpSection :icon="Sparkles" title="Preparing">
        Cleans and standardises metadata — fixing field names, normalising author
        formatting, and resolving journal abbreviations. Records that cannot be
        prepared automatically are flagged for manual review.
      </HelpSection>

      <HelpSection :icon="Layers" title="Deduplicating">
        Identifies records that appear in multiple sources and merges them into a
        single canonical entry while keeping provenance links to all original
        sources. After deduplication completes, use
        <span class="text-ink-800 font-medium">View</span> to inspect the dataset
        and fix any records that need attention.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        When preprocessing is complete and you are satisfied with the dataset, click
        <span class="text-ink-800 font-medium">Next</span> to proceed to Prescreen,
        where records are reviewed by title and abstract.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
