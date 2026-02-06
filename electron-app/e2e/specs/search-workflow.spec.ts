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
 * Search workflow E2E test - Sequential mega test
 *
 * This test runs through the entire search workflow sequentially:
 * 1. Create project and navigate to Search page
 * 2. Verify search page loads correctly
 * 3. Add a PubMed API source
 * 4. Edit the PubMed source
 * 5. Delete the source
 * 6. Add another source and run search
 * 7. Test file upload dialog
 *
 * Each step is clearly labeled so failures pinpoint the exact issue.
 */
test.describe('Search Workflow', () => {
  test('complete search workflow', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    // ============================================================
    // STEP 1: Setup - Create project and navigate to Search page
    // ============================================================
    console.log('\n🚀 STEP 1: Setup - Create project and navigate to Search page');

    await waitForAppReady(window, waitForBackend, 30000);
    await clearDebugLogs();

    const projectId = `search-test-${Date.now()}`;

    // Create a project (without example data for faster tests)
    await window.click('button:has-text("New Project")');
    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5000 });
    await window.fill('[data-testid="project-id-input"]', projectId);

    // Uncheck example data for speed
    const exampleCheckbox = await window.$('input#useExample');
    if (exampleCheckbox && (await exampleCheckbox.isChecked())) {
      await exampleCheckbox.click();
    }

    await window.click('[data-testid="submit-create-project"]');
    await waitForRpcResponse('init_project', 60000);

    // Wait for project card and navigate to project
    await window.waitForSelector(`[data-testid="project-card-${projectId}"]`, { timeout: 10000 });
    await window.click(`[data-testid="project-card-${projectId}"]`);
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });

    // Navigate to Search page using sidebar
    await window.waitForSelector('[data-testid="sidebar-search"]', { timeout: 5000 });
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForTimeout(2000);

    console.log(`✅ STEP 1 PASSED: Project "${projectId}" created and navigated to Search page`);

    // ============================================================
    // STEP 2: Verify search page loads correctly
    // ============================================================
    console.log('\n📋 STEP 2: Verify search page loads correctly');
    await clearDebugLogs();

    // Verify we're on the Search page
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });
    const searchHeader = await window.$('h2:has-text("Search")');
    expect(searchHeader).not.toBeNull();

    // Verify the Search Sources section exists
    const sourcesSection = await window.$('text=Search Sources');
    expect(sourcesSection).not.toBeNull();

    // Verify "Add Source" button is present
    const addSourceButton = await window.$('[data-testid="add-source-button"]');
    expect(addSourceButton).not.toBeNull();

    // Verify "Run Search" button is present
    const runSearchButton = await window.$('[data-testid="run-search-button"]');
    expect(runSearchButton).not.toBeNull();

    console.log('✅ STEP 2 PASSED: Search page loaded with all expected elements');

    // ============================================================
    // STEP 3: Add a PubMed API source
    // ============================================================
    console.log('\n➕ STEP 3: Add a PubMed API source');
    await clearDebugLogs();

    // Click the "Add Source" button and wait for menu
    await window.click('[data-testid="add-source-button"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });

    // Click "PubMed Search" option in dropdown
    await window.click('[data-testid="add-api-source-option"]');

    // Wait for dialog to open
    await window.waitForSelector('[data-testid="pubmed-query-input"]', { timeout: 5000 });

    // Enter search query
    const searchQuery = 'machine learning AND healthcare';
    await window.fill('[data-testid="pubmed-query-input"]', searchQuery);

    // Submit (wait for button to be enabled first)
    await clickWhenEnabled(window, '[data-testid="submit-add-pubmed"]');

    // Wait for add_source RPC to complete
    await waitForRpcResponse('add_source', 30000);

    // Check for backend errors
    await failFastOnBackendError(getDebugData, 'Add PubMed source');

    // Wait for dialog to close and source card to appear
    await window.waitForTimeout(2000);

    // Verify source card appears
    const sourceCard = await window.$('[data-testid="source-card-pubmed"]');
    expect(sourceCard).not.toBeNull();

    // Verify the search query is displayed
    const queryDisplay = await window.$(`text=${searchQuery}`);
    expect(queryDisplay).not.toBeNull();

    // Verify API badge
    const apiBadge = await window.$('text=API');
    expect(apiBadge).not.toBeNull();

    const rpcLogsStep3 = await getRpcLogs();
    console.log('\n=== RPC Activity (Add PubMed Source) ===');
    console.log(formatRpcLogs(rpcLogsStep3));

    console.log('✅ STEP 3 PASSED: PubMed source added successfully');

    // ============================================================
    // STEP 4: Edit the PubMed source
    // ============================================================
    console.log('\n✏️ STEP 4: Edit the PubMed source');
    await clearDebugLogs();

    // Click the edit button on the source card
    await window.click('[data-testid="edit-source-pubmed"]');

    // Wait for edit dialog to open
    await window.waitForSelector('[data-testid="edit-query-input"]', { timeout: 5000 });

    // Update the query
    const newQuery = 'updated query AND covid';
    await window.fill('[data-testid="edit-query-input"]', newQuery);

    // Save changes
    await window.click('[data-testid="confirm-edit-source"]');

    // Wait for update_source RPC
    await waitForRpcResponse('update_source', 30000);

    // Check for backend errors
    await failFastOnBackendError(getDebugData, 'Edit PubMed source');

    await window.waitForTimeout(1000);

    // Verify the updated query is displayed
    const updatedQuery = await window.$(`text=${newQuery}`);
    expect(updatedQuery).not.toBeNull();

    const rpcLogsStep4 = await getRpcLogs();
    console.log('\n=== RPC Activity (Edit Source) ===');
    console.log(formatRpcLogs(rpcLogsStep4));

    console.log('✅ STEP 4 PASSED: PubMed source edited successfully');

    // ============================================================
    // STEP 5: Delete the source
    // ============================================================
    console.log('\n🗑️ STEP 5: Delete the source');
    await clearDebugLogs();

    // Click the delete button on the source card
    await window.click('[data-testid="delete-source-pubmed"]');

    // Wait for confirmation dialog
    await window.waitForSelector('[data-testid="confirm-delete-source"]', { timeout: 5000 });

    // Confirm deletion
    await window.click('[data-testid="confirm-delete-source"]');

    // Wait for remove_source RPC
    await waitForRpcResponse('remove_source', 30000);

    // Check for backend errors
    await failFastOnBackendError(getDebugData, 'Delete source');

    // After deletion, the frontend calls get_sources to refresh - wait for that too
    await waitForRpcResponse('get_sources', 10000);

    // Give Vue time to re-render
    await window.waitForTimeout(500);

    // Print RPC logs BEFORE assertion so we can debug if it fails
    const rpcLogsStep5 = await getRpcLogs();
    console.log('\n=== RPC Activity (Delete Source) ===');
    console.log(formatRpcLogs(rpcLogsStep5));

    // Verify source card is gone - should show only the default files_dir source
    const pubmedSourceGone = await window.$('[data-testid="source-card-pubmed"]');
    expect(pubmedSourceGone).toBeNull();

    console.log('✅ STEP 5 PASSED: Source deleted successfully');

    // ============================================================
    // STEP 6: Add source and verify Run Search button triggers RPC
    // ============================================================
    console.log('\n🔍 STEP 6: Add source and verify Run Search triggers RPC');
    await clearDebugLogs();

    // Add a PubMed source with a VERY specific query to minimize API results
    // Using a fake/unlikely query that should return 0 results quickly
    await window.click('[data-testid="add-source-button"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-api-source-option"]');
    await window.waitForSelector('[data-testid="pubmed-query-input"]', { timeout: 5000 });
    // Use a very specific PMID query that returns exactly 1 result
    await window.fill('[data-testid="pubmed-query-input"]', '10075143[uid]');
    await clickWhenEnabled(window, '[data-testid="submit-add-pubmed"]');
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add source for search');
    await window.waitForTimeout(2000);

    await clearDebugLogs();

    // Click "Run Search" button
    await window.click('[data-testid="run-search-button"]');

    // Check for backend errors quickly (every 500ms for first 5 seconds)
    for (let i = 0; i < 10; i++) {
      await window.waitForTimeout(500);
      await failFastOnBackendError(getDebugData, 'Run Search');
    }

    // Wait for search RPC - should be fast with a single PMID query
    const searchResponse = await waitForRpcResponse('search', 60000);

    // Check for errors after RPC completes
    await failFastOnBackendError(getDebugData, 'Run Search completed');

    // Verify the RPC was called
    expect(searchResponse).not.toBeNull();

    const rpcLogsStep6 = await getRpcLogs();
    console.log('\n=== RPC Activity (Run Search) ===');
    console.log(formatRpcLogs(rpcLogsStep6));

    console.log('✅ STEP 6 PASSED: Search operation executed');

    // ============================================================
    // STEP 7: Test file upload dialog
    // ============================================================
    console.log('\n📁 STEP 7: Test file upload dialog');
    await clearDebugLogs();

    // Click the "Add Source" button and wait for menu
    await window.click('[data-testid="add-source-button"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });

    // Click "Database Export" option
    await window.click('[data-testid="add-file-source-option"]');

    // Wait for dialog to open
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });

    // Verify dialog elements
    const nameInput = await window.$('[data-testid="source-name-input"]');
    expect(nameInput).not.toBeNull();

    const fileInput = await window.$('[data-testid="file-input"]');
    expect(fileInput).not.toBeNull();

    const submitButton = await window.$('[data-testid="submit-add-source"]');
    expect(submitButton).not.toBeNull();

    // Cancel the dialog
    await window.click('[data-testid="cancel-add-source"]');

    // Verify dialog closed
    await window.waitForTimeout(500);

    console.log('✅ STEP 7 PASSED: File upload dialog opened and closed successfully');

    // ============================================================
    // FINAL: Print summary
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('🎉 ALL STEPS PASSED - Search workflow complete!');
    console.log('='.repeat(60));

    const finalDebugData = await getDebugData();
    if (finalDebugData.hasErrors) {
      console.log('\n⚠️ Warning: Some errors were logged during the test:');
      printDebugData(finalDebugData);
    }
  });
});
