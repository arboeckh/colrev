<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>Search</SheetTitle>
    <SheetDescription>Configure and run literature searches across multiple databases.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">Adding sources</h3>
      <p class="text-muted-foreground">
        Click <strong>Add Source</strong> to connect a database (e.g. PubMed, Crossref, EBSCO).
        Each source stores its search results in a separate file so searches can be run and
        re-run independently.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Running searches</h3>
      <p class="text-muted-foreground">
        Use <strong>Run All Searches</strong> to query every configured source at once, or run
        individual sources from their card. Results are fetched live from the database API and
        written to the project's <code class="font-mono">data/search/</code> folder.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Stale sources</h3>
      <p class="text-muted-foreground">
        A source becomes stale when its search query changes after the last run. Stale sources
        are highlighted on their card — re-run them to bring results up to date before moving
        to the next step.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Moving forward</h3>
      <p class="text-muted-foreground">
        Once all sources have been searched and none are stale, the Search step is complete.
        Click <strong>Next</strong> to proceed to Preprocessing where records are loaded,
        prepared, and deduplicated.
      </p>
    </section>
  </div>
</template>
