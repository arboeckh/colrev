<script setup lang="ts">
import { FileDown, Sparkles, Layers, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Preprocessing"
    subtitle="Load, prepare, and deduplicate raw search results into a clean dataset."
  >
    <div class="space-y-7">
      <HelpSection :icon="FileDown" title="Loading">
        Converts raw search files (RIS, BibTeX, …) into a unified record format stored in
        <code class="font-mono text-[12.5px] text-ink-700">records.bib</code>. Every record from
        every source receives a unique CoLRev ID.
      </HelpSection>

      <HelpSection :icon="Sparkles" title="Preparing">
        Cleans and standardises metadata — fixing field names, normalising author formatting,
        resolving journal abbreviations. Records that can't be prepared automatically are
        flagged for manual review.
      </HelpSection>

      <HelpSection :icon="Layers" title="Deduplicating">
        Identifies records that appear in multiple sources and merges them into a single
        canonical entry. Merged records retain provenance links to all original sources.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        Once deduplication is complete, click <span class="text-ink-800 font-medium">Next</span>
        to proceed to Prescreen where records are reviewed by title and abstract.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
