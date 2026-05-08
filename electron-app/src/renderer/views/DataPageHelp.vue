<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>Data</SheetTitle>
    <SheetDescription>Extract structured data from included full-text records.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">Configuring fields</h3>
      <p class="text-muted-foreground">
        Use <strong>Configure Fields</strong> to define the data you want to extract — for
        example, sample size, methodology, or outcome measures. Fields marked optional can
        be left blank; required fields must be filled before a record can be saved.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Extracting data</h3>
      <p class="text-muted-foreground">
        Each included record is shown alongside its PDF. Fill in the extraction fields from
        the full text and click <strong>Save</strong> to advance to the next record. Use the
        record list on the right to jump to any record directly.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Exporting results</h3>
      <p class="text-muted-foreground">
        Once all records are complete, use <strong>Export CSV</strong> to download the
        structured dataset, or <strong>View Data</strong> to inspect it in a table before
        exporting.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Wrapping up</h3>
      <p class="text-muted-foreground">
        Data extraction is the final pipeline step. Click <strong>Back to Overview</strong>
        to return to the project overview and review the completed review.
      </p>
    </section>
  </div>
</template>
