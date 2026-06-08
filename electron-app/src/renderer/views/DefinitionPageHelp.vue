<script setup lang="ts">
import { FileText, Target, ListChecks, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Definition"
    subtitle="Document your review scope before searching and screening."
  >
    <div class="space-y-7">
      <HelpSection :icon="FileText" title="What to do here">
        Fill in your protocol link, research question, and screening criteria before
        you start searching. This page is a living reference — not a gate — but
        having a clear definition early keeps the rest of the pipeline focused.
        Click <span class="text-ink-800 font-medium">Save changes</span> after edits
        to save them to the project.
      </HelpSection>

      <HelpSection :icon="Target" title="Protocol &amp; objectives">
        Add a <span class="text-ink-800 font-medium">Protocol URL</span> (for
        example a PROSPERO registration) and describe your research question and
        objectives in the rich-text editor. These guide what you search for, how
        you screen, and what data you extract later.
      </HelpSection>

      <HelpSection :icon="ListChecks" title="Inclusion &amp; exclusion criteria">
        Define criteria in the sidebar. They are applied during full-text
        <span class="text-ink-800 font-medium">Screen</span> — each criterion is
        marked in or out per record. You can also add or edit screening criteria
        on the Screen Launch tab before starting a managed screen task. Changes
        after screening has started should be documented carefully.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        When your definition is in place, click
        <span class="text-ink-800 font-medium">Next</span> to set up literature
        searches. You can return here any time to refine objectives or update
        criteria.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
