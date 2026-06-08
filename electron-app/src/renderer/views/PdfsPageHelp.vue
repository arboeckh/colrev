<script setup lang="ts">
import { Download, Upload, FileCheck2, Wrench, ArrowRight } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="PDFs"
    subtitle="Retrieve and prepare full-text PDFs for included records."
  >
    <div class="space-y-7">
      <HelpSection :icon="Download" title="Retrieve">
        CoLRev automatically fetches PDFs from open-access and licensed sources using each
        record's DOI and other identifiers. Run retrieval to find as many PDFs as possible
        before moving to manual upload.
      </HelpSection>

      <HelpSection :icon="Upload" title="Upload">
        Records CoLRev couldn't retrieve automatically appear in the Upload stage. Upload each
        PDF individually or use batch upload to import a folder at once. Mark any records you
        can't find as unavailable.
      </HelpSection>

      <HelpSection :icon="FileCheck2" title="Prepare">
        Validates each PDF and extracts its text for full-text screening. PDFs that fail text
        extraction are flagged and moved to the Fix stage.
      </HelpSection>

      <HelpSection :icon="Wrench" title="Fix defects">
        PDFs flagged during preparation need a cleaner copy — scanned or image-only PDFs can't
        be text-extracted. Re-upload a better version from another source.
      </HelpSection>

      <HelpSection :icon="ArrowRight" title="Moving forward">
        Once all included records have prepared PDFs, click
        <span class="text-ink-800 font-medium">Next</span> to proceed to Screen where records
        are reviewed against inclusion criteria.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
