<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>Prescreen</SheetTitle>
    <SheetDescription>Screen records for relevance based on title and abstract.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">How prescreen works</h3>
      <ol class="text-muted-foreground space-y-1 list-decimal list-inside">
        <li>Pick two reviewers — they each get their own branch.</li>
        <li>Both reviewers screen the same records in parallel.</li>
        <li>You reconcile their decisions on dev when they're done.</li>
      </ol>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Launch phase</h3>
      <p class="text-muted-foreground">
        Set up a managed task from the Launch tab. Each reviewer gets a dedicated Git branch
        so decisions are isolated and tracked independently.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Review phase</h3>
      <p class="text-muted-foreground">
        Reviewers switch to their assigned branch and work through the queue — including or
        excluding each record based on its title and abstract. Use the arrow keys or
        Include / Exclude buttons to decide.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Reconcile phase</h3>
      <p class="text-muted-foreground">
        Once both reviewers finish, switch back to dev and open the Reconcile tab. CoLRev
        merges the two sets of decisions and flags any disagreements for manual resolution.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Moving forward</h3>
      <p class="text-muted-foreground">
        After reconciliation, click <strong>Next</strong> to proceed to PDFs where full-text
        documents are retrieved and prepared for included records.
      </p>
    </section>
  </div>
</template>
