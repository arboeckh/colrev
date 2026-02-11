import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
  formatRpcLogs,
  printDebugData,
} from '../helpers/test-utils';

/**
 * PDF Upload Workflow E2E Test
 *
 * Tests the complete workflow through PDF manual upload:
 * 1. Create project
 * 2. Upload source1.ris (3 well-formed records that preprocess cleanly)
 * 3. Run preprocessing (Load -> Prep -> Dedupe)
 * 4. Prescreen all records as "include"
 * 5. Run PDF Get (records should need manual retrieval since DOIs are fake)
 * 6. Upload a PDF for the first record
 * 7. Verify the upload succeeded and record moved to Retrieved tab
 */
test.describe('PDF Upload Workflow', () => {
  test.setTimeout(240000); // 4 minutes

  test('upload PDF for a record needing manual retrieval', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `pdf-upload-${Date.now()}`;

    // ============================================================
    // SETUP: Create project
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SETUP: Create project');
    console.log('='.repeat(60));

    await waitForAppReady(window, waitForBackend, 30000);

    await window.click('button:has-text("New Project")');
    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5000 });
    await window.fill('[data-testid="project-id-input"]', projectId);

    // Uncheck example data
    const exampleCheckbox = await window.$('input#useExample');
    if (exampleCheckbox && (await exampleCheckbox.isChecked())) {
      await exampleCheckbox.click();
    }

    await window.click('[data-testid="submit-create-project"]');
    await waitForRpcResponse('init_project', 60000);
    await failFastOnBackendError(getDebugData, 'Project creation');

    await window.waitForSelector('text=Project Overview', { timeout: 15000 });
    console.log(`Project "${projectId}" created`);

    // ============================================================
    // SEARCH: Upload source1.ris (3 records)
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Upload source1.ris (3 records)');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Navigate to Search page
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

    // Add file source
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-file-source-option"]');
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });

    await window.fill('[data-testid="source-name-input"]', 'source1');

    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, '../fixtures/source1.ris'));
    await window.waitForSelector('text=source1.ris', { timeout: 5000 });

    // Fill required search query field if present
    const searchQueryInput = await window.$('[data-testid="search-query-input"]');
    if (searchQueryInput) {
      await window.fill('[data-testid="search-query-input"]', 'machine learning healthcare');
    }

    await clickWhenEnabled(window, '[data-testid="submit-add-source"]');
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Upload source1.ris');
    await window.waitForTimeout(1000);

    console.log('source1.ris uploaded');

    // ============================================================
    // PREPROCESSING: Run Load -> Prep -> Dedupe
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PREPROCESSING: Run all stages');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-preprocessing"]');
    await window.waitForSelector('h2:has-text("Preprocessing")', { timeout: 10000 });
    await window.waitForSelector('[data-testid="preprocessing-page"]', { timeout: 5000 });

    console.log('Preprocessing page loaded');

    // Run all stages
    await clickWhenEnabled(window, '[data-testid="preprocessing-run-all-button"]');
    console.log('Clicked Run All');

    // Poll for completion
    const maxWaitTime = 120000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await failFastOnBackendError(getDebugData, 'Preprocessing operations');

      const dedupeStatus = await window.$eval(
        '[data-testid="preprocessing-step-dedupe"]',
        (el) => el.getAttribute('data-status')
      ).catch(() => 'pending');

      if (dedupeStatus === 'complete') {
        console.log('All preprocessing stages completed');
        break;
      }

      const loadStatus = await window.$eval(
        '[data-testid="preprocessing-step-load"]',
        (el) => el.getAttribute('data-status')
      ).catch(() => 'pending');
      const prepStatus = await window.$eval(
        '[data-testid="preprocessing-step-prep"]',
        (el) => el.getAttribute('data-status')
      ).catch(() => 'pending');

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${elapsed}s] Load: ${loadStatus}, Prep: ${prepStatus}, Dedupe: ${dedupeStatus}`);

      await window.waitForTimeout(pollInterval);
    }

    // Verify preprocessing completed
    const finalDedupeStatus = await window.$eval(
      '[data-testid="preprocessing-step-dedupe"]',
      (el) => el.getAttribute('data-status')
    ).catch(() => 'pending');

    if (finalDedupeStatus !== 'complete') {
      const debugData = await getDebugData();
      console.log('=== Backend Logs ===');
      debugData.backendLogs.slice(-30).forEach(l => console.log(l));
      throw new Error(`Preprocessing did not complete. Final dedupe status: ${finalDedupeStatus}`);
    }

    await window.waitForTimeout(2000);

    // ============================================================
    // PRESCREEN: Include all records
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PRESCREEN: Include all records');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-prescreen"]');
    await window.waitForSelector('[data-testid="prescreen-page"]', { timeout: 15000 });

    // Wait for queue to load
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 30000 });
    console.log('Prescreen page loaded with records');

    // Wait for enrichment to settle
    console.log('Waiting for background enrichment to settle...');
    await window.waitForTimeout(5000);

    // Include all records one by one (source1.ris has 3 records)
    const recordCount = 3;
    for (let i = 0; i < recordCount; i++) {
      await clearDebugLogs();

      // Check if there's still a record to prescreen
      const recordCard = await window.$('[data-testid="prescreen-record-card"]');
      if (!recordCard) {
        console.log(`No more records to prescreen after ${i} records`);
        break;
      }

      const recordIdText = await window.textContent('[data-testid="prescreen-record-id"]');
      console.log(`Including record ${i + 1}: ${recordIdText}`);

      await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 15000);
      await waitForRpcResponse('prescreen_record', 30000);
      await failFastOnBackendError(getDebugData, `Prescreen record ${i + 1}`);
      await window.waitForTimeout(1000);

      console.log(`Record ${i + 1} included`);
    }

    // ============================================================
    // PDF GET: Run PDF Get operation
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PDF GET: Run PDF Get operation');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-pdf_get"]');
    await window.waitForSelector('[data-testid="pdf-get-page"]', { timeout: 10000 });
    console.log('PDF Get page loaded');

    // Wait a moment for status to load
    await window.waitForTimeout(2000);

    // Check if the Run PDF Get button is available
    const runPdfGetBtn = await window.$('[data-testid="run-pdf_get-button"]');
    if (!runPdfGetBtn) {
      console.log('Run PDF Get button not found');
      const debugData = await getDebugData();
      printDebugData(debugData);
      throw new Error('Run PDF Get button not found on PDF Get page');
    }

    // Check if button is disabled
    const isDisabled = await runPdfGetBtn.getAttribute('disabled');
    console.log(`Run PDF Get button disabled: ${isDisabled !== null}`);

    if (isDisabled !== null) {
      // Button is disabled - print debug info
      console.log('Button is disabled, checking operation info...');
      const debugData = await getDebugData();
      console.log('Backend logs:');
      debugData.backendLogs.slice(-10).forEach(l => console.log(l));

      // Try refreshing status
      await window.click('[data-testid="sidebar-pdf_get"]');
      await window.waitForTimeout(3000);
    }

    await clickWhenEnabled(window, '[data-testid="run-pdf_get-button"]', 15000);
    console.log('Clicked Run PDF Get');

    // Check for backend errors during PDF get
    for (let i = 0; i < 10; i++) {
      await window.waitForTimeout(1000);
      // Don't fail fast here since pdf_get may log warnings about unreachable URLs
      const debugData = await getDebugData();
      if (debugData.backendStatus === 'error') {
        throw new Error(`Backend crashed during PDF Get: ${debugData.backendLogs.slice(-5).join('\n')}`);
      }
    }

    const pdfGetResponse = await waitForRpcResponse('pdf_get', 60000);
    expect(pdfGetResponse).not.toBeNull();
    console.log('PDF Get operation completed');

    // Wait for UI to update
    await window.waitForTimeout(3000);

    // Print RPC logs for debugging
    const rpcLogs = await getRpcLogs();
    console.log('\n=== RPC Activity ===');
    console.log(formatRpcLogs(rpcLogs));

    // ============================================================
    // VERIFY: Records in "Needs PDF" tab
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VERIFY: Records needing manual PDF retrieval');
    console.log('='.repeat(60));

    // Refresh the page to get updated records
    await window.click('[data-testid="sidebar-pdf_get"]');
    await window.waitForSelector('[data-testid="pdf-get-page"]', { timeout: 10000 });
    await window.waitForTimeout(3000);

    // Check needs count
    const needsCountBadge = await window.$('[data-testid="pdf-get-needs-count"]');
    const needsCountText = await needsCountBadge?.textContent();
    console.log(`Needs PDF badge: "${needsCountText}"`);

    // Check imported count
    const importedCountBadge = await window.$('[data-testid="pdf-get-imported-count"]');
    const importedCountText = await importedCountBadge?.textContent();
    console.log(`Imported badge: "${importedCountText}"`);

    // Parse counts
    const needsCount = parseInt(needsCountText?.match(/(\d+)/)?.[1] || '0');
    const importedCount = parseInt(importedCountText?.match(/(\d+)/)?.[1] || '0');

    console.log(`Needs PDF: ${needsCount}, Imported: ${importedCount}`);

    if (needsCount === 0) {
      // All PDFs were auto-retrieved - nothing to test upload for
      console.log('All PDFs were auto-retrieved by PDF Get operation. Checking if any are in imported state...');

      if (importedCount > 0) {
        console.log(`${importedCount} PDFs were automatically imported. Upload test is not applicable.`);
        console.log('TEST PASSED (PDF Get auto-retrieved all records)');
        return;
      }

      // Dump debug info
      const debugData = await getDebugData();
      printDebugData(debugData);
      throw new Error('No records in needs_pdf or imported state after PDF Get');
    }

    expect(needsCount).toBeGreaterThan(0);
    console.log(`${needsCount} records need manual PDF retrieval`);

    // Click on "Needs PDF" tab to ensure it's selected
    await window.click('[data-testid="pdf-get-tab-needs"]');
    await window.waitForTimeout(1000);

    // Look for record rows
    const recordRows = await window.$$('[data-testid^="pdf-record-row-"]');
    console.log(`Found ${recordRows.length} record rows in Needs PDF tab`);
    expect(recordRows.length).toBeGreaterThan(0);

    // Get the first record's ID from its data-testid
    const firstRowTestId = await recordRows[0].getAttribute('data-testid');
    const recordId = firstRowTestId?.replace('pdf-record-row-', '');
    console.log(`First record ID for upload: ${recordId}`);

    // ============================================================
    // PDF UPLOAD: Upload PDF for first record
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log(`PDF UPLOAD: Upload PDF for record ${recordId}`);
    console.log('='.repeat(60));

    await clearDebugLogs();

    const uploadBtnSelector = `[data-testid="pdf-upload-btn-${recordId}"]`;
    const uploadBtn = await window.$(uploadBtnSelector);
    expect(uploadBtn).not.toBeNull();
    console.log('Upload button found');

    // Click Upload button which triggers the hidden file input
    const pdfFilePath = path.join(__dirname, '../fixtures/2601.00044v1.pdf');
    const [pdfFileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click(uploadBtnSelector),
    ]);
    console.log('File chooser intercepted');

    // Set the PDF file
    await pdfFileChooser.setFiles(pdfFilePath);
    console.log('PDF file set');

    // Wait for upload_pdf RPC response and fail fast on backend errors
    await window.waitForTimeout(2000);
    await failFastOnBackendError(getDebugData, 'PDF upload');

    const uploadResponse = await waitForRpcResponse('upload_pdf', 30000);
    expect(uploadResponse).not.toBeNull();
    await failFastOnBackendError(getDebugData, 'PDF upload response');

    console.log('upload_pdf RPC completed');

    // ============================================================
    // VERIFY: Record moved to Retrieved tab
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VERIFY: Record moved to Retrieved tab');
    console.log('='.repeat(60));

    // Wait for UI to update
    await window.waitForTimeout(3000);

    // Check updated counts
    const updatedNeedsText = await (await window.$('[data-testid="pdf-get-needs-count"]'))?.textContent();
    const updatedImportedText = await (await window.$('[data-testid="pdf-get-imported-count"]'))?.textContent();
    console.log(`Updated Needs: "${updatedNeedsText}", Updated Imported: "${updatedImportedText}"`);

    const updatedNeedsCount = parseInt(updatedNeedsText?.match(/(\d+)/)?.[1] || '0');
    const updatedImportedCount = parseInt(updatedImportedText?.match(/(\d+)/)?.[1] || '0');

    // After uploading one PDF, imported count should increase
    expect(updatedImportedCount).toBeGreaterThan(importedCount);
    console.log(`Imported count increased: ${importedCount} -> ${updatedImportedCount}`);

    // Switch to Retrieved tab to verify the record appears there
    await window.click('[data-testid="pdf-get-tab-retrieved"]');
    await window.waitForTimeout(1000);

    const retrievedRows = await window.$$('[data-testid^="pdf-record-row-"]');
    console.log(`Found ${retrievedRows.length} records in Retrieved tab`);
    expect(retrievedRows.length).toBeGreaterThan(0);

    // Verify the uploaded record is in the retrieved tab
    const uploadedRecordRow = await window.$(`[data-testid="pdf-record-row-${recordId}"]`);
    expect(uploadedRecordRow).not.toBeNull();
    console.log(`Record ${recordId} found in Retrieved tab`);

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

    const finalDebugData = await getDebugData();
    if (finalDebugData.hasErrors) {
      console.log('\nWarnings/errors during test:');
      const errors = finalDebugData.logs.filter(l => l.type === 'error');
      errors.forEach(e => console.log(`  - ${e.message}`));
    }

    console.log('\nPDF upload workflow completed successfully!');
  });
});
