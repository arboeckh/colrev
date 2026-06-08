<script setup lang="ts">
import { Workflow, Rocket, BookOpenCheck, GitMerge, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Screen"
    subtitle="Screen full-text records against inclusion criteria."
  >
    <div class="space-y-7">
      <HelpSection :icon="Workflow" title="How screen works">
        <ol class="space-y-1 list-decimal list-inside marker:text-ink-400">
          <li>Pick two reviewers — they each get their own branch.</li>
          <li>Both reviewers screen the same records in parallel.</li>
          <li>You reconcile their decisions on dev when they're done.</li>
        </ol>
      </HelpSection>

      <HelpSection :icon="Rocket" title="Launch phase">
        Define inclusion and exclusion criteria on the Launch tab, then create a managed task.
        Each reviewer gets a dedicated Git branch. Criteria are frozen once a task is active.
      </HelpSection>

      <HelpSection :icon="BookOpenCheck" title="Review phase">
        Reviewers switch to their assigned branch and screen records against the criteria while
        viewing the full PDF. Each criterion is marked in or out; the overall decision is
        derived automatically when all criteria are resolved.
      </HelpSection>

      <HelpSection :icon="GitMerge" title="Reconcile phase">
        Once both reviewers finish, switch back to dev and open the Reconcile tab. CoLRev merges
        the two sets of decisions and flags disagreements for manual resolution.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        After reconciliation, click <span class="text-ink-800 font-medium">Next</span> to proceed
        to Data where structured information is extracted from the included records.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
