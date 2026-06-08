<script setup lang="ts">
import { Database, Play, RefreshCw, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Search"
    subtitle="Configure and run literature searches across multiple databases."
  >
    <div class="space-y-7">
      <HelpSection :icon="Database" title="Adding sources">
        Click <span class="text-ink-800 font-medium">Add Source</span> to connect a database
        (PubMed, Crossref, EBSCO, …). Each source stores its results in a separate file so
        searches can be run and re-run independently.
      </HelpSection>

      <HelpSection :icon="Play" title="Running searches">
        Use <span class="text-ink-800 font-medium">Run All Searches</span> to query every
        configured source at once, or run sources individually. Results are fetched live and
        written to <code class="font-mono text-[12.5px] text-ink-700">data/search/</code>.
      </HelpSection>

      <HelpSection :icon="RefreshCw" title="Stale sources">
        A source becomes stale when its query changes after the last run. Stale sources are
        highlighted on their card — re-run them to bring results up to date before moving on.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        Once all sources have been searched and none are stale, the Search step is complete.
        Click <span class="text-ink-800 font-medium">Next</span> to proceed to Preprocessing.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
