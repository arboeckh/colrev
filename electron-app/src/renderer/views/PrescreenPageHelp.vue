<script setup lang="ts">
import { Workflow, Rocket, Eye, GitMerge, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Prescreen"
    subtitle="Screen records for relevance based on title and abstract."
  >
    <div class="space-y-7">
      <HelpSection :icon="Workflow" title="How prescreen works">
        <ol class="space-y-1 list-decimal list-inside marker:text-ink-400">
          <li>Pick two reviewers — they each get their own branch.</li>
          <li>Both reviewers screen the same records in parallel.</li>
          <li>You reconcile their decisions on dev when they're done.</li>
        </ol>
      </HelpSection>

      <HelpSection :icon="Rocket" title="Launch phase">
        Set up a managed task from the Launch tab. Each reviewer gets a dedicated Git branch so
        decisions are isolated and tracked independently.
      </HelpSection>

      <HelpSection :icon="Eye" title="Review phase">
        Reviewers switch to their assigned branch and work through the queue — including or
        excluding each record by its title and abstract. Use the arrow keys or
        <span class="text-ink-800 font-medium">Include / Exclude</span> buttons to decide.
      </HelpSection>

      <HelpSection :icon="GitMerge" title="Reconcile phase">
        Once both reviewers finish, switch back to dev and open the Reconcile tab. CoLRev merges
        the two sets of decisions and flags any disagreements for manual resolution.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        After reconciliation, click <span class="text-ink-800 font-medium">Next</span> to proceed
        to PDFs where full-text documents are retrieved and prepared for included records.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
