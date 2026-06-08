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
      <HelpSection :icon="Sliders" title="Getting started">
        Before extracting, click <span class="text-ink-800 font-medium">Configure
        Fields</span> to define what you want to capture — for example sample size,
        study design, or outcome measures. Fields can be text, numbers, or single/
        multi-select choices. Required fields must be filled before a record can be
        saved; optional fields can be left blank.
      </HelpSection>

      <HelpSection :icon="PenLine" title="Extracting data">
        Each included record opens in a split view: the PDF on the left and
        extraction fields on the right. Fill in values from the full text and click
        <span class="text-ink-800 font-medium">Save</span> to save and advance to
        the next pending record. Use the progress bar to jump to any record, or
        reopen <span class="text-ink-800 font-medium">Configure Fields</span> to
        adjust the schema.
      </HelpSection>

      <HelpSection :icon="FileDown" title="Exporting results">
        When every record is complete, use <span class="text-ink-800 font-medium">Export
        CSV</span> to download the structured dataset.
        <span class="text-ink-800 font-medium">View Data</span> opens a table for
        inspection before exporting, and
        <span class="text-ink-800 font-medium">Edit Extractions</span> lets you
        revisit and update saved values.
      </HelpSection>

      <HelpSection :icon="Check" title="Wrapping up">
        Data extraction is the final pipeline step. Click
        <span class="text-ink-800 font-medium">Back to Overview</span> to review
        overall progress. From there you can
        <span class="text-ink-800 font-medium">Publish</span> to promote your work
        to the official version of the review, or create a
        <span class="text-ink-800 font-medium">Release</span> when you need a
        frozen, citable snapshot.
      </HelpSection>
    </div>
  </HelpDrawer>
</template>
