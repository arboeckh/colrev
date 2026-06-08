<script setup lang="ts">
import { Link, Target, ListChecks, RefreshCw } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Definition"
    subtitle="Set the scope and criteria for your systematic review."
  >
    <div class="space-y-7">
      <HelpSection :icon="Link" title="Protocol URL">
        Link to your pre-registered protocol (for example, a PROSPERO registration). This
        provides a public, timestamped record of your review plan before data collection
        begins.
      </HelpSection>

      <HelpSection :icon="Target" title="Research question & objectives">
        Describe what you are trying to find out. A well-defined research question guides
        every subsequent step — what you search for, how you screen, and what data you
        extract.
      </HelpSection>

      <HelpSection :icon="ListChecks" title="Inclusion & exclusion criteria">
        Criteria are applied during prescreen and screen decisions. Add them here so reviewers
        share a single reference. Changes after screening has started should be documented
        carefully to maintain review integrity.
      </HelpSection>

      <HelpSection :icon="RefreshCw" title="Revisiting this page">
        Definition is a reference document, not a gate. Return any time to refine objectives
        or update criteria. Click <span class="text-ink-800 font-medium">Save changes</span>
        after edits to commit them to the project.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
