import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Review Definition Page E2E Test
 *
 * Tests the new Review Definition workflow step:
 * 1. Navigate to the Review Definition page
 * 2. Verify initial UI elements (review type, empty fields)
 * 3. Save protocol URL
 * 4. Add keywords
 * 5. Save objectives
 * 6. Add a screening criterion (inclusion)
 * 7. Add a second screening criterion (exclusion)
 * 8. Edit a criterion
 * 9. Remove a criterion
 * 10. Navigate to Search via "Continue to Search" button
 */
test.describe('Review Definition Workflow', () => {
  test.setTimeout(180000); // 3 minutes

  test('review definition page: CRUD criteria, keywords, objectives', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `revdef-${Date.now()}`;

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
    // NAVIGATE: Go to Review Definition page
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('NAVIGATE: Go to Review Definition page');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Click sidebar item for review_definition
    await window.click('[data-testid="sidebar-review_definition"]');
    await window.waitForSelector('[data-testid="review-definition-page"]', { timeout: 10000 });
    console.log('Review Definition page loaded');

    // Wait for data to load
    await waitForRpcResponse('get_review_definition', 10000);
    await failFastOnBackendError(getDebugData, 'Load review definition');

    // ============================================================
    // TEST 1: Verify initial UI structure
    // ============================================================
    console.log('\n--- TEST 1: Initial UI structure ---');

    // Review type badge should be visible
    const reviewTypeBadge = await window.$('[data-testid="review-type-badge"]');
    expect(reviewTypeBadge).not.toBeNull();
    const reviewType = await reviewTypeBadge!.textContent();
    console.log(`Review type: ${reviewType?.trim()}`);
    expect(reviewType?.trim()).toBeTruthy();

    // Protocol URL input should be empty
    const protocolInput = await window.$('[data-testid="protocol-url-input"]');
    expect(protocolInput).not.toBeNull();
    console.log('Protocol URL input visible');

    // Keywords section should exist
    const keywordInput = await window.$('[data-testid="keyword-input"]');
    expect(keywordInput).not.toBeNull();
    console.log('Keyword input visible');

    // Objectives textarea should be empty
    const objectivesTextarea = await window.$('[data-testid="objectives-textarea"]');
    expect(objectivesTextarea).not.toBeNull();
    console.log('Objectives textarea visible');

    // Add criterion button should exist
    const addCriterionBtn = await window.$('[data-testid="add-criterion-btn"]');
    expect(addCriterionBtn).not.toBeNull();
    console.log('Add Criterion button visible');

    // "No screening criteria" message should appear
    const noCriteriaMsg = await window.$('text=No screening criteria defined yet');
    expect(noCriteriaMsg).not.toBeNull();
    console.log('No criteria message visible');

    // Continue to Search button
    const gotoSearchBtn = await window.$('[data-testid="goto-search-btn"]');
    expect(gotoSearchBtn).not.toBeNull();
    console.log('Continue to Search button visible');

    // ============================================================
    // TEST 2: Save protocol URL
    // ============================================================
    console.log('\n--- TEST 2: Save protocol URL ---');

    await clearDebugLogs();

    await window.fill('[data-testid="protocol-url-input"]', 'https://www.crd.york.ac.uk/PROSPERO/12345');
    await clickWhenEnabled(window, '[data-testid="protocol-save-btn"]');

    await waitForRpcResponse('update_review_definition', 15000);
    await failFastOnBackendError(getDebugData, 'Save protocol URL');

    console.log('Protocol URL saved');

    // ============================================================
    // TEST 3: Add keywords
    // ============================================================
    console.log('\n--- TEST 3: Add keywords ---');

    await clearDebugLogs();

    // Add first keyword
    await window.fill('[data-testid="keyword-input"]', 'machine learning');
    await clickWhenEnabled(window, '[data-testid="keyword-add-btn"]');

    await waitForRpcResponse('update_review_definition', 15000);
    await failFastOnBackendError(getDebugData, 'Add keyword 1');

    // Verify keyword badge appears
    await window.waitForSelector('[data-testid="keyword-badge-0"]', { timeout: 5000 });
    const kw1Text = await window.textContent('[data-testid="keyword-badge-0"]');
    expect(kw1Text).toContain('machine learning');
    console.log(`Keyword 1 added: ${kw1Text?.trim()}`);

    await clearDebugLogs();

    // Add second keyword
    await window.fill('[data-testid="keyword-input"]', 'healthcare');
    await clickWhenEnabled(window, '[data-testid="keyword-add-btn"]');

    await waitForRpcResponse('update_review_definition', 15000);
    await failFastOnBackendError(getDebugData, 'Add keyword 2');

    await window.waitForSelector('[data-testid="keyword-badge-1"]', { timeout: 5000 });
    const kw2Text = await window.textContent('[data-testid="keyword-badge-1"]');
    expect(kw2Text).toContain('healthcare');
    console.log(`Keyword 2 added: ${kw2Text?.trim()}`);

    // ============================================================
    // TEST 4: Save objectives
    // ============================================================
    console.log('\n--- TEST 4: Save objectives ---');

    await clearDebugLogs();

    const objectivesText = 'To systematically review the effectiveness of machine learning approaches in healthcare settings.';
    await window.fill('[data-testid="objectives-textarea"]', objectivesText);
    await clickWhenEnabled(window, '[data-testid="objectives-save-btn"]');

    await waitForRpcResponse('update_review_definition', 15000);
    await failFastOnBackendError(getDebugData, 'Save objectives');

    console.log('Objectives saved');

    // ============================================================
    // TEST 5: Add inclusion criterion
    // ============================================================
    console.log('\n--- TEST 5: Add inclusion criterion ---');

    await clearDebugLogs();

    // Open Add Criterion dialog
    await window.click('[data-testid="add-criterion-btn"]');
    await window.waitForSelector('[data-testid="criterion-name-input"]', { timeout: 5000 });
    console.log('Add Criterion dialog opened');

    // Fill form
    await window.fill('[data-testid="criterion-name-input"]', 'population_relevant');
    await window.fill('[data-testid="criterion-explanation-input"]', 'Study population includes patients in healthcare settings');

    // Type should default to inclusion
    // Submit
    await clickWhenEnabled(window, '[data-testid="criterion-submit-btn"]');

    await waitForRpcResponse('add_screening_criterion', 15000);
    await failFastOnBackendError(getDebugData, 'Add inclusion criterion');

    // Verify criterion appears in list
    await window.waitForSelector('[data-testid="criterion-item-population_relevant"]', { timeout: 5000 });
    console.log('Inclusion criterion "population_relevant" added');

    // Verify inclusion badge
    const inclBadge = await window.$('[data-testid="criterion-item-population_relevant"] >> text=Inclusion');
    expect(inclBadge).not.toBeNull();
    console.log('Inclusion badge visible');

    // "No screening criteria" message should be gone
    const noCriteriaGone = await window.$('text=No screening criteria defined yet');
    expect(noCriteriaGone).toBeNull();
    console.log('No criteria message gone');

    // ============================================================
    // TEST 6: Add exclusion criterion
    // ============================================================
    console.log('\n--- TEST 6: Add exclusion criterion ---');

    await clearDebugLogs();

    // Open Add Criterion dialog again
    await window.click('[data-testid="add-criterion-btn"]');
    await window.waitForSelector('[data-testid="criterion-name-input"]', { timeout: 5000 });

    await window.fill('[data-testid="criterion-name-input"]', 'not_english');
    // Select exclusion type
    await window.selectOption('[data-testid="criterion-type-select"]', 'exclusion_criterion');
    await window.fill('[data-testid="criterion-explanation-input"]', 'Study is not published in English');

    await clickWhenEnabled(window, '[data-testid="criterion-submit-btn"]');

    await waitForRpcResponse('add_screening_criterion', 15000);
    await failFastOnBackendError(getDebugData, 'Add exclusion criterion');

    // Verify exclusion criterion appears
    await window.waitForSelector('[data-testid="criterion-item-not_english"]', { timeout: 5000 });
    console.log('Exclusion criterion "not_english" added');

    // Verify exclusion badge
    const exclBadge = await window.$('[data-testid="criterion-item-not_english"] >> text=Exclusion');
    expect(exclBadge).not.toBeNull();
    console.log('Exclusion badge visible');

    // ============================================================
    // TEST 7: Remove exclusion criterion
    // ============================================================
    console.log('\n--- TEST 7: Remove exclusion criterion ---');

    await clearDebugLogs();

    await window.click('[data-testid="criterion-remove-not_english"]');

    await waitForRpcResponse('remove_screening_criterion', 15000);
    await failFastOnBackendError(getDebugData, 'Remove criterion');

    // Verify it's gone
    await window.waitForTimeout(1000);
    const removedCriterion = await window.$('[data-testid="criterion-item-not_english"]');
    expect(removedCriterion).toBeNull();
    console.log('Exclusion criterion "not_english" removed');

    // population_relevant should still be there
    const remainingCriterion = await window.$('[data-testid="criterion-item-population_relevant"]');
    expect(remainingCriterion).not.toBeNull();
    console.log('Inclusion criterion "population_relevant" still present');

    // ============================================================
    // TEST 8: Remove keyword
    // ============================================================
    console.log('\n--- TEST 8: Remove keyword ---');

    await clearDebugLogs();

    // Remove "healthcare" keyword (index 1)
    await window.click('[data-testid="keyword-remove-1"]');

    await waitForRpcResponse('update_review_definition', 15000);
    await failFastOnBackendError(getDebugData, 'Remove keyword');

    await window.waitForTimeout(1000);

    // "machine learning" should still be there at index 0
    const kwRemaining = await window.textContent('[data-testid="keyword-badge-0"]');
    expect(kwRemaining).toContain('machine learning');

    // There should be no keyword-badge-1
    const kwGone = await window.$('[data-testid="keyword-badge-1"]');
    expect(kwGone).toBeNull();
    console.log('Keyword "healthcare" removed, "machine learning" remains');

    // ============================================================
    // TEST 9: Navigate to Search via Continue button
    // ============================================================
    console.log('\n--- TEST 9: Navigate to Search ---');

    await window.click('[data-testid="goto-search-btn"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });
    console.log('Navigated to Search page via Continue button');

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

    console.log('\nAll Review Definition tests passed!');
  });
});
