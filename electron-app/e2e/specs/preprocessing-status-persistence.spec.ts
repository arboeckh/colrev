import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Preprocessing Status Persistence E2E Test
 *
 * Regression test for a bug where preprocessing stages showed as "pending"
 * after navigating away and back, even though all stages completed successfully.
 *
 * Root cause: The prepCompleted check required md_needs_manual_preparation === 0,
 * but records from unknown sources (like arxiv RIS imports) often remain in that
 * state because they're missing journal/volume/number fields. The automated prep
 * step has done its job — these records just need optional manual attention.
 *
 * This test:
 * 1. Creates a project with arxiv RIS records (which produce md_needs_manual_preparation)
 * 2. Runs preprocessing (Load → Prep → Dedupe)
 * 3. Navigates away to Overview
 * 4. Navigates back to Preprocessing
 * 5. Verifies all stages still show as "complete" and the final record count is visible
 */
test.describe('Preprocessing Status Persistence', () => {
  test.setTimeout(120000);

  test('stages show as complete after navigation when records need manual prep', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `status-persist-${Date.now()}`;

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
    console.log(`✅ Project "${projectId}" created`);

    // ============================================================
    // SEARCH: Add arxiv RIS file (produces md_needs_manual_preparation records)
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Add arxiv_references.ris (2 records)');
    console.log('='.repeat(60));

    await clearDebugLogs();
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-file-source-option"]');
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });

    await window.fill('[data-testid="source-name-input"]', 'arxiv');

    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, '../fixtures/arxiv_references.ris'));
    await window.waitForSelector('text=arxiv_references.ris', { timeout: 5000 });

    // Search query is required
    await window.fill('[data-testid="search-query-input"]', 'arxiv dark matter RFI');

    await clickWhenEnabled(window, '[data-testid="submit-add-source"]');
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Upload arxiv_references.ris');
    await window.waitForTimeout(1000);
    console.log('✅ Arxiv RIS file added');

    // ============================================================
    // PREPROCESSING: Navigate and run all stages
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PREPROCESSING: Run all stages');
    console.log('='.repeat(60));

    await clearDebugLogs();
    await window.click('[data-testid="sidebar-preprocessing"]');
    await window.waitForSelector('[data-testid="preprocessing-page"]', { timeout: 10000 });

    // Click Run All
    await clickWhenEnabled(window, '[data-testid="preprocessing-run-all-button"]');
    console.log('Clicked Run All button');

    // Poll for completion
    const maxWaitTime = 90000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await failFastOnBackendError(getDebugData, 'Preprocessing operations');

      const dedupeStatus = await window.$eval(
        '[data-testid="preprocessing-step-dedupe"]',
        (el) => el.getAttribute('data-status')
      ).catch(() => 'pending');

      if (dedupeStatus === 'complete') {
        console.log('✅ All stages completed');
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
      console.log(`[${elapsed}s] Status - Load: ${loadStatus}, Prep: ${prepStatus}, Dedupe: ${dedupeStatus}`);

      await window.waitForTimeout(1000);
    }

    // Verify initial completion
    const initialDedupeStatus = await window.$eval(
      '[data-testid="preprocessing-step-dedupe"]',
      (el) => el.getAttribute('data-status')
    ).catch(() => 'pending');

    if (initialDedupeStatus !== 'complete') {
      const debugData = await getDebugData();
      console.log('=== Backend Logs ===');
      debugData.backendLogs.slice(-30).forEach(l => console.log(l));
      throw new Error(`Preprocessing did not complete. Final dedupe status: ${initialDedupeStatus}`);
    }

    // Give UI time to settle
    await window.waitForTimeout(2000);

    // Verify all stages show complete BEFORE navigation
    let loadStatus = await window.$eval('[data-testid="preprocessing-step-load"]', el => el.getAttribute('data-status')).catch(() => 'unknown');
    let prepStatus = await window.$eval('[data-testid="preprocessing-step-prep"]', el => el.getAttribute('data-status')).catch(() => 'unknown');
    let dedupeStatus = await window.$eval('[data-testid="preprocessing-step-dedupe"]', el => el.getAttribute('data-status')).catch(() => 'unknown');

    console.log(`Before nav - Load: ${loadStatus}, Prep: ${prepStatus}, Dedupe: ${dedupeStatus}`);
    expect(loadStatus).toBe('complete');
    expect(prepStatus).toBe('complete');
    expect(dedupeStatus).toBe('complete');

    // ============================================================
    // NAVIGATE AWAY: Go to Overview
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('NAVIGATE AWAY: Go to Overview');
    console.log('='.repeat(60));

    await window.click('[data-testid="sidebar-overview"]');
    await window.waitForSelector('text=Project Overview', { timeout: 10000 });
    console.log('✅ On Overview page');

    // ============================================================
    // NAVIGATE BACK: Return to Preprocessing
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('NAVIGATE BACK: Return to Preprocessing');
    console.log('='.repeat(60));

    await window.click('[data-testid="sidebar-preprocessing"]');
    await window.waitForSelector('[data-testid="preprocessing-page"]', { timeout: 10000 });
    // Wait for status to be fetched and computed
    await window.waitForTimeout(2000);

    // ============================================================
    // VERIFICATION: Stages should still show as complete
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VERIFICATION: Stages should still be complete after navigation');
    console.log('='.repeat(60));

    loadStatus = await window.$eval('[data-testid="preprocessing-step-load"]', el => el.getAttribute('data-status')).catch(() => 'unknown');
    prepStatus = await window.$eval('[data-testid="preprocessing-step-prep"]', el => el.getAttribute('data-status')).catch(() => 'unknown');
    dedupeStatus = await window.$eval('[data-testid="preprocessing-step-dedupe"]', el => el.getAttribute('data-status')).catch(() => 'unknown');

    console.log(`After nav - Load: ${loadStatus}, Prep: ${prepStatus}, Dedupe: ${dedupeStatus}`);

    // THIS IS THE KEY ASSERTION: all stages should be complete even after navigation
    // Previously, prep and dedupe would show as "pending" because md_needs_manual_preparation > 0
    expect(loadStatus).toBe('complete');
    expect(prepStatus).toBe('complete');
    expect(dedupeStatus).toBe('complete');

    // Also verify the final dataset count is visible (not showing "Pending")
    const finalDatasetText = await window.textContent('[data-testid="preprocessing-flow-diagram"]');
    console.log('Flow diagram text:', finalDatasetText);
    expect(finalDatasetText).toContain('Final Dataset');
    expect(finalDatasetText).toContain('records');

    console.log('\n✅ Test passed: preprocessing stages persist as complete after navigation');
  });
});
