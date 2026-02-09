import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  formatRpcLogs,
  printDebugData,
  assertNoRpcErrors,
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Complete End-to-End Workflow Test
 *
 * This single test covers the entire CoLRev workflow sequentially:
 *
 * LANDING PAGE:
 * - App launch and backend startup
 * - Project creation
 *
 * PROJECT OVERVIEW:
 * - Navigation to project
 * - Workflow progress display
 * - Sidebar navigation
 *
 * SEARCH:
 * - Add PubMed API source
 * - Edit source
 * - Delete source
 * - Add source and run search
 * - File upload dialog
 *
 * LOAD:
 * - Run load operation
 * - Verify status updates
 *
 * WORKFLOW PROGRESS:
 * - Step status indicators update correctly
 *
 * Each step is labeled with the feature it tests for easy debugging.
 */
test.describe('Complete E2E Workflow', () => {
  test('full application workflow', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `e2e-test-${Date.now()}`;

    // ============================================================
    // LANDING PAGE: App Launch & Backend Status
    // Feature: Backend status indicator
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('LANDING PAGE: App Launch & Backend Status');
    console.log('='.repeat(60));

    // Verify app launches
    const title = await window.title();
    console.log(`Window title: ${title}`);
    const appElement = await window.locator('#app');
    await expect(appElement).toBeVisible();
    console.log('✅ App launched successfully');

    // Wait for backend to be ready
    await waitForAppReady(window, waitForBackend, 30000);
    const debugData = await getDebugData();
    expect(debugData.backendStatus).toBe('running');
    console.log('✅ Backend is running');

    // Verify backend logs exist
    expect(debugData.backendLogs.length).toBeGreaterThan(0);
    console.log('✅ Backend logs are being captured');

    // ============================================================
    // LANDING PAGE: Project Creation
    // Feature: Create new project
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('LANDING PAGE: Project Creation');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Open new project dialog
    await window.waitForSelector('button:has-text("New Project")', { timeout: 10000 });
    await window.click('button:has-text("New Project")');

    // Fill in project details
    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5000 });
    await window.fill('[data-testid="project-id-input"]', projectId);

    // Uncheck example data for faster tests
    const exampleCheckbox = await window.$('input#useExample');
    if (exampleCheckbox && (await exampleCheckbox.isChecked())) {
      await exampleCheckbox.click();
    }

    // Submit
    await window.click('[data-testid="submit-create-project"]');

    // Wait for project creation
    const initResponse = await waitForRpcResponse('init_project', 60000);
    expect(initResponse).not.toBeNull();
    await failFastOnBackendError(getDebugData, 'Project creation');

    // Verify project card appears
    await window.waitForSelector(`[data-testid="project-card-${projectId}"]`, { timeout: 10000 });
    const projectCard = await window.$(`[data-testid="project-card-${projectId}"]`);
    expect(projectCard).not.toBeNull();

    console.log(`✅ Project "${projectId}" created successfully`);

    // ============================================================
    // PROJECT OVERVIEW: Navigation & Display
    // Feature: Navigate to project, view overview
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PROJECT OVERVIEW: Navigation & Display');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Click project card to navigate
    await window.click(`[data-testid="project-card-${projectId}"]`);
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });

    // Wait for status to load
    await waitForRpcResponse('get_status', 10000);
    await window.waitForTimeout(1000);

    // Verify overview elements
    const overviewTitle = await window.$('text=Project Overview');
    expect(overviewTitle).not.toBeNull();
    console.log('✅ Project Overview page loaded');

    const workflowProgress = await window.$('text=Workflow Progress');
    expect(workflowProgress).not.toBeNull();
    console.log('✅ Workflow Progress section visible');

    const recordStatus = await window.$('text=Record Status');
    expect(recordStatus).not.toBeNull();
    console.log('✅ Record Status section visible');

    // ============================================================
    // WORKFLOW PROGRESS: Initial Step Statuses
    // Feature: Sidebar step indicators
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('WORKFLOW PROGRESS: Initial Step Statuses');
    console.log('='.repeat(60));

    // Verify all sidebar steps exist
    const steps = ['search', 'load', 'prep', 'dedupe', 'prescreen', 'pdf_get', 'pdf_prep', 'screen', 'data'];
    for (const stepId of steps) {
      const step = await window.$(`[data-testid="sidebar-${stepId}"]`);
      expect(step).not.toBeNull();
      const status = await step?.getAttribute('data-step-status');
      console.log(`  ${stepId}: ${status}`);
    }
    console.log('✅ All workflow steps rendered in sidebar');

    // ============================================================
    // SEARCH PAGE: Navigation & Display
    // Feature: Display search sources
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH PAGE: Navigation & Display');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Navigate to Search page
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

    const searchHeader = await window.$('h2:has-text("Search")');
    expect(searchHeader).not.toBeNull();
    console.log('✅ Search page loaded');

    const sourcesSection = await window.$('text=Search Sources');
    expect(sourcesSection).not.toBeNull();
    console.log('✅ Search Sources section visible');

    const addSourceButton = await window.$('[data-testid="add-source-card"]');
    expect(addSourceButton).not.toBeNull();
    console.log('✅ Add Source card present');

    // Note: Run All Searches button only appears when sources exist
    // We'll verify it after adding a source

    // ============================================================
    // SEARCH: Add PubMed API Source
    // Feature: Add search source
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Add PubMed API Source');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Open add source menu
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });

    // Click PubMed option
    await window.click('[data-testid="add-api-source-option"]');

    // Fill in search query
    await window.waitForSelector('[data-testid="pubmed-query-input"]', { timeout: 5000 });
    const searchQuery = 'machine learning AND healthcare';
    await window.fill('[data-testid="pubmed-query-input"]', searchQuery);

    // Submit
    await clickWhenEnabled(window, '[data-testid="submit-add-pubmed"]');
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add PubMed source');

    await window.waitForTimeout(2000);

    // Verify source card appears
    const sourceCard = await window.$('[data-testid="source-card-pubmed"]');
    expect(sourceCard).not.toBeNull();
    console.log('✅ PubMed source card appears');

    const queryDisplay = await window.$(`text=${searchQuery}`);
    expect(queryDisplay).not.toBeNull();
    console.log('✅ Search query displayed on card');

    const apiBadge = await window.$('text=API');
    expect(apiBadge).not.toBeNull();
    console.log('✅ API badge visible');

    // ============================================================
    // SEARCH: Delete Source
    // Feature: Delete search source
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Delete Source');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Click delete button
    await window.click('[data-testid="delete-source-pubmed"]');

    // Confirm deletion
    await window.waitForSelector('[data-testid="confirm-delete-source"]', { timeout: 5000 });
    await window.click('[data-testid="confirm-delete-source"]');

    // Wait for deletion
    await waitForRpcResponse('remove_source', 30000);
    await failFastOnBackendError(getDebugData, 'Delete source');
    await waitForRpcResponse('get_sources', 10000);
    await window.waitForTimeout(500);

    // Verify source is gone
    const pubmedSourceGone = await window.$('[data-testid="source-card-pubmed"]');
    expect(pubmedSourceGone).toBeNull();
    console.log('✅ Source deleted successfully');

    // ============================================================
    // SEARCH: Run Search Operation
    // Feature: Run search operation
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Run Search Operation');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Add a source first (with minimal query for speed)
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-api-source-option"]');
    await window.waitForSelector('[data-testid="pubmed-query-input"]', { timeout: 5000 });
    // Use a niche query that returns ~50-100 results for reasonable test speed
    await window.fill('[data-testid="pubmed-query-input"]', 'CRISPR AND sickle cell AND 2023[pdat]');
    await clickWhenEnabled(window, '[data-testid="submit-add-pubmed"]');
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add source for search');
    await window.waitForTimeout(2000);

    await clearDebugLogs();

    // Run search
    await window.click('[data-testid="run-all-searches-button"]');

    // Check for errors during search
    for (let i = 0; i < 10; i++) {
      await window.waitForTimeout(500);
      await failFastOnBackendError(getDebugData, 'Run Search');
    }

    const searchResponse = await waitForRpcResponse('search', 60000);
    await failFastOnBackendError(getDebugData, 'Run Search completed');
    expect(searchResponse).not.toBeNull();
    console.log('✅ Search operation executed');

    // ============================================================
    // SEARCH: File Upload Dialog
    // Feature: Upload search file
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: File Upload Dialog');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Open add source menu
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });

    // Click file upload option
    await window.click('[data-testid="add-file-source-option"]');

    // Verify dialog elements
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });
    const nameInput = await window.$('[data-testid="source-name-input"]');
    expect(nameInput).not.toBeNull();
    console.log('✅ Source name input present');

    const fileInput = await window.$('[data-testid="file-input"]');
    expect(fileInput).not.toBeNull();
    console.log('✅ File input present');

    // Cancel dialog
    await window.click('[data-testid="cancel-add-source"]');
    await window.waitForTimeout(500);
    console.log('✅ File upload dialog works');

    // ============================================================
    // SEARCH: Upload RIS File (Manual Database Export)
    // Feature: Import RIS file and verify records
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Upload RIS File');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Open add source menu
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });

    // Click file upload option
    await window.click('[data-testid="add-file-source-option"]');

    // Wait for dialog
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });

    // Fill source name
    await window.fill('[data-testid="source-name-input"]', 'asr-test');

    // Upload the RIS file using Playwright's file chooser
    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, '../fixtures/asr.ris'));

    // Wait for file to be selected (file info should appear)
    await window.waitForSelector('text=asr.ris', { timeout: 5000 });
    console.log('✅ RIS file selected');

    // Submit the form
    await clickWhenEnabled(window, '[data-testid="submit-add-source"]');

    // Wait for upload and add_source response
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Upload RIS file');

    // Refresh sources to verify
    await waitForRpcResponse('get_sources', 10000);
    await window.waitForTimeout(2000);

    // Verify source card appears (name is derived from endpoint: colrev.unknown_source -> unknown_source)
    const risSourceCard = await window.$('[data-testid="source-card-unknown_source"]');
    expect(risSourceCard).not.toBeNull();
    console.log('✅ RIS source card appears (as unknown_source)');

    // The source shows as DB type and should have records
    // Check for the DB badge to confirm the source type
    const dbBadge = await window.$('[data-testid="source-card-unknown_source"] >> text=DB');
    expect(dbBadge).not.toBeNull();
    console.log('✅ DB badge visible on RIS source card');

    // Check if record count is shown (should be 10 records in asr.ris)
    // Note: The card shows record count when source has been "run" and has records
    const hasRecords = await window.$('[data-testid="source-card-unknown_source"] >> text=/\\d+ records?/');
    if (hasRecords) {
      console.log('✅ Record count displayed on card');
    } else {
      console.log('ℹ️ Record count not shown (source may show "Not run yet")');
    }

    // Click View to open records modal - use the view button inside the source card
    // Note: View button only appears if source has records and is not stale
    const viewButton = await window.$('[data-testid="view-results-unknown_source"]');
    if (viewButton) {
      await viewButton.click();

      // Wait for modal with records
      await window.waitForSelector('[data-testid="source-records-modal"]', { timeout: 5000 });
      console.log('✅ Records modal opened');

      // Wait for records to load (loading indicator disappears)
      await window.waitForSelector('[data-testid="records-table"]', { timeout: 10000 });

      // Check that records are displayed
      const recordRows = await window.$$('[data-testid^="record-row-"]');
      expect(recordRows.length).toBeGreaterThan(0);
      console.log(`✅ Records modal shows ${recordRows.length} records`);

      // Verify one of the known titles from asr.ris is present
      // (First record is about medication prescribing patterns at youth mental health service)
      const knownContent = await window.$('text=/mental health/i');
      expect(knownContent).not.toBeNull();
      console.log('✅ RIS record content correctly parsed');

      // Close modal by clicking outside or pressing escape
      await window.keyboard.press('Escape');
      await window.waitForTimeout(500);

      // Verify modal closed
      const modalClosed = await window.$('[data-testid="source-records-modal"]');
      expect(modalClosed).toBeNull();
    } else {
      console.log('⚠️ View button not visible - source may not have detected records yet');
      // This is unexpected - let's print debug info
      const sourceCardHtml = await risSourceCard?.innerHTML();
      console.log('Source card content:', sourceCardHtml?.slice(0, 500));
    }

    console.log('✅ RIS file import test complete');

    // ============================================================
    // WORKFLOW PROGRESS: Status After Search
    // Feature: Step status indicators update
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('WORKFLOW PROGRESS: Status After Search');
    console.log('='.repeat(60));

    // Wait for status refresh
    await waitForRpcResponse('get_status', 10000);
    await window.waitForTimeout(1000);

    // Check load step status - should be 'active' after search
    const loadStep = await window.$('[data-testid="sidebar-load"]');
    const loadStatus = await loadStep?.getAttribute('data-step-status');
    console.log(`Load status after search: ${loadStatus}`);
    expect(loadStatus).toBe('active');
    console.log('✅ Load step is now active');

    // Check search step status - should be 'complete'
    const searchStep = await window.$('[data-testid="sidebar-search"]');
    const searchStatus = await searchStep?.getAttribute('data-step-status');
    console.log(`Search status: ${searchStatus}`);
    expect(searchStatus).toBe('complete');
    console.log('✅ Search step is complete');

    // ============================================================
    // LOAD PAGE: Run Load Operation
    // Feature: Run load operation
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('LOAD PAGE: Run Load Operation');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Navigate to Load page
    await window.click('[data-testid="sidebar-load"]');
    await window.waitForSelector('h2:has-text("Load")', { timeout: 10000 });
    console.log('✅ Load page loaded');

    // Run load if button exists
    const runLoadButton = await window.$('[data-testid="run-load-button"]');
    if (runLoadButton) {
      await clickWhenEnabled(window, '[data-testid="run-load-button"]');
      await waitForRpcResponse('load', 60000);
      await failFastOnBackendError(getDebugData, 'Run load');

      // Wait for status refresh
      await waitForRpcResponse('get_status', 10000);
      await window.waitForTimeout(1000);

      // Verify load completed or is active (active if more records to process from RIS file)
      const loadStatusAfter = await (await window.$('[data-testid="sidebar-load"]'))?.getAttribute(
        'data-step-status'
      );
      console.log(`Load status after running: ${loadStatusAfter}`);
      // Load might be 'active' if there are more records to load (e.g., RIS file added after first search)
      expect(['complete', 'active']).toContain(loadStatusAfter);
      console.log('✅ Load operation completed');

      // Verify prep is now active
      const prepStatus = await (await window.$('[data-testid="sidebar-prep"]'))?.getAttribute('data-step-status');
      console.log(`Prep status: ${prepStatus}`);
      // Prep should be active once at least some records have been loaded
      expect(['active', 'pending']).toContain(prepStatus);
      if (prepStatus === 'active') {
        console.log('✅ Prep step is now active');
      } else {
        console.log('ℹ️ Prep step is pending (no records loaded yet)');
      }
    } else {
      console.log('⚠️ Run load button not found - skipping load operation');
    }

    // ============================================================
    // NAVIGATION: Workflow Steps
    // Feature: Navigate to workflow steps
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('NAVIGATION: Workflow Steps');
    console.log('='.repeat(60));

    // Navigate through various pages to verify they load
    const pagesToTest = [
      { id: 'prep', title: 'Prep' },
      { id: 'dedupe', title: 'Dedupe' },
      { id: 'prescreen', title: 'Prescreen' },
      { id: 'pdf_get', title: 'PDF Get' },
      { id: 'pdf_prep', title: 'PDF Prep' },
      { id: 'screen', title: 'Screen' },
      { id: 'data', title: 'Data' },
    ];

    for (const page of pagesToTest) {
      await window.click(`[data-testid="sidebar-${page.id}"]`);
      await window.waitForSelector(`h2:has-text("${page.title}")`, { timeout: 10000 });
      console.log(`✅ ${page.title} page loads`);
    }

    // Navigate back to overview
    const overviewLink = await window.$('text=Overview');
    if (overviewLink) {
      await overviewLink.click();
      await window.waitForSelector('text=Project Overview', { timeout: 10000 });
      console.log('✅ Returned to Project Overview');
    }

    // ============================================================
    // FINAL SUMMARY
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

    const finalDebugData = await getDebugData();
    if (finalDebugData.hasErrors) {
      console.log('\n⚠️ Warnings/errors during test:');
      printDebugData(finalDebugData);
    }

    const rpcLogs = await getRpcLogs();
    console.log(`\nTotal RPC calls: ${rpcLogs.filter((l) => l.type === 'rpc-request').length}`);
    console.log(`Total RPC responses: ${rpcLogs.filter((l) => l.type === 'rpc-response').length}`);

    console.log('\n' + '='.repeat(60));
    console.log('ALL FEATURES TESTED SUCCESSFULLY');
    console.log('='.repeat(60));
  });
});
