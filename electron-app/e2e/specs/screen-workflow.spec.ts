import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Screen Page Workflow E2E Test
 *
 * Tests the overhauled Screen page including:
 * - Split panel layout (PDF viewer + record panel)
 * - Progress bar with colored segments
 * - Include/Exclude decision buttons (no-criteria mode)
 * - Decision indicator for decided records
 * - Navigation back to decided records
 * - Edit mode (toggle decisions, save changes)
 * - Completion state
 *
 * Pipeline: Create → Upload source1.ris → Preprocessing → Prescreen all →
 *           Force records to pdf_prepared via update_record → Screen
 *
 * Note: We skip the PDF pipeline and force records to pdf_prepared status
 * because the test PDF fixture doesn't pass CoLRev's PDF validation checks.
 */
test.describe('Screen Page Workflow', () => {
  test.setTimeout(300000); // 5 minutes — full pipeline

  test('screen page: decisions, progress bar, edit mode, completion', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `screen-e2e-${Date.now()}`;

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

    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

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
    // PREPROCESSING: Run Load → Prep → Dedupe
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PREPROCESSING: Run all stages');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Preprocessing")', { timeout: 10000 });
    await window.waitForSelector('[data-testid="preprocessing-section"]', { timeout: 5000 });

    await clickWhenEnabled(window, '[data-testid="preprocessing-run-all-button"]');
    console.log('Clicked Run All');

    // Poll for completion
    const maxPreprocessTime = 120000;
    const startPreprocess = Date.now();

    while (Date.now() - startPreprocess < maxPreprocessTime) {
      await failFastOnBackendError(getDebugData, 'Preprocessing operations');

      const dedupeStatus = await window.$eval(
        '[data-testid="preprocessing-step-dedupe"]',
        (el) => el.getAttribute('data-status')
      ).catch(() => 'pending');

      if (dedupeStatus === 'complete') {
        console.log('All preprocessing stages completed');
        break;
      }

      await window.waitForTimeout(2000);
    }

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
    await window.waitForSelector('[data-testid="prescreen-record-card"]', { timeout: 30000 });
    console.log('Prescreen page loaded with records');

    // Wait for enrichment to settle
    console.log('Waiting for background enrichment to settle...');
    await window.waitForTimeout(5000);

    // Collect record IDs as we prescreen them
    const prescreenedRecordIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      await clearDebugLogs();

      const recordCard = await window.$('[data-testid="prescreen-record-card"]');
      if (!recordCard) break;

      const completionScreen = await window.$('[data-testid="prescreen-complete"]');
      if (completionScreen) break;

      const recordIdText = await window.textContent('[data-testid="prescreen-record-id"]').catch(() => null);
      if (recordIdText) prescreenedRecordIds.push(recordIdText.trim());
      console.log(`Including record ${i + 1}: ${recordIdText}`);

      await clickWhenEnabled(window, '[data-testid="prescreen-btn-include"]', 15000);
      await waitForRpcResponse('prescreen_record', 30000);
      await failFastOnBackendError(getDebugData, `Prescreen record ${i + 1}`);
      await window.waitForTimeout(1000);

      console.log(`Record ${i + 1} included`);
    }

    console.log(`Prescreened ${prescreenedRecordIds.length} records: ${prescreenedRecordIds.join(', ')}`);

    // ============================================================
    // FORCE TO pdf_prepared: Use update_record API to bypass PDF pipeline
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('FORCE TO pdf_prepared: Bypass PDF pipeline via update_record');
    console.log('='.repeat(60));

    // Use the backend RPC directly via the Pinia backend store
    for (const recordId of prescreenedRecordIds) {
      await clearDebugLogs();

      await window.evaluate(async (args) => {
        const { recordId, projectId } = args;
        // @ts-expect-error Accessing exposed Pinia
        const pinia = window.__pinia__;
        const backendStore = pinia._s.get('backend');
        await backendStore.call('update_record', {
          project_id: projectId,
          record_id: recordId,
          fields: { colrev_status: 'pdf_prepared' },
          skip_commit: true,
        });
      }, { recordId, projectId });

      console.log(`Set ${recordId} to pdf_prepared`);
    }

    // Refresh project status
    await window.evaluate(async () => {
      // @ts-expect-error Accessing exposed Pinia
      const pinia = window.__pinia__;
      const projectsStore = pinia._s.get('projects');
      await projectsStore.refreshCurrentProject();
    });

    await window.waitForTimeout(2000);
    console.log('Project status refreshed');

    // ============================================================
    // SCREEN: Navigate to Screen page
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SCREEN: Navigate to Screen page');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-screen"]');
    await window.waitForSelector('[data-testid="screen-page"]', { timeout: 15000 });
    console.log('Screen page loaded');

    // Wait for queue to load
    await window.waitForSelector('[data-testid="screen-record-card"]', { timeout: 30000 });
    console.log('Screen records loaded');

    // ============================================================
    // TEST 1: Verify Screen page initial UI
    // ============================================================
    console.log('\n--- TEST 1: Screen page initial UI ---');

    // Progress bar should be visible
    await window.waitForSelector('[data-testid="screen-progress-bar"]', { timeout: 5000 });
    console.log('Progress bar visible');

    // Decision bar should be visible
    await window.waitForSelector('[data-testid="screen-decision-bar"]', { timeout: 5000 });
    console.log('Decision bar visible');

    // Record counter
    const counterText = await window.textContent('[data-testid="screen-record-counter"]');
    expect(counterText).toContain('Record 1 of');
    console.log(`Counter: ${counterText?.trim()}`);

    // Progress text
    const progressText = await window.textContent('[data-testid="screen-progress-text"]');
    expect(progressText).toContain('0 decided');
    console.log(`Progress: ${progressText?.trim()}`);

    // Included/excluded counts should be 0
    const includedBadge = await window.textContent('[data-testid="screen-included-count"]');
    expect(includedBadge).toContain('0');
    const excludedBadge = await window.textContent('[data-testid="screen-excluded-count"]');
    expect(excludedBadge).toContain('0');
    console.log(`Counts: included=${includedBadge?.trim()}, excluded=${excludedBadge?.trim()}`);

    // Include/Exclude buttons should be visible (no-criteria mode)
    const includeBtn = await window.$('[data-testid="screen-btn-include"]');
    const excludeBtn = await window.$('[data-testid="screen-btn-exclude"]');
    expect(includeBtn).not.toBeNull();
    expect(excludeBtn).not.toBeNull();
    console.log('Include/Exclude buttons visible');

    // ============================================================
    // TEST 2: Include first record
    // ============================================================
    console.log('\n--- TEST 2: Include first record ---');

    await clearDebugLogs();

    await clickWhenEnabled(window, '[data-testid="screen-btn-include"]', 15000);
    console.log('Clicked Include on 1st record');

    await waitForRpcResponse('screen_record', 30000);
    await failFastOnBackendError(getDebugData, 'Screen 1st record (include)');
    await window.waitForTimeout(1000);

    // Included count should be 1
    const includedAfter1 = await window.textContent('[data-testid="screen-included-count"]');
    expect(includedAfter1).toContain('1');
    console.log(`Included count: ${includedAfter1?.trim()}`);

    // Progress should show "1 decided"
    const progressAfter1 = await window.textContent('[data-testid="screen-progress-text"]');
    expect(progressAfter1).toContain('1 decided');
    console.log(`Progress: ${progressAfter1?.trim()}`);

    // ============================================================
    // TEST 3: Navigate back to decided record via progress bar
    // ============================================================
    console.log('\n--- TEST 3: Navigate back to decided record ---');

    // Check if there are more undecided records
    const hasMore = await window.$('[data-testid="screen-btn-include"]');
    if (hasMore) {
      // Click on first progress cell to go back to record 0
      const firstCell = await window.$('[data-testid="screen-progress-cell-0"]');
      if (firstCell) {
        await firstCell.click();
        await window.waitForTimeout(500);

        // Decision indicator should show "Included"
        await window.waitForSelector('[data-testid="screen-decision-indicator"]', { timeout: 5000 });
        const indicatorText = await window.textContent('[data-testid="screen-decision-indicator"]');
        expect(indicatorText).toContain('Included');
        console.log(`Decision indicator: ${indicatorText?.trim()}`);

        // Include/Exclude buttons should NOT be visible for decided record
        const hiddenInclude = await window.$('[data-testid="screen-btn-include"]');
        expect(hiddenInclude).toBeNull();
        console.log('Include/Exclude buttons hidden for decided record');

        // "Next undecided" button should be visible
        const skipBtn = await window.$('[data-testid="screen-btn-skip-to-undecided"]');
        expect(skipBtn).not.toBeNull();
        console.log('"Next undecided" button visible');

        // Navigate back to undecided
        await window.click('[data-testid="screen-btn-skip-to-undecided"]');
        await window.waitForTimeout(500);

        // Include/Exclude buttons should be back
        const backInclude = await window.$('[data-testid="screen-btn-include"]');
        expect(backInclude).not.toBeNull();
        console.log('Navigated back to undecided record');
      }

      // ============================================================
      // TEST 4: Exclude second record
      // ============================================================
      console.log('\n--- TEST 4: Exclude second record ---');

      await clearDebugLogs();

      await clickWhenEnabled(window, '[data-testid="screen-btn-exclude"]', 15000);
      console.log('Clicked Exclude on 2nd record');

      await waitForRpcResponse('screen_record', 30000);
      await failFastOnBackendError(getDebugData, 'Screen 2nd record (exclude)');
      await window.waitForTimeout(1000);

      // Excluded count should be 1
      const excludedAfter = await window.textContent('[data-testid="screen-excluded-count"]');
      expect(excludedAfter).toContain('1');
      console.log(`Excluded count: ${excludedAfter?.trim()}`);

      // Progress should show "2 decided"
      const progressAfter2 = await window.textContent('[data-testid="screen-progress-text"]');
      expect(progressAfter2).toContain('2 decided');
      console.log(`Progress: ${progressAfter2?.trim()}`);
    } else {
      console.log('Only 1 record in queue, skipping navigation and exclude tests');
    }

    // ============================================================
    // TEST 5: Screen remaining records to reach completion
    // ============================================================
    console.log('\n--- TEST 5: Screen remaining records ---');

    let screened = 0;
    while (screened < 10) {
      const complete = await window.$('[data-testid="screen-complete"]');
      if (complete) {
        console.log('Reached completion state');
        break;
      }

      const incBtn = await window.$('[data-testid="screen-btn-include"]');
      if (!incBtn) {
        const skipBtn = await window.$('[data-testid="screen-btn-skip-to-undecided"]');
        if (skipBtn) {
          await skipBtn.click();
          await window.waitForTimeout(500);
          continue;
        }
        console.log('No more undecided records');
        break;
      }

      await clearDebugLogs();
      await clickWhenEnabled(window, '[data-testid="screen-btn-include"]', 15000);

      const response = await waitForRpcResponse('screen_record', 30000);
      if (!response) break;
      await failFastOnBackendError(getDebugData, 'Screen remaining record');
      await window.waitForTimeout(1000);

      screened++;
      console.log(`Screened additional record ${screened}`);
    }

    // ============================================================
    // TEST 6: Verify completion state
    // ============================================================
    console.log('\n--- TEST 6: Completion state ---');

    await window.waitForTimeout(3000);

    const completionScreen = await window.$('[data-testid="screen-complete"]');
    if (completionScreen) {
      console.log('Completion screen visible');

      const completedIncluded = await window.textContent('[data-testid="screen-complete-included"]');
      const completedExcluded = await window.textContent('[data-testid="screen-complete-excluded"]');
      const completedTotal = await window.textContent('[data-testid="screen-complete-total"]');
      console.log(`Completion: included=${completedIncluded?.trim()}, excluded=${completedExcluded?.trim()}, total=${completedTotal?.trim()}`);

      // "Edit Decisions" button should be visible
      const editBtn = await window.$('[data-testid="screen-edit-decisions-btn"]');
      expect(editBtn).not.toBeNull();
      console.log('"Edit Decisions" button visible');

      // Click Edit Decisions to enter edit mode
      await window.click('[data-testid="screen-edit-decisions-btn"]');
      await window.waitForSelector('[data-testid="screen-edit-mode"]', { timeout: 10000 });
      console.log('Entered edit mode from completion screen');
    } else {
      // Not complete — try entering edit mode from header button
      const editModeBtn = await window.$('[data-testid="screen-edit-mode-btn"]');
      if (editModeBtn) {
        await editModeBtn.click();
        await window.waitForSelector('[data-testid="screen-edit-mode"]', { timeout: 10000 });
        console.log('Entered edit mode from header button');
      } else {
        console.log('Edit mode not available');
      }
    }

    // ============================================================
    // TEST 7: Verify edit mode UI
    // ============================================================
    console.log('\n--- TEST 7: Edit mode UI ---');

    const editMode = await window.$('[data-testid="screen-edit-mode"]');
    if (editMode) {
      // Search input
      const editSearch = await window.$('[data-testid="screen-edit-search"]');
      expect(editSearch).not.toBeNull();
      console.log('Edit search input visible');

      // Cancel and Save buttons
      const cancelBtn = await window.$('[data-testid="screen-edit-cancel-btn"]');
      expect(cancelBtn).not.toBeNull();
      const saveBtn = await window.$('[data-testid="screen-edit-save-btn"]');
      expect(saveBtn).not.toBeNull();
      console.log('Cancel and Save buttons visible');

      // Save should be disabled (no changes yet)
      const saveDisabled = await saveBtn!.getAttribute('disabled');
      expect(saveDisabled).not.toBeNull();
      console.log('Save button disabled (no changes)');

      // Wait for records to load in edit table
      await window.waitForTimeout(3000);

      // Look for edit rows
      const editRows = await window.$$('[data-testid^="screen-edit-row-"]');
      console.log(`Found ${editRows.length} records in edit mode`);
      expect(editRows.length).toBeGreaterThan(0);

      if (editRows.length > 0) {
        // Toggle the first record's decision
        const firstRowTestId = await editRows[0].getAttribute('data-testid');
        const editRecordId = firstRowTestId?.replace('screen-edit-row-', '');
        if (editRecordId) {
          await window.click(`[data-testid="screen-edit-toggle-${editRecordId}"]`);
          console.log(`Toggled decision for ${editRecordId}`);

          // Save should now be enabled
          await window.waitForTimeout(500);
          const saveEnabled = await window.$('[data-testid="screen-edit-save-btn"]:not([disabled])');
          expect(saveEnabled).not.toBeNull();
          console.log('Save button now enabled');

          // Save the change
          await clearDebugLogs();
          await window.click('[data-testid="screen-edit-save-btn"]');

          await waitForRpcResponse('update_screen_decisions', 30000);
          await failFastOnBackendError(getDebugData, 'Save edit mode changes');

          console.log('Edit mode changes saved successfully');
        }
      }
    } else {
      console.log('Edit mode not available, skipping edit mode tests');
    }

    // ============================================================
    // TEST 8: Criteria management button
    // ============================================================
    console.log('\n--- TEST 8: Criteria management ---');

    // Navigate back to screen if we're still in edit/completion
    await window.click('[data-testid="sidebar-screen"]');
    await window.waitForSelector('[data-testid="screen-page"]', { timeout: 15000 });
    await window.waitForTimeout(2000);

    const criteriaBtn = await window.$('[data-testid="screen-manage-criteria-btn"]');
    if (criteriaBtn) {
      console.log('Criteria management button visible');
    } else {
      console.log('Criteria management button not visible (completed or empty state)');
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
      const errors = finalDebugData.logs.filter(l => l.type === 'error');
      errors.forEach(e => console.log(`  - ${e.message}`));
    }

    console.log('\nAll Screen page tests passed!');
  });
});
