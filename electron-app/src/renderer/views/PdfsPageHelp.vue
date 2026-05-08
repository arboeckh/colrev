<script setup lang="ts">
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
</script>

<template>
  <SheetHeader>
    <SheetTitle>PDFs</SheetTitle>
    <SheetDescription>Retrieve and prepare full-text PDFs for included records.</SheetDescription>
  </SheetHeader>

  <div class="mt-4 space-y-5 text-sm">
    <section>
      <h3 class="font-semibold mb-1">Retrieve</h3>
      <p class="text-muted-foreground">
        CoLRev automatically fetches PDFs from open-access and licensed sources using each
        record's DOI and other identifiers. Run retrieval to find as many PDFs as possible
        before moving to manual upload.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Upload</h3>
      <p class="text-muted-foreground">
        Records CoLRev couldn't retrieve automatically appear in the Upload stage. Upload
        each PDF individually or use the batch upload to import a folder of files at once.
        Mark any records you can't find as unavailable.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Prepare</h3>
      <p class="text-muted-foreground">
        The Prepare stage validates each PDF and extracts its text for full-text screening.
        PDFs that fail text extraction are flagged and moved to the Fix stage.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Fix defects</h3>
      <p class="text-muted-foreground">
        PDFs flagged during preparation need a cleaner copy — scanned or image-only PDFs
        can't be text-extracted. Re-upload a better version from another source.
      </p>
    </section>

    <section>
      <h3 class="font-semibold mb-1">Moving forward</h3>
      <p class="text-muted-foreground">
        Once all included records have prepared PDFs, click <strong>Next</strong> to proceed
        to Screen where full-text records are reviewed against inclusion criteria.
      </p>
    </section>
  </div>
</template>
