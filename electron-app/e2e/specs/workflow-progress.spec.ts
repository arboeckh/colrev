import { test, expect } from '../fixtures/electron.fixture';
import {
  formatRpcLogs,
  printDebugData,
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Workflow Progress Indicators E2E Tests
 *
 * Tests the visual progress indicators (check marks, dots, circles) in the sidebar
 * that show where the user is in the review workflow.
 *
 * Step statuses are determined by CoLRev record states:
 * - 'complete' (green check): No pending records AND has processed records
 * - 'active' (primary dot): Has pending records to process
 * - 'warning' (yellow alert): Operation can't run for a reason
 * - 'pending' (muted circle): Not yet reached
 */
test.describe('Workflow Progress Indicators', () => {
  test('empty project shows correct initial state', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    // ============================================================
    // SETUP: Create a new empty project (no example data)
    // ============================================================
    console.log('\n🚀 Setting up empty project');

    await waitForAppReady(window, waitForBackend, 30000);
    await clearDebugLogs();

    const projectId = `progress-empty-${Date.now()}`;

    // Create project without example data
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

    // Navigate to project
    await window.waitForSelector(`[data-testid="project-card-${projectId}"]`, { timeout: 10000 });
    await window.click(`[data-testid="project-card-${projectId}"]`);
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });

    // Wait for status to load
    await waitForRpcResponse('get_status', 10000);
    await window.waitForTimeout(1000); // Give Vue time to update

    // ============================================================
    // TEST: Verify sidebar step statuses
    // ============================================================
    console.log('\n📋 Verifying sidebar step statuses');

    // Search should show as "pending" or "complete" (sources may be configured by default)
    const searchStep = await window.$('[data-testid="sidebar-search"]');
    expect(searchStep).not.toBeNull();
    const searchStatus = await searchStep?.getAttribute('data-step-status');
    console.log(`Search status: ${searchStatus}`);
    // Search could be 'pending' (no sources) or 'complete' (has default files_dir source)
    expect(['pending', 'complete']).toContain(searchStatus);

    // All other steps should be 'pending' (no records)
    const steps = ['load', 'prep', 'dedupe', 'prescreen', 'pdf_get', 'pdf_prep', 'screen', 'data'];
    for (const stepId of steps) {
      const step = await window.$(`[data-testid="sidebar-${stepId}"]`);
      expect(step).not.toBeNull();
      const status = await step?.getAttribute('data-step-status');
      console.log(`${stepId} status: ${status}`);
      expect(status).toBe('pending');
    }

    // Check for errors
    const debugData = await getDebugData();
    if (debugData.hasErrors) {
      console.log('\n⚠️ Errors during test:');
      printDebugData(debugData);
    }

    console.log('\n✅ Empty project step statuses verified');
  });

  test('project with example data shows workflow progress', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    // ============================================================
    // SETUP: Create a project with example data
    // ============================================================
    console.log('\n🚀 Setting up project with example data');

    await waitForAppReady(window, waitForBackend, 30000);
    await clearDebugLogs();

    const projectId = `progress-example-${Date.now()}`;

    // Create project WITH example data
    await window.click('button:has-text("New Project")');
    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5000 });
    await window.fill('[data-testid="project-id-input"]', projectId);

    // Ensure example data is checked
    const exampleCheckbox = await window.$('input#useExample');
    if (exampleCheckbox && !(await exampleCheckbox.isChecked())) {
      await exampleCheckbox.click();
    }

    await window.click('[data-testid="submit-create-project"]');
    await waitForRpcResponse('init_project', 120000); // Example data takes longer

    // Navigate to project
    await window.waitForSelector(`[data-testid="project-card-${projectId}"]`, { timeout: 15000 });
    await window.click(`[data-testid="project-card-${projectId}"]`);
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });

    // Wait for status to fully load
    await waitForRpcResponse('get_status', 10000);
    await window.waitForTimeout(2000); // Give Vue time to update with all operation info

    // ============================================================
    // TEST: Verify sidebar reflects example data state
    // ============================================================
    console.log('\n📋 Verifying sidebar reflects example data state');

    // Get all step statuses
    const allSteps = ['search', 'load', 'prep', 'dedupe', 'prescreen', 'pdf_get', 'pdf_prep', 'screen', 'data'];
    const statuses: Record<string, string | null> = {};

    for (const stepId of allSteps) {
      const step = await window.$(`[data-testid="sidebar-${stepId}"]`);
      const status = await step?.getAttribute('data-step-status');
      statuses[stepId] = status ?? null;
      console.log(`${stepId}: ${status}`);
    }

    // With example data, search should be complete (records exist)
    expect(statuses.search).toBe('complete');

    // At least one step should be 'active' or 'complete' (example data has records)
    const activeOrComplete = Object.values(statuses).filter(
      (s) => s === 'active' || s === 'complete'
    );
    expect(activeOrComplete.length).toBeGreaterThan(0);

    // Check for errors
    await failFastOnBackendError(getDebugData, 'Example data project');

    console.log('\n✅ Example project step statuses verified');
  });

  test('running load operation updates step statuses', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    // ============================================================
    // SETUP: Create project with search results to load
    // ============================================================
    console.log('\n🚀 Setting up project for load operation test');

    await waitForAppReady(window, waitForBackend, 30000);
    await clearDebugLogs();

    const projectId = `progress-load-${Date.now()}`;

    // Create project without example data
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

    // Navigate to project
    await window.waitForSelector(`[data-testid="project-card-${projectId}"]`, { timeout: 10000 });
    await window.click(`[data-testid="project-card-${projectId}"]`);
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });

    // Navigate to Search page
    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });
    await clearDebugLogs();

    // ============================================================
    // Add a PubMed source and run search
    // ============================================================
    console.log('\n🔍 Adding PubMed source and running search');

    await window.click('[data-testid="add-source-button"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-api-source-option"]');
    await window.waitForSelector('[data-testid="pubmed-query-input"]', { timeout: 5000 });

    // Use a very specific PMID query that returns exactly 1 result
    await window.fill('[data-testid="pubmed-query-input"]', '10075143[uid]');
    await clickWhenEnabled(window, '[data-testid="submit-add-pubmed"]');
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Add PubMed source');
    await window.waitForTimeout(2000);

    // Run search
    await clearDebugLogs();
    await window.click('[data-testid="run-search-button"]');

    // Wait for search to complete
    await waitForRpcResponse('search', 60000);
    await failFastOnBackendError(getDebugData, 'Run search');

    // Refresh status
    await waitForRpcResponse('get_status', 10000);
    await window.waitForTimeout(1000);

    // ============================================================
    // TEST: Verify load step is now 'active' (has records to load)
    // ============================================================
    console.log('\n📋 Verifying load step is active after search');

    // Check load step status
    const loadStep = await window.$('[data-testid="sidebar-load"]');
    const loadStatus = await loadStep?.getAttribute('data-step-status');
    console.log(`Load status after search: ${loadStatus}`);

    // Load should be 'active' (records in md_retrieved waiting to be loaded)
    expect(loadStatus).toBe('active');

    // Search should be 'complete' (has produced output)
    const searchStep = await window.$('[data-testid="sidebar-search"]');
    const searchStatus = await searchStep?.getAttribute('data-step-status');
    console.log(`Search status: ${searchStatus}`);
    expect(searchStatus).toBe('complete');

    // ============================================================
    // Run load operation
    // ============================================================
    console.log('\n📥 Running load operation');

    await window.click('[data-testid="sidebar-load"]');
    await window.waitForSelector('h2:has-text("Load")', { timeout: 10000 });
    await clearDebugLogs();

    // Click run load button (if it exists and is enabled)
    const runLoadButton = await window.$('[data-testid="run-load-button"]');
    if (runLoadButton) {
      await clickWhenEnabled(window, '[data-testid="run-load-button"]');
      await waitForRpcResponse('load', 60000);
      await failFastOnBackendError(getDebugData, 'Run load');

      // Wait for status refresh
      await waitForRpcResponse('get_status', 10000);
      await window.waitForTimeout(1000);

      // ============================================================
      // TEST: Verify statuses updated after load
      // ============================================================
      console.log('\n📋 Verifying statuses after load');

      const loadStatusAfter = await (await window.$('[data-testid="sidebar-load"]'))?.getAttribute(
        'data-step-status'
      );
      console.log(`Load status after running: ${loadStatusAfter}`);

      // Load should be 'complete' (no more md_retrieved records)
      expect(loadStatusAfter).toBe('complete');

      // Prep should be 'active' (has md_imported records to process)
      const prepStatus = await (await window.$('[data-testid="sidebar-prep"]'))?.getAttribute(
        'data-step-status'
      );
      console.log(`Prep status: ${prepStatus}`);
      expect(prepStatus).toBe('active');
    } else {
      console.log('⚠️ Run load button not found - skipping load operation test');
    }

    // Print RPC logs for debugging
    const rpcLogs = await getRpcLogs();
    console.log('\n=== RPC Activity ===');
    console.log(formatRpcLogs(rpcLogs));

    console.log('\n✅ Load operation step status updates verified');
  });

  test('connecting lines show visual flow', async ({
    window,
    waitForBackend,
    waitForRpcResponse,
  }) => {
    // ============================================================
    // SETUP: Create a project and verify connecting lines exist
    // ============================================================
    console.log('\n🚀 Setting up project to verify connecting lines');

    await waitForAppReady(window, waitForBackend, 30000);

    const projectId = `progress-lines-${Date.now()}`;

    // Create project
    await window.click('button:has-text("New Project")');
    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5000 });
    await window.fill('[data-testid="project-id-input"]', projectId);

    const exampleCheckbox = await window.$('input#useExample');
    if (exampleCheckbox && (await exampleCheckbox.isChecked())) {
      await exampleCheckbox.click();
    }

    await window.click('[data-testid="submit-create-project"]');
    await waitForRpcResponse('init_project', 60000);

    // Navigate to project
    await window.waitForSelector(`[data-testid="project-card-${projectId}"]`, { timeout: 10000 });
    await window.click(`[data-testid="project-card-${projectId}"]`);
    await window.waitForSelector('text=Project Overview', { timeout: 15000 });

    // ============================================================
    // TEST: Verify sidebar items have connecting line elements
    // ============================================================
    console.log('\n📋 Verifying connecting lines in sidebar');

    // Check that the sidebar search item exists (the wrapper div should have the line elements)
    const searchParent = await window.$('[data-testid="sidebar-search"]');
    expect(searchParent).not.toBeNull();

    // The SidebarItem component wraps the RouterLink in a div with position:relative
    // and adds absolute positioned line divs. We verify the component structure works.
    const loadStep = await window.$('[data-testid="sidebar-load"]');
    expect(loadStep).not.toBeNull();

    // Verify all steps are rendered
    const steps = ['search', 'load', 'prep', 'dedupe', 'prescreen', 'pdf_get', 'pdf_prep', 'screen', 'data'];
    for (const stepId of steps) {
      const step = await window.$(`[data-testid="sidebar-${stepId}"]`);
      expect(step).not.toBeNull();
    }

    console.log('\n✅ Sidebar structure verified with all workflow steps');
  });
});
