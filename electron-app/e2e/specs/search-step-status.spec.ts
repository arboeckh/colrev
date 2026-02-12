import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Tests for search step status in sidebar
 *
 * These tests verify that the sidebar correctly shows the search step
 * as incomplete when not all sources have been run.
 */
test.describe('Search Step Status', () => {
  test('search step should NOT show complete when API source not run', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `search-status-test-${Date.now()}`;

    // ============================================================
    // Setup: Create project
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SETUP: Create project');
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

    await window.waitForSelector('text=Project Overview', { timeout: 15000 });
    await waitForRpcResponse('get_status', 10000);
    console.log('✅ Project created');

    // Navigate to Search page
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

    // ============================================================
    // Step 1: Add PubMed API source (but DON'T run it)
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('STEP 1: Add PubMed API source (without running)');
    console.log('='.repeat(60));

    await clearDebugLogs();
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-api-source-option"]');
    await window.waitForSelector('[data-testid="pubmed-query-input"]', { timeout: 5000 });
    await window.fill('[data-testid="pubmed-query-input"]', 'test query 2024');
    await clickWhenEnabled(window, '[data-testid="submit-add-pubmed"]');
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add PubMed source');

    await window.waitForTimeout(2000);
    await waitForRpcResponse('get_sources', 10000);

    // Verify PubMed source card shows "Not run yet"
    const pubmedCard = await window.$('[data-testid="source-card-pubmed"]');
    expect(pubmedCard).not.toBeNull();
    const notRunText = await window.$('[data-testid="source-card-pubmed"] >> text=Not run yet');
    expect(notRunText).not.toBeNull();
    console.log('✅ PubMed source added - shows "Not run yet"');

    // Check sidebar status - should be 'active' (in progress, no records yet)
    const sidebarSearch = await window.$('[data-testid="sidebar-search"]');
    const stepStatus1 = await sidebarSearch?.getAttribute('data-step-status');
    console.log(`Sidebar search step status after adding API source: ${stepStatus1}`);
    expect(stepStatus1).toBe('active');
    console.log('✅ Sidebar search step shows "active" (expected)');

    // ============================================================
    // Step 2: Add file export source (this has records immediately)
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('STEP 2: Add file export source');
    console.log('='.repeat(60));

    await clearDebugLogs();
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-file-source-option"]');
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });
    await window.fill('[data-testid="source-name-input"]', 'test-export');

    // Upload file
    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, '../fixtures/asr.ris'));
    await window.waitForSelector('text=asr.ris', { timeout: 5000 });

    // Fill required search query field
    await window.fill('[data-testid="search-query-input"]', 'test query 2024');

    await clickWhenEnabled(window, '[data-testid="submit-add-source"]');
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add file source');

    await waitForRpcResponse('get_sources', 10000);
    await window.waitForTimeout(2000);

    // Verify file source shows as complete
    // The source name is "test-export" so the testid is "source-card-test-export"
    const fileCard = await window.$('[data-testid="source-card-test-export"]');
    expect(fileCard).not.toBeNull();
    console.log('✅ File source added');

    // ============================================================
    // BUG CHECK: Sidebar should NOT show search as complete
    // because the PubMed API source has not been run
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('BUG CHECK: Sidebar should NOT show search as complete');
    console.log('='.repeat(60));

    // Get sidebar status
    const sidebarSearchFinal = await window.$('[data-testid="sidebar-search"]');
    const stepStatusFinal = await sidebarSearchFinal?.getAttribute('data-step-status');
    console.log(`Sidebar search step status after adding both sources: ${stepStatusFinal}`);

    // The PubMed source is still "Not run yet" so sidebar should show 'active' (in progress)
    expect(stepStatusFinal).toBe('active');
    console.log('✅ Sidebar search step shows "active" (API source not run)');

    // Load step should be 'pending' (not active) until search is complete
    const sidebarLoad = await window.$('[data-testid="sidebar-load"]');
    const loadStepStatus = await sidebarLoad?.getAttribute('data-step-status');
    console.log(`Sidebar load step status: ${loadStepStatus}`);
    expect(loadStepStatus).toBe('pending');
    console.log('✅ Sidebar load step shows "pending" (search not complete)');

    // Also verify the PubMed card still shows "Not run yet"
    const pubmedNotRun = await window.$('[data-testid="source-card-pubmed"] >> text=Not run yet');
    expect(pubmedNotRun).not.toBeNull();
    console.log('✅ PubMed card still shows "Not run yet"');

    // The file card should show as complete
    const fileComplete = await window.$('[data-testid="source-card-test-export"] >> text=Complete');
    if (fileComplete) {
      console.log('✅ File source card shows "Complete"');
    } else {
      // Or at least has records
      const fileRecords = await window.$('[data-testid="source-card-test-export"] >> text=records');
      expect(fileRecords).not.toBeNull();
      console.log('✅ File source card shows records');
    }

    console.log('\n' + '='.repeat(60));
    console.log('SEARCH STEP STATUS TEST PASSED');
    console.log('='.repeat(60));

    // ============================================================
    // Cleanup: Delete test project
    // ============================================================
    console.log('\nCLEANUP: Deleting test project...');
    await window.click('button:has-text("Projects")');
    await window.waitForTimeout(2000);

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
});
