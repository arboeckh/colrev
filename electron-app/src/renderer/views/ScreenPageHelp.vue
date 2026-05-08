<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>Screen</SheetTitle>
    <SheetDescription>Screen full-text records against inclusion criteria.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">How screen works</h3>
      <ol class="text-muted-foreground space-y-1 list-decimal list-inside">
        <li>Pick two reviewers — they each get their own branch.</li>
        <li>Both reviewers screen the same records in parallel.</li>
        <li>You reconcile their decisions on dev when they're done.</li>
      </ol>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Launch phase</h3>
      <p class="text-muted-foreground">
        Define inclusion and exclusion criteria on the Launch tab, then create a managed task.
        Each reviewer gets a dedicated Git branch. Criteria are frozen once a task is active.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Review phase</h3>
      <p class="text-muted-foreground">
        Reviewers switch to their assigned branch and screen records against the criteria while
        viewing the full PDF. Each criterion is marked in or out; the overall decision is derived
        automatically when all criteria are resolved.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Reconcile phase</h3>
      <p class="text-muted-foreground">
        Once both reviewers finish, switch back to dev and open the Reconcile tab. CoLRev
        merges the two sets of decisions and flags disagreements for manual resolution.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Moving forward</h3>
      <p class="text-muted-foreground">
        After reconciliation, click <strong>Next</strong> to proceed to Data where structured
        information is extracted from the included full-text records.
      </p>
    </section>
  </div>
</template>
