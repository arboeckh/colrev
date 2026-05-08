<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>Overview</SheetTitle>
    <SheetDescription>Your review's current state and publishing status at a glance.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">Funnel diagram</h3>
      <p class="text-muted-foreground">
        The funnel shows how records progress through each stage of the review pipeline —
        from initial search results through prescreening, full-text screening, and data
        extraction. Numbers reflect the active working branch, not the published version.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Publishing model</h3>
      <p class="text-muted-foreground">
        CoLRev keeps your work on a <code class="font-mono">dev</code> branch. When you're
        ready to mark a stable checkpoint, publish a version — this merges
        <code class="font-mono">dev</code> into <code class="font-mono">main</code> and
        makes your results available to collaborators and citation tools.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Releases</h3>
      <p class="text-muted-foreground">
        A release is a permanent, citable snapshot of your review on GitHub (e.g.
        <code class="font-mono">v1.0</code>). Create a release after publishing when you
        want to produce a version you can link to in a paper or report. Minor releases
        cover incremental updates; major releases signal significant new versions.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Continue button</h3>
      <p class="text-muted-foreground">
        The <strong>Continue to …</strong> button in the top-right takes you directly to
        the step that needs attention next, based on the current state of your records.
      </p>
    </section>
  </div>
</template>
