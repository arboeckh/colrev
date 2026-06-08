<script setup lang="ts">
import { Workflow, Rocket, BookOpenCheck, GitMerge, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Screen"
    subtitle="Dual-reviewer full-text screening against inclusion criteria."
  >
    <div class="space-y-7">
      <HelpSection :icon="Workflow" title="Three-phase workflow">
        Full-text screening follows the same Launch → Review → Reconcile pattern as
        prescreen. Use the stepper at the top to switch phases. Each reviewer works
        through their own queue; reconciliation combines both sets of decisions.
      </HelpSection>

      <HelpSection :icon="Rocket" title="Launch phase">
        On the Launch tab, define screening criteria (or confirm those from
        Definition), resolve readiness blockers, pick two reviewers, and click
        <span class="text-ink-800 font-medium">Launch Screen Task</span>. Criteria
        are locked once a task is active — cancel and relaunch if you need to
        change them.
      </HelpSection>

      <HelpSection :icon="BookOpenCheck" title="Review phase">
        Each reviewer reads the PDF alongside the criteria checklist. Mark every
        criterion as <span class="text-ink-800 font-medium">In</span> or
        <span class="text-ink-800 font-medium">Out</span>, then confirm the
        overall <span class="text-ink-800 font-medium">Include</span> or
        <span class="text-ink-800 font-medium">Exclude</span> decision. The app
        advances to the next undecided record automatically. When done, continue
        to Reconciliation and use
        <span class="text-ink-800 font-medium">Save to remote</span> if
        collaborators cannot see your work yet.
      </HelpSection>

      <HelpSection :icon="GitMerge" title="Reconcile phase">
        After both reviewers finish, open the Reconcile tab and click
        <span class="text-ink-800 font-medium">Start Reconciliation</span>. Work
        through the walkthrough to resolve conflicts — criteria-level disagreements
        are shown alongside overall decisions. Export CSV or JSON audit logs after
        reconciliation completes.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        After reconciliation, click <span class="text-ink-800 font-medium">Next</span>
        to proceed to Data, where structured information is extracted from included
        records.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
