<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>Definition</SheetTitle>
    <SheetDescription>Set the scope and criteria for your systematic review.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">Protocol URL</h3>
      <p class="text-muted-foreground">
        Link to your pre-registered protocol (e.g., a PROSPERO registration). This provides a
        public, timestamped record of your review plan before data collection begins.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Research question &amp; objectives</h3>
      <p class="text-muted-foreground">
        Describe what you are trying to find out. A well-defined research question guides every
        subsequent step — what you search for, how you screen, and what data you extract.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Inclusion &amp; exclusion criteria</h3>
      <p class="text-muted-foreground">
        Criteria are applied during prescreen and screen decisions. Add them here so reviewers
        have a shared reference. Changes to criteria after screening has started should be
        documented carefully to maintain review integrity.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Revisiting this page</h3>
      <p class="text-muted-foreground">
        Definition is a reference document, not a gate. You can return here at any time to refine
        your objectives or update criteria. Click <strong>Save changes</strong> after any edits to
        commit them to the project.
      </p>
    </section>
  </div>
</template>
