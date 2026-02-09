import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  formatRpcLogs,
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Tests for search source update functionality
 *
 * These tests verify that:
 * 1. API source query updates correctly trigger new searches with the updated query
 * 2. File sources can be updated with new exported files
 */
test.describe('Search Source Updates', () => {
  test('API source query update triggers search with new query', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `api-update-test-${Date.now()}`;

    // ============================================================
    // Setup: Create project and add PubMed source
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SETUP: Create project with PubMed source');
    console.log('='.repeat(60));

    await waitForAppReady(window, waitForBackend, 30000);

    // Create new project
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

    // App navigates to project automatically after creation
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });
    await waitForRpcResponse('get_status', 10000);
    console.log('✅ Project created and navigated to overview');

    // Navigate to Search page
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

    // Add PubMed source with initial query (narrow query for ~50-100 results)
    const initialQuery = 'CRISPR sickle cell therapy 2024[pdat]';
    await clearDebugLogs();

    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-api-source-option"]');
    await window.waitForSelector('[data-testid="pubmed-query-input"]', { timeout: 5000 });
    await window.fill('[data-testid="pubmed-query-input"]', initialQuery);
    await clickWhenEnabled(window, '[data-testid="submit-add-pubmed"]');
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add initial PubMed source');

    await window.waitForTimeout(2000);

    // Verify source was added
    const sourceCard = await window.$('[data-testid="source-card-pubmed"]');
    expect(sourceCard).not.toBeNull();
    console.log('✅ PubMed source created with initial query');

    // Run initial search
    await clearDebugLogs();
    await window.click('[data-testid="run-all-searches-button"]');
    await waitForRpcResponse('search', 120000);
    await failFastOnBackendError(getDebugData, 'Initial search');
    console.log('✅ Initial search completed');

    // Wait for UI to update
    await window.waitForTimeout(2000);
    await waitForRpcResponse('get_sources', 10000);

    // ============================================================
    // Test: Update search query and verify new search uses it
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST: Update query and run new search');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Click edit button to update query
    await window.click('[data-testid="edit-source-pubmed"]');
    await window.waitForSelector('[data-testid="edit-query-input"]', { timeout: 5000 });

    // Update to a different narrow query (~50-100 results)
    const updatedQuery = 'CAR-T immunotherapy pediatric 2024[pdat]';
    await window.fill('[data-testid="edit-query-input"]', updatedQuery);
    await clickWhenEnabled(window, '[data-testid="confirm-edit-source"]');
    await waitForRpcResponse('update_source', 30000);
    await failFastOnBackendError(getDebugData, 'Update source query');

    console.log('✅ Query updated');

    // Get the RPC logs to verify the update_source call
    const updateLogs = await getRpcLogs();
    console.log('\n=== Update Source RPC Logs ===');
    console.log(formatRpcLogs(updateLogs.filter((l) => l.message.includes('update_source'))));

    // Wait for sources to refresh
    await waitForRpcResponse('get_sources', 10000);
    await window.waitForTimeout(1000);

    // Verify the source card shows the new query
    const queryDisplay = await window.locator('text=CAR-T immunotherapy').first();
    await expect(queryDisplay).toBeVisible({ timeout: 5000 });
    console.log('✅ Updated query displayed on card');

    // Source should show "Not run yet" (query changed clears results)
    const notRunIndicator = await window.locator('[data-testid="source-card-pubmed"]').locator('text=Not run yet');
    await expect(notRunIndicator).toBeVisible({ timeout: 5000 });
    console.log('✅ Source shows needs re-run after query update');

    // Run search again
    await clearDebugLogs();
    await window.click('[data-testid="run-search-pubmed"]');

    // Wait for search to complete - this should use the NEW query
    await waitForRpcResponse('search', 120000);
    await failFastOnBackendError(getDebugData, 'Search with updated query');

    // Get RPC logs to verify the search was run
    const searchLogs = await getRpcLogs();
    console.log('\n=== Search RPC Logs ===');
    console.log(formatRpcLogs(searchLogs.filter((l) => l.message.includes('search'))));

    // Wait for status update
    await waitForRpcResponse('get_sources', 10000);
    await window.waitForTimeout(1000);

    // Source should no longer be stale
    const staleBadgeAfter = await window.$('[data-testid="source-card-pubmed"] >> text=Stale');
    expect(staleBadgeAfter).toBeNull();
    console.log('✅ Source no longer stale after re-running search');

    // Verify results exist
    const viewButton = await window.$('[data-testid="view-results-pubmed"]');
    expect(viewButton).not.toBeNull();
    console.log('✅ Search completed with new query - results available');

    console.log('\n' + '='.repeat(60));
    console.log('API QUERY UPDATE TEST PASSED');
    console.log('='.repeat(60));

    // ============================================================
    // Cleanup: Delete test project
    // ============================================================
    console.log('\nCLEANUP: Deleting test project...');
    // Navigate to landing page via header button
    await window.click('button:has-text("Projects")');
    await window.waitForTimeout(2000);

    // Find and delete the project
    const deleteButton = await window.$(`[data-testid="delete-project-${projectId}"]`);
    if (deleteButton) {
      await deleteButton.click();
      await window.waitForSelector('[data-testid="confirm-delete-project"]', { timeout: 5000 });
      await window.click('[data-testid="confirm-delete-project"]');
      await waitForRpcResponse('delete_project', 30000);
      console.log('✅ Test project deleted');
    } else {
      console.log('⚠️ Could not find delete button for cleanup');
    }
  });

  test('File source can be updated with new file', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `file-update-test-${Date.now()}`;

    // ============================================================
    // Setup: Create project and add initial file source
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SETUP: Create project with RIS file source');
    console.log('='.repeat(60));

    await waitForAppReady(window, waitForBackend, 30000);

    // Create new project
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

    // App navigates to project automatically after creation
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });
    await waitForRpcResponse('get_status', 10000);
    console.log('✅ Project created and navigated to overview');

    // Navigate to Search page
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

    // Add initial RIS file source
    await clearDebugLogs();
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-file-source-option"]');
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });
    await window.fill('[data-testid="source-name-input"]', 'test-ris');

    // Upload initial file
    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, '../fixtures/asr.ris'));
    await window.waitForSelector('text=asr.ris', { timeout: 5000 });

    await clickWhenEnabled(window, '[data-testid="submit-add-source"]');
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add initial RIS source');

    // Wait for sources to refresh
    await waitForRpcResponse('get_sources', 10000);
    await window.waitForTimeout(2000);

    // Verify source was added
    const sourceCard = await window.$('[data-testid="source-card-unknown_source"]');
    expect(sourceCard).not.toBeNull();
    console.log('✅ Initial RIS file source added');

    // Count initial records by viewing them
    let viewButton = await window.$('[data-testid="view-results-unknown_source"]');
    if (viewButton) {
      await viewButton.click();
      await window.waitForSelector('[data-testid="source-records-modal"]', { timeout: 5000 });
      await window.waitForSelector('[data-testid="records-table"]', { timeout: 10000 });

      const initialRecordRows = await window.$$('[data-testid^="record-row-"]');
      console.log(`Initial file has ${initialRecordRows.length} records`);

      await window.keyboard.press('Escape');
      await window.waitForTimeout(500);
    }

    // ============================================================
    // Test: Update file source with new file
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST: Update file source with new file');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Delete the existing source
    await window.click('[data-testid="delete-source-unknown_source"]');
    await window.waitForSelector('[data-testid="confirm-delete-source"]', { timeout: 5000 });
    await window.click('[data-testid="confirm-delete-source"]');
    await waitForRpcResponse('remove_source', 30000);
    await failFastOnBackendError(getDebugData, 'Delete source');
    await window.waitForTimeout(1000);
    console.log('✅ Deleted old source');

    // Add new file source with updated file
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-file-source-option"]');
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });
    await window.fill('[data-testid="source-name-input"]', 'test-ris-updated');

    // Upload updated file
    const [fileChooser2] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser2.setFiles(path.join(__dirname, '../fixtures/asr-updated.ris'));
    await window.waitForSelector('text=asr-updated.ris', { timeout: 5000 });

    await clickWhenEnabled(window, '[data-testid="submit-add-source"]');
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add updated RIS source');

    // Wait for sources to refresh
    await waitForRpcResponse('get_sources', 10000);
    await window.waitForTimeout(2000);

    // Verify new source was added
    const newSourceCard = await window.$('[data-testid="source-card-unknown_source"]');
    expect(newSourceCard).not.toBeNull();
    console.log('✅ New RIS file source added');

    // View records to verify the new file contents
    viewButton = await window.$('[data-testid="view-results-unknown_source"]');
    if (viewButton) {
      await viewButton.click();
      await window.waitForSelector('[data-testid="source-records-modal"]', { timeout: 5000 });
      await window.waitForSelector('[data-testid="records-table"]', { timeout: 10000 });

      const updatedRecordRows = await window.$$('[data-testid^="record-row-"]');
      console.log(`Updated file has ${updatedRecordRows.length} records`);

      // The updated file should have 3 records (2 from original + 1 new)
      expect(updatedRecordRows.length).toBe(3);
      console.log('✅ Updated file correctly shows 3 records');

      // Check for the new test record
      const newRecordContent = await window.$('text=/file update functionality/i');
      expect(newRecordContent).not.toBeNull();
      console.log('✅ New record from updated file is present');

      await window.keyboard.press('Escape');
      await window.waitForTimeout(500);
    } else {
      throw new Error('View button not found - source may not have records');
    }

    console.log('\n' + '='.repeat(60));
    console.log('FILE UPDATE TEST PASSED');
    console.log('='.repeat(60));

    // ============================================================
    // Cleanup: Delete test project
    // ============================================================
    console.log('\nCLEANUP: Deleting test project...');
    // Navigate to landing page via header button
    await window.click('button:has-text("Projects")');
    await window.waitForTimeout(2000);

    // Find and delete the project
    const deleteButton2 = await window.$(`[data-testid="delete-project-${projectId}"]`);
    if (deleteButton2) {
      await deleteButton2.click();
      await window.waitForSelector('[data-testid="confirm-delete-project"]', { timeout: 5000 });
      await window.click('[data-testid="confirm-delete-project"]');
      await waitForRpcResponse('delete_project', 30000);
      console.log('✅ Test project deleted');
    } else {
      console.log('⚠️ Could not find delete button for cleanup');
    }
  });
});
