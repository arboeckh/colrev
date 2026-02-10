import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Prescreen After Preprocessing E2E Test
 *
 * Regression test for the bug where batch_enrich_records reverted record
 * status from md_processed to md_prepared, causing the 2nd prescreen_record
 * call to fail with:
 *   ValueError: Record 'X' is not ready for prescreen (current status: md_prepared)
 *
 * Steps:
 * 1. Create project, upload asr.ris (10 records)
 * 2. Run preprocessing (Load → Prep → Dedupe)
 * 3. Navigate to Prescreen page
 * 4. Make a decision on the 1st record (include)
 * 5. Make a decision on the 2nd record (exclude) — this was the failing step
 */
test.describe('Prescreen After Preprocessing', () => {
  test.setTimeout(180000); // 3 minutes — preprocessing + enrichment can be slow

  test('can prescreen 2nd record after preprocessing with asr.ris', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `prescreen-fix-${Date.now()}`;

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
    // SEARCH: Upload asr.ris file
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Upload asr.ris (10 records)');
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

    await window.fill('[data-testid="source-name-input"]', 'asr');

    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, '../fixtures/asr.ris'));
    await window.waitForSelector('text=asr.ris', { timeout: 5000 });

    // Fill required search query field
    await window.fill('[data-testid="search-query-input"]', 'youth mental health');

    await clickWhenEnabled(window, '[data-testid="submit-add-source"]');
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Upload asr.ris');
    await window.waitForTimeout(1000);

    console.log('asr.ris file uploaded');

    // ============================================================
    // PREPROCESSING: Run Load → Prep → Dedupe
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PREPROCESSING: Navigate and run all stages');
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
    // PRESCREEN: Navigate and make decisions on 1st and 2nd records
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PRESCREEN: Navigate to prescreen page');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-prescreen"]');
    await window.waitForSelector('[data-testid="prescreen-page"]', { timeout: 15000 });

    // Wait for queue to load
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 30000 });
    console.log('Prescreen page loaded with records');

    // Read initial state
    const remainingText = await window.textContent('[data-testid="prescreen-remaining-count"]');
    console.log(`Remaining count: ${remainingText}`);

    const firstRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    const firstRecordTitle = await window.textContent('[data-testid="prescreen-record-title"]');
    console.log(`1st record: ${firstRecordId} — ${firstRecordTitle?.slice(0, 60)}...`);

    // Wait for enrichment to settle (batch_enrich_records runs in background)
    // This is the critical part — enrichment must not revert record status
    console.log('Waiting for background enrichment to settle...');
    await window.waitForTimeout(5000);

    // ============================================================
    // PRESCREEN: Decision on 1st record (include)
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PRESCREEN: Include 1st record');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Wait for include button to be enabled (record must be ready)
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 15000);
    console.log('Clicked Include on 1st record');

    // Wait for the RPC response
    await waitForRpcResponse('prescreen_record', 30000);
    await failFastOnBackendError(getDebugData, 'Prescreen 1st record (include)');

    // The queue should advance to the next record
    await window.waitForTimeout(1000);

    const secondRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    const secondRecordTitle = await window.textContent('[data-testid="prescreen-record-title"]');
    console.log(`2nd record: ${secondRecordId} — ${secondRecordTitle?.slice(0, 60)}...`);

    // Verify it's a different record
    expect(secondRecordId).not.toBe(firstRecordId);
    console.log('Queue advanced to 2nd record');

    // ============================================================
    // PRESCREEN: Decision on 2nd record (exclude) — THE REGRESSION TEST
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PRESCREEN: Exclude 2nd record (REGRESSION TEST)');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Wait for exclude button to be enabled
    await clickWhenEnabled(window, '[data-testid="prescreen-btn-exclude"]', 15000);
    console.log('Clicked Exclude on 2nd record');

    // THIS IS THE CRITICAL ASSERTION:
    // Before the fix, this would fail with:
    //   ValueError: Record 'X' is not ready for prescreen (current status: md_prepared)
    await waitForRpcResponse('prescreen_record', 30000);
    await failFastOnBackendError(getDebugData, 'Prescreen 2nd record (exclude)');

    console.log('2nd record prescreened successfully!');

    // Verify the queue continues working (3rd record visible)
    await window.waitForTimeout(1000);

    const thirdRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    console.log(`3rd record: ${thirdRecordId}`);
    expect(thirdRecordId).not.toBe(secondRecordId);

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

    console.log('\nPrescreen regression test passed — 2nd record prescreened without status reversion!');
  });
});
