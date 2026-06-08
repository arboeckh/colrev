<script setup lang="ts">
import { LayoutDashboard, Upload, Share2, Tag, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Overview"
    subtitle="Your review's home base — track progress, publish milestones, and collaborate."
  >
    <div class="space-y-7">
      <HelpSection :icon="LayoutDashboard" title="What this page is for">
        The overview is where you orient yourself. It shows how far your review has
        progressed, whether you have work still in draft that has not been published
        yet, and how to collaborate with others. Use
        <span class="text-ink-800 font-medium">Continue to …</span> in the header
        to jump to whichever pipeline step needs attention next.
      </HelpSection>

      <HelpSection :icon="Upload" title="Publishing">
        While you work, changes stay in a draft. When you click
        <span class="text-ink-800 font-medium">Publish</span>, CoLRev promotes that
        draft into the official version of your review — on GitHub this lives on the
        <span class="text-ink-800 font-medium">main</span> branch. That is what
        collaborators and citation tools treat as the current published state of the
        review.
        <p class="mt-2">
          Publishing is not the same as creating a release. Publishing updates the
          live official version; it does not freeze a point in time you can cite.
        </p>
        The publishing panel shows how many records are already in the official
        version and how new draft records are progressing through Search → Prescreen
        → Screen → Data.
      </HelpSection>

      <HelpSection :icon="Share2" title="Sharing &amp; collaborators">
        Use <span class="text-ink-800 font-medium">Push to GitHub</span> to back up
        your project online and enable dual-reviewer screening. From here you can
        open the project on GitHub, invite collaborators by username, and see
        pending invitations. Dual-reviewer prescreen and screen tasks need the
        project online with at least two collaborators.
      </HelpSection>

      <HelpSection :icon="Tag" title="Releases">
        A release is a named, frozen snapshot of your review at a specific moment
        (for example v1.0) — something you can link to in a paper. Create one after
        publishing when you want a permanent record of what the review looked like
        on a given date. You can publish many times as work continues; each release
        stays fixed even as the official version moves on. Minor releases cover
        incremental updates; major releases signal a significant new version.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Where to go next">
        The pipeline runs Definition → Search → Preprocessing → Prescreen → PDFs →
        Screen → Data. The header button takes you directly to the step that still
        needs work based on current record counts and task state.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
