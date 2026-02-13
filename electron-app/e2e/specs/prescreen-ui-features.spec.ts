import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Prescreen UI Features E2E Test
 *
 * Tests the redesigned prescreen page including:
 * - Progress bar with clickable segments
 * - Include/Exclude buttons at the top
 * - Decision indicator when viewing decided records
 * - Navigation back to previously decided records
 * - Included/excluded count badges
 */
test.describe('Prescreen UI Features', () => {
  test.setTimeout(180000); // 3 minutes — preprocessing + enrichment can be slow

  test('progress bar, decision history, and navigation', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `prescreen-ui-${Date.now()}`;

    // ============================================================
    // SETUP: Create project and upload data
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

    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

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

    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Preprocessing")', { timeout: 10000 });
    await window.waitForSelector('[data-testid="preprocessing-section"]', { timeout: 5000 });

    await clickWhenEnabled(window, '[data-testid="preprocessing-run-all-button"]');
    console.log('Clicked Run All');

    // Poll for completion
    const maxWaitTime = 120000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await failFastOnBackendError(getDebugData, 'Preprocessing operations');

      const dedupeStatus = await window
        .$eval('[data-testid="preprocessing-step-dedupe"]', (el) =>
          el.getAttribute('data-status'),
        )
        .catch(() => 'pending');

      if (dedupeStatus === 'complete') {
        console.log('All preprocessing stages completed');
        break;
      }

      await window.waitForTimeout(pollInterval);
    }

    const finalDedupeStatus = await window
      .$eval('[data-testid="preprocessing-step-dedupe"]', (el) =>
        el.getAttribute('data-status'),
      )
      .catch(() => 'pending');

    if (finalDedupeStatus !== 'complete') {
      const debugData = await getDebugData();
      console.log('=== Backend Logs ===');
      debugData.backendLogs.slice(-30).forEach((l) => console.log(l));
      throw new Error(
        `Preprocessing did not complete. Final dedupe status: ${finalDedupeStatus}`,
      );
    }

    await window.waitForTimeout(2000);

    // ============================================================
    // PRESCREEN: Navigate to prescreen page
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PRESCREEN: Navigate and test UI features');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-prescreen"]');
    await window.waitForSelector('[data-testid="prescreen-page"]', { timeout: 15000 });
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 30000 });
    console.log('Prescreen page loaded with records');

    // ============================================================
    // TEST 1: Verify initial UI structure
    // ============================================================
    console.log('\n--- TEST 1: Initial UI structure ---');

    // Decision buttons should be visible at the top
    await window.waitForSelector('[data-testid="prescreen-decision-bar"]', { timeout: 5000 });
    const includeBtn = await window.$('[data-testid="prescreen-btn-include"]');
    const excludeBtn = await window.$('[data-testid="prescreen-btn-exclude"]');
    expect(includeBtn).toBeTruthy();
    expect(excludeBtn).toBeTruthy();
    console.log('Include/Exclude buttons visible at top');

    // Progress bar should be visible
    await window.waitForSelector('[data-testid="prescreen-progress-bar"]', { timeout: 5000 });
    console.log('Progress bar visible');

    // Counter should show "Record 1 of N"
    const counterText = await window.textContent('[data-testid="prescreen-record-counter"]');
    expect(counterText).toContain('Record 1 of');
    console.log(`Counter: ${counterText?.trim()}`);

    // Progress text should show "0 decided / N loaded"
    const progressText = await window.textContent('[data-testid="prescreen-progress-text"]');
    expect(progressText).toContain('0 decided');
    console.log(`Progress: ${progressText?.trim()}`);

    // Included/Excluded count badges should show 0
    const includedText = await window.textContent('[data-testid="prescreen-included-count"]');
    const excludedText = await window.textContent('[data-testid="prescreen-excluded-count"]');
    expect(includedText).toContain('0');
    expect(excludedText).toContain('0');
    console.log('Initial counts: included=0, excluded=0');

    // Remaining count badge
    const remainingText = await window.textContent('[data-testid="prescreen-remaining-count"]');
    console.log(`Remaining: ${remainingText?.trim()}`);

    // Record info
    const firstRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    const firstRecordTitle = await window.textContent('[data-testid="prescreen-record-title"]');
    console.log(`1st record: ${firstRecordId} — ${firstRecordTitle?.slice(0, 60)}...`);

    // Wait for enrichment to settle
    console.log('Waiting for background enrichment to settle...');
    await window.waitForTimeout(5000);

    // ============================================================
    // TEST 2: Include first record and verify UI updates
    // ============================================================
    console.log('\n--- TEST 2: Include 1st record ---');

    await clearDebugLogs();

    await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 15000);
    console.log('Clicked Include on 1st record');

    await waitForRpcResponse('prescreen_record', 30000);
    await failFastOnBackendError(getDebugData, 'Prescreen 1st record (include)');
    await window.waitForTimeout(1000);

    // Should auto-advance to 2nd record
    const secondRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    expect(secondRecordId).not.toBe(firstRecordId);
    console.log(`Auto-advanced to 2nd record: ${secondRecordId}`);

    // Included count should update to 1
    const includedAfter1 = await window.textContent('[data-testid="prescreen-included-count"]');
    expect(includedAfter1).toContain('1');
    console.log(`Included count: ${includedAfter1?.trim()}`);

    // Progress text should show "1 decided"
    const progressAfter1 = await window.textContent('[data-testid="prescreen-progress-text"]');
    expect(progressAfter1).toContain('1 decided');
    console.log(`Progress: ${progressAfter1?.trim()}`);

    // ============================================================
    // TEST 3: Navigate back to see decided record
    // ============================================================
    console.log('\n--- TEST 3: Navigate back to decided record ---');

    // Click previous button to go back to the included record
    await window.click('[data-testid="prescreen-btn-previous"]');
    await window.waitForTimeout(500);

    // Should see the first record again
    const backRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    expect(backRecordId).toBe(firstRecordId);
    console.log(`Navigated back to: ${backRecordId}`);

    // Decision indicator should show "Included" (not Include/Exclude buttons)
    await window.waitForSelector('[data-testid="prescreen-decision-indicator"]', { timeout: 5000 });
    const indicatorText = await window.textContent('[data-testid="prescreen-decision-indicator"]');
    expect(indicatorText).toContain('Included');
    console.log(`Decision indicator shows: ${indicatorText?.trim()}`);

    // Include/Exclude buttons should NOT be visible
    const includeBtnHidden = await window.$('[data-testid="prescreen-btn-include"]');
    expect(includeBtnHidden).toBeNull();
    console.log('Include/Exclude buttons hidden for decided record');

    // Card should have green border (included)
    const cardClasses = await window.$eval('[data-testid="prescreen-record-card"]', (el) =>
      el.className,
    );
    expect(cardClasses).toContain('border-green');
    console.log('Card has green border for included record');

    // "Next undecided" button should be visible
    const skipBtn = await window.$('[data-testid="prescreen-btn-skip-to-undecided"]');
    expect(skipBtn).toBeTruthy();
    console.log('"Next undecided" button visible');

    // ============================================================
    // TEST 4: Skip to next undecided
    // ============================================================
    console.log('\n--- TEST 4: Skip to next undecided ---');

    await window.click('[data-testid="prescreen-btn-skip-to-undecided"]');
    await window.waitForTimeout(500);

    // Should be on the 2nd record (next undecided after record 1)
    const skipToRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    expect(skipToRecordId).toBe(secondRecordId);
    console.log(`Skipped to next undecided: ${skipToRecordId}`);

    // Include/Exclude buttons should be visible again
    const includeBtnVisible = await window.$('[data-testid="prescreen-btn-include"]');
    expect(includeBtnVisible).toBeTruthy();
    console.log('Include/Exclude buttons visible for undecided record');

    // ============================================================
    // TEST 5: Exclude 2nd record and verify progress
    // ============================================================
    console.log('\n--- TEST 5: Exclude 2nd record ---');

    await clearDebugLogs();

    await clickWhenEnabled(window, '[data-testid="prescreen-btn-exclude"]', 15000);
    console.log('Clicked Exclude on 2nd record');

    await waitForRpcResponse('prescreen_record', 30000);
    await failFastOnBackendError(getDebugData, 'Prescreen 2nd record (exclude)');
    await window.waitForTimeout(1000);

    // Should auto-advance to 3rd record
    const thirdRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
    expect(thirdRecordId).not.toBe(secondRecordId);
    console.log(`Auto-advanced to 3rd record: ${thirdRecordId}`);

    // Counts should update
    const includedAfter2 = await window.textContent('[data-testid="prescreen-included-count"]');
    const excludedAfter2 = await window.textContent('[data-testid="prescreen-excluded-count"]');
    expect(includedAfter2).toContain('1');
    expect(excludedAfter2).toContain('1');
    console.log(`Counts: included=${includedAfter2?.trim()}, excluded=${excludedAfter2?.trim()}`);

    // Progress should show "2 decided"
    const progressAfter2 = await window.textContent('[data-testid="prescreen-progress-text"]');
    expect(progressAfter2).toContain('2 decided');
    console.log(`Progress: ${progressAfter2?.trim()}`);

    // ============================================================
    // TEST 6: Progress bar segments are clickable
    // ============================================================
    console.log('\n--- TEST 6: Progress bar segment navigation ---');

    // Click on the first progress cell (should navigate to first record)
    const firstCell = await window.$('[data-testid="prescreen-progress-cell-0"]');
    if (firstCell) {
      await firstCell.click();
      await window.waitForTimeout(500);

      const navRecordId = await window.textContent('[data-testid="prescreen-record-id"]');
      expect(navRecordId).toBe(firstRecordId);
      console.log(`Clicked progress cell 0, navigated to: ${navRecordId}`);

      // Should show decision indicator (record was included)
      await window.waitForSelector('[data-testid="prescreen-decision-indicator"]', {
        timeout: 5000,
      });
      console.log('Decision indicator visible after progress bar navigation');
    } else {
      console.log('Progress cells not found (queue may be > 60 records)');
    }

    // Navigate back to undecided
    const skipBtn2 = await window.$('[data-testid="prescreen-btn-skip-to-undecided"]');
    if (skipBtn2) {
      await skipBtn2.click();
      await window.waitForTimeout(500);
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

    const finalDebugData = await getDebugData();
    if (finalDebugData.hasErrors) {
      console.log('\nWarnings/errors during test:');
      const errors = finalDebugData.logs.filter((l) => l.type === 'error');
      errors.forEach((e) => console.log(`  - ${e.message}`));
    }

    console.log('\nAll prescreen UI feature tests passed!');
  });
});
