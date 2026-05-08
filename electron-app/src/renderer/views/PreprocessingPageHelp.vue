<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>Preprocessing</SheetTitle>
    <SheetDescription>Load, prepare, and deduplicate raw search results into a clean dataset.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">Loading</h3>
      <p class="text-muted-foreground">
        The Load stage converts raw search result files (RIS, BibTeX, etc.) into a unified record
        format stored in the project's <code class="font-mono">records.bib</code> file. Every
        record from every source gets a unique CoLRev ID.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Preparing</h3>
      <p class="text-muted-foreground">
        The Prep stage cleans and standardises metadata — fixing field names, normalising author
        formatting, and resolving journal abbreviations. Records that can't be prepared automatically
        are flagged for manual review.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Deduplicating</h3>
      <p class="text-muted-foreground">
        The Dedupe stage identifies records that appear in multiple sources and merges them into a
        single canonical entry. Merged records retain provenance links to all original sources.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Moving forward</h3>
      <p class="text-muted-foreground">
        Once deduplication is complete, click <strong>Next</strong> to proceed to Prescreen where
        records are reviewed based on title and abstract.
      </p>
    </section>
  </div>
</template>
