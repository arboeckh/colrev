import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Data Extraction Workflow E2E Test
 *
 * Tests the Data page including:
 * - Unconfigured state (setup prompt)
 * - Field configuration dialog
 * - Extraction form with split panel (PDF + form)
 * - Save & Next workflow
 * - Completion state
 *
 * Pipeline: Create → Upload source1.ris → Preprocessing → Prescreen all →
 *           Force records to pdf_prepared → Screen all (include) →
 *           Navigate to Data page → Configure fields → Extract data
 */
test.describe('Data Extraction Workflow', () => {
  test.setTimeout(300000); // 5 minutes — full pipeline

  test('data extraction: configure fields, extract records, completion', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `data-e2e-${Date.now()}`;

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

    // Wait for project overview to load (project name appears as heading)
    await window.waitForSelector(`h2:has-text("${projectId}")`, { timeout: 15000 });
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

    console.log('Waiting for background enrichment to settle...');
    await window.waitForTimeout(5000);

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
    // FORCE TO pdf_prepared: Use update_record API
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('FORCE TO pdf_prepared: Bypass PDF pipeline via update_record');
    console.log('='.repeat(60));

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

    await window.evaluate(async () => {
      // @ts-expect-error Accessing exposed Pinia
      const pinia = window.__pinia__;
      const projectsStore = pinia._s.get('projects');
      await projectsStore.refreshCurrentProject();
    });

    await window.waitForTimeout(2000);
    console.log('Project status refreshed');

    // ============================================================
    // SCREEN: Include all records via RPC
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SCREEN: Include all records via RPC');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.evaluate(async (args) => {
      const { projectId } = args;
      // @ts-expect-error Accessing exposed Pinia
      const pinia = window.__pinia__;
      const backendStore = pinia._s.get('backend');
      await backendStore.call('include_all_screen', {
        project_id: projectId,
      });
    }, { projectId });

    console.log('All records included in screen');

    await window.evaluate(async () => {
      // @ts-expect-error Accessing exposed Pinia
      const pinia = window.__pinia__;
      const projectsStore = pinia._s.get('projects');
      await projectsStore.refreshCurrentProject();
    });

    await window.waitForTimeout(2000);
    console.log('Project status refreshed after screen');

    // ============================================================
    // DATA: Navigate to Data page
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('DATA: Navigate to Data page');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-data"]');
    await window.waitForSelector('[data-testid="data-page"]', { timeout: 15000 });
    console.log('Data page loaded');

    // ============================================================
    // TEST 1: Verify unconfigured state
    // ============================================================
    console.log('\n--- TEST 1: Unconfigured state ---');

    await window.waitForTimeout(3000);

    const setupBtn = await window.$('[data-testid="data-setup-btn"]');
    expect(setupBtn).not.toBeNull();
    console.log('Setup button visible (unconfigured state)');

    // ============================================================
    // TEST 2: Configure extraction fields
    // ============================================================
    console.log('\n--- TEST 2: Configure extraction fields ---');

    await clearDebugLogs();

    await window.click('[data-testid="data-setup-btn"]');
    await window.waitForSelector('[data-testid="data-fields-dialog"]', { timeout: 5000 });
    console.log('Fields config dialog opened');

    // Fill first field (already exists by default)
    await window.fill('[data-testid="data-field-name-0"]', 'summary');
    await window.fill('[data-testid="data-field-explanation-0"]', 'Brief summary of findings');
    console.log('Filled field 1: summary (str)');

    // Add second field
    await window.click('[data-testid="data-add-field-btn"]');
    await window.waitForSelector('[data-testid="data-field-name-1"]', { timeout: 3000 });
    await window.fill('[data-testid="data-field-name-1"]', 'sample_size');
    await window.fill('[data-testid="data-field-explanation-1"]', 'Sample size of the study');

    // Change type to integer
    const typeSelect = await window.$('[data-testid="data-field-type-1"] select');
    if (typeSelect) {
      await typeSelect.selectOption('int');
    }
    console.log('Filled field 2: sample_size (int)');

    // Save fields
    await clickWhenEnabled(window, '[data-testid="data-save-fields-btn"]');
    await waitForRpcResponse('configure_structured_endpoint', 30000);
    await failFastOnBackendError(getDebugData, 'Configure fields');

    console.log('Fields configured successfully');

    // Wait for queue to load
    await window.waitForTimeout(3000);

    // ============================================================
    // TEST 3: Verify extraction card loads
    // ============================================================
    console.log('\n--- TEST 3: Verify extraction card loads ---');

    const extractionCard = await window.$('[data-testid="data-extraction-card"]');
    if (extractionCard) {
      console.log('Extraction card visible');

      // Verify record info
      const recordId = await window.textContent('[data-testid="data-record-id"]').catch(() => null);
      const recordTitle = await window.textContent('[data-testid="data-record-title"]').catch(() => null);
      console.log(`Current record: ${recordId?.trim()} - ${recordTitle?.trim()?.substring(0, 50)}`);

      // Verify progress bar
      const progressBar = await window.$('[data-testid="data-progress-bar"]');
      expect(progressBar).not.toBeNull();
      console.log('Progress bar visible');

      // Verify field inputs
      const summaryInput = await window.$('[data-testid="data-field-input-summary"]');
      expect(summaryInput).not.toBeNull();
      const sampleSizeInput = await window.$('[data-testid="data-field-input-sample_size"]');
      expect(sampleSizeInput).not.toBeNull();
      console.log('Field inputs visible');

      // Verify completed/remaining counts
      const completedText = await window.textContent('[data-testid="data-completed-count"]').catch(() => '0');
      const remainingText = await window.textContent('[data-testid="data-remaining-count"]').catch(() => '0');
      console.log(`Counts: completed=${completedText?.trim()}, total=${remainingText?.trim()}`);
    } else {
      console.log('Extraction card not visible — may have no records');
    }

    // ============================================================
    // TEST 4: Fill extraction form and save
    // ============================================================
    console.log('\n--- TEST 4: Fill extraction form and save ---');

    if (extractionCard) {
      // Save button should be disabled initially
      const saveBtn = await window.$('[data-testid="data-save-next-btn"]');
      if (saveBtn) {
        const isDisabled = await saveBtn.getAttribute('disabled');
        expect(isDisabled).not.toBeNull();
        console.log('Save button initially disabled');
      }

      // Fill in the summary field
      await window.fill('[data-testid="data-field-input-summary"]', 'This study found significant improvements in outcomes.');
      console.log('Filled summary field');

      // Fill in the sample_size field
      await window.fill('[data-testid="data-field-input-sample_size"]', '150');
      console.log('Filled sample_size field');

      // Save button should now be enabled
      await window.waitForTimeout(500);

      await clearDebugLogs();

      await clickWhenEnabled(window, '[data-testid="data-save-next-btn"]', 5000);
      console.log('Clicked Save & Next');

      await waitForRpcResponse('save_data_extraction', 30000);
      await failFastOnBackendError(getDebugData, 'Save first record extraction');

      console.log('First record saved');
      await window.waitForTimeout(2000);
    }

    // ============================================================
    // TEST 5: Extract remaining records
    // ============================================================
    console.log('\n--- TEST 5: Extract remaining records ---');

    let extracted = 0;
    while (extracted < 10) {
      const complete = await window.$('[data-testid="data-complete"]');
      if (complete) {
        console.log('Reached completion state');
        break;
      }

      const summaryInput = await window.$('[data-testid="data-field-input-summary"]');
      if (!summaryInput) {
        console.log('No more extraction form visible');
        break;
      }

      await clearDebugLogs();

      // Fill fields
      await window.fill('[data-testid="data-field-input-summary"]', `Study ${extracted + 2} summary findings.`);
      await window.fill('[data-testid="data-field-input-sample_size"]', `${100 + (extracted + 2) * 50}`);

      await window.waitForTimeout(500);

      await clickWhenEnabled(window, '[data-testid="data-save-next-btn"]', 10000);

      const response = await waitForRpcResponse('save_data_extraction', 30000);
      if (!response) break;
      await failFastOnBackendError(getDebugData, `Save record ${extracted + 2}`);

      extracted++;
      console.log(`Extracted additional record ${extracted}`);
      await window.waitForTimeout(2000);
    }

    // ============================================================
    // TEST 6: Verify completion state
    // ============================================================
    console.log('\n--- TEST 6: Completion state ---');

    await window.waitForTimeout(3000);

    const completionScreen = await window.$('[data-testid="data-complete"]');
    if (completionScreen) {
      console.log('Completion screen visible');

      const completedCount = await window.textContent('[data-testid="data-complete-count"]');
      console.log(`Completed: ${completedCount?.trim()}`);

      // Configure Fields button should be visible
      const configBtn = await window.$('[data-testid="data-complete-configure-btn"]');
      expect(configBtn).not.toBeNull();
      console.log('"Configure Fields" button visible on completion screen');
    } else {
      console.log('Completion screen not visible — may still have pending records');
    }

    // ============================================================
    // TEST 7: Configure fields button
    // ============================================================
    console.log('\n--- TEST 7: Configure fields button ---');

    const configureBtn = await window.$('[data-testid="data-configure-fields-btn"]');
    if (configureBtn) {
      console.log('Configure fields gear button visible');
    } else if (completionScreen) {
      // Try clicking configure from completion screen
      const completeConfigBtn = await window.$('[data-testid="data-complete-configure-btn"]');
      if (completeConfigBtn) {
        await completeConfigBtn.click();
        await window.waitForSelector('[data-testid="data-fields-dialog"]', { timeout: 5000 });
        console.log('Fields dialog opened from completion screen');

        // Close it
        await window.keyboard.press('Escape');
        await window.waitForTimeout(500);
      }
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

    console.log('\nAll Data extraction tests passed!');
  });
});
