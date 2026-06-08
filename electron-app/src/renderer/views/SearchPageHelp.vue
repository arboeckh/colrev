<script setup lang="ts">
import { Database, Play, AlertCircle, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Search"
    subtitle="Collect literature from databases and export files."
  >
    <div class="space-y-7">
      <HelpSection :icon="Database" title="Adding sources">
        Click <span class="text-ink-800 font-medium">Add Source</span> to open the
        gallery. Choose an API database to search live (for example PubMed or
        OpenAlex), or pick a manual-upload tile and import an export file (RIS,
        BibTeX, CSV, …). Each source is stored separately so you can run and
        re-run searches independently.
      </HelpSection>

      <HelpSection :icon="Play" title="Running searches">
        After adding at least one source, use
        <span class="text-ink-800 font-medium">Run All Searches</span> to query
        every configured API source, or run a single source from its card. Each
        source card shows how many records were retrieved.
      </HelpSection>

      <HelpSection :icon="AlertCircle" title="Sources needing attention">
        A source card is highlighted when it needs action — either because its
        query changed since the last run (stale), or because an API source has
        never been searched. Re-run those sources before moving on so preprocessing
        has complete data to work with.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        Once every source has been searched and none need attention, click
        <span class="text-ink-800 font-medium">Next</span> to proceed to
        Preprocessing, where raw results are loaded, cleaned, and deduplicated.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
