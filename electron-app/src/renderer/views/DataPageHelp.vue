<script setup lang="ts">
import { Sliders, PenLine, FileDown, Check } from 'lucide-vue-next';
import HelpDrawer from '@/components/layout/HelpDrawer.vue';
import HelpSection from '@/components/layout/HelpSection.vue';
</script>

<template>
  <HelpDrawer
    title="Data"
    subtitle="Extract structured data from included full-text records."
  >
    <div class="space-y-7">
      <HelpSection :icon="Sliders" title="Configuring fields">
        Use <span class="text-ink-800 font-medium">Configure Fields</span> to define the data
        you want to extract — for example sample size, methodology, or outcome measures.
        Optional fields can be left blank; required fields must be filled before a record can
        be saved.
      </HelpSection>

      <HelpSection :icon="PenLine" title="Extracting data">
        Each included record is shown alongside its PDF. Fill in the extraction fields from
        the full text and click <span class="text-ink-800 font-medium">Save</span> to advance
        to the next record. Use the record list on the right to jump anywhere directly.
      </HelpSection>

      <HelpSection :icon="FileDown" title="Exporting results">
        Once all records are complete, use <span class="text-ink-800 font-medium">Export
        CSV</span> to download the structured dataset, or
        <span class="text-ink-800 font-medium">View Data</span> to inspect it in a table
        before exporting.
      </HelpSection>

      <HelpSection :icon="Check" title="Wrapping up">
        Data extraction is the final pipeline step. Click
        <span class="text-ink-800 font-medium">Back to Overview</span> to return to the
        project overview and review the completed work.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
