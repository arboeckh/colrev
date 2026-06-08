<script setup lang="ts">
import { Lock, Download, Upload, FileCheck2, Wrench, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="PDFs"
    subtitle="Retrieve, upload, and prepare full-text PDFs for included records."
  >
    <div class="space-y-7">
      <HelpSection :icon="Lock" title="Before you start">
        This step unlocks after prescreen reconciliation — only records included at
        prescreen need PDFs. The stepper at the top walks you through five stages in
        order; later stages stay locked until earlier ones are complete.
      </HelpSection>

      <HelpSection :icon="Download" title="Retrieve">
        Click <span class="text-ink-800 font-medium">Start retrieval</span> to
        fetch PDFs automatically from open-access and licensed sources using each
        record's DOI and other identifiers. Re-run retrieval after adding
        credentials or new sources to pick up anything missed the first time.
      </HelpSection>

      <HelpSection :icon="Upload" title="Upload">
        Records CoLRev could not retrieve appear here. Upload PDFs one at a time
        from the table, use <span class="text-ink-800 font-medium">Batch upload
        PDFs</span> to import a folder at once, or mark records as unavailable when
        no full text can be found.
      </HelpSection>

      <HelpSection :icon="FileCheck2" title="Prepare">
        Click <span class="text-ink-800 font-medium">Prepare PDFs</span> to
        validate each file and extract its text for full-text screening. PDFs that
        fail text extraction are flagged and moved to the Fix stage.
      </HelpSection>

      <HelpSection :icon="Wrench" title="Fix &amp; summary">
        Re-upload cleaner copies for PDFs that failed preparation — scanned or
        image-only files cannot be text-extracted. The Summary stage confirms
        everything is ready and lets you import a teammate's PDF zip when files are
        missing on your machine — PDF files are not shared automatically between
        collaborators, so you may need to import a zip from a teammate.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        When all included records have prepared PDFs, click
        <span class="text-ink-800 font-medium">Next</span> to proceed to Screen,
        where records are reviewed against inclusion criteria.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
