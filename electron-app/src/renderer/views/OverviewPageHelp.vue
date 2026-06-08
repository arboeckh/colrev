<script setup lang="ts">
import { Filter, GitBranch, Tag, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Overview"
    subtitle="Your review's current state and publishing status at a glance."
  >
    <div class="space-y-7">
      <HelpSection :icon="Filter" title="Funnel diagram">
        Shows how records progress through each stage of the review pipeline — from initial
        search results through prescreening, full-text screening, and data extraction. Numbers
        reflect the active working branch, not the published version.
      </HelpSection>

      <HelpSection :icon="GitBranch" title="Publishing model">
        CoLRev keeps your work on a <code class="font-mono text-[12.5px] text-ink-700">dev</code>
        branch. When you're ready to mark a stable checkpoint, publish a version — this merges
        <code class="font-mono text-[12.5px] text-ink-700">dev</code> into
        <code class="font-mono text-[12.5px] text-ink-700">main</code> and makes your results
        available to collaborators and citation tools.
      </HelpSection>

      <HelpSection :icon="Tag" title="Releases">
        A release is a permanent, citable snapshot of your review on GitHub
        (e.g. <code class="font-mono text-[12.5px] text-ink-700">v1.0</code>). Create one after
        publishing when you want to produce a version you can link to in a paper. Minor
        releases cover incremental updates; major releases signal significant new versions.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Continue button">
        <span class="text-ink-800 font-medium">Continue to …</span> in the top-right takes you
        directly to the step that needs attention next, based on the current state of your
        records.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
