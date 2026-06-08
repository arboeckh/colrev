<script setup lang="ts">
import { Workflow, Rocket, Eye, GitMerge, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Prescreen"
    subtitle="Dual-reviewer title and abstract screening with reconciliation."
  >
    <div class="space-y-7">
      <HelpSection :icon="Workflow" title="Three-phase workflow">
        Prescreen runs as a managed dual-reviewer task. Use the stepper at the top
        to move between phases:
        <ol class="mt-2 space-y-1 list-decimal list-inside marker:text-ink-400">
          <li><span class="text-ink-800 font-medium">Launch</span> — set up the task and assign reviewers.</li>
          <li><span class="text-ink-800 font-medium">Review</span> — each reviewer screens independently.</li>
          <li><span class="text-ink-800 font-medium">Reconcile</span> — combine both reviewers' decisions and resolve disagreements.</li>
        </ol>
      </HelpSection>

      <HelpSection :icon="Rocket" title="Launch phase">
        On the Launch tab, resolve any readiness blockers shown on the page (for
        example unsaved changes or missing collaborators), pick two different
        reviewers, and click
        <span class="text-ink-800 font-medium">Launch Prescreen Task</span>.
        CoLRev sets up a separate screening queue for each reviewer and may fetch
        missing abstracts before screening begins.
      </HelpSection>

      <HelpSection :icon="Eye" title="Review phase">
        Each reviewer opens the Review tab — the app opens their assigned queue
        automatically. Work through records one at a time: read the title and
        abstract, then click
        <span class="text-ink-800 font-medium">Include</span> or
        <span class="text-ink-800 font-medium">Exclude</span>. Use the progress
        bar to jump between records. When finished, click
        <span class="text-ink-800 font-medium">Continue to Reconciliation</span>.
        If you are collaborating online, use
        <span class="text-ink-800 font-medium">Save to remote</span> so the other
        reviewer can see your progress.
      </HelpSection>

      <HelpSection :icon="GitMerge" title="Reconcile phase">
        Once both reviewers finish, open the Reconcile tab. Click
        <span class="text-ink-800 font-medium">Start Reconciliation</span> to walk
        through agreements and conflicts. CoLRev auto-resolves matching decisions
        and asks you to decide on disagreements. After reconciliation is applied,
        export an audit trail if needed.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        After reconciliation is complete, click
        <span class="text-ink-800 font-medium">Next</span> to proceed to PDFs,
        where full-text documents are retrieved and prepared for included records.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
