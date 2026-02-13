import path from 'path';
import { test, expect } from '../fixtures/electron.fixture';
import {
  waitForAppReady,
  clickWhenEnabled,
  failFastOnBackendError,
} from '../helpers/test-utils';

/**
 * Prep Edit Workflow E2E Test
 *
 * Tests the full flow of:
 * 1. Import an arxiv RIS file as a search source
 * 2. Run preprocessing (Load → Prep → Dedupe)
 * 3. Open the results modal and check the "Needs Attention" tab
 * 4. Open the edit dialog for a record with issues
 * 5. Verify the dialog scrolls properly (no overflow)
 * 6. Verify real defects are shown (e.g. "Language could not be determined")
 * 7. Update fields with mock data to test the save/update feature
 */
test.describe('Prep Edit Workflow', () => {
  test.setTimeout(180000); // 3 minutes

  test('import arxiv RIS, preprocess, and edit records needing attention', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    const projectId = `prep-edit-${Date.now()}`;

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
    console.log(`✅ Project "${projectId}" created`);

    // ============================================================
    // SEARCH: Add arxiv RIS file
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('SEARCH: Add arxiv_references.ris');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Search")', { timeout: 10000 });

    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="add-source-menu"]', { timeout: 5000 });
    await window.click('[data-testid="add-file-source-option"]');
    await window.waitForSelector('[data-testid="source-name-input"]', { timeout: 5000 });

    await window.fill('[data-testid="source-name-input"]', 'arxiv_references');

    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.click('[data-testid="file-input"]'),
    ]);
    await fileChooser.setFiles(path.join(__dirname, '../fixtures/arxiv_references.ris'));
    await window.waitForSelector('text=arxiv_references.ris', { timeout: 5000 });

    // Fill in the required search query field
    await window.fill('[data-testid="search-query-input"]', 'arxiv dark matter fuzzy');

    await clickWhenEnabled(window, '[data-testid="submit-add-source"]', 10000);
    await waitForRpcResponse('upload_search_file', 30000);
    await waitForRpcResponse('add_source', 30000);
    await failFastOnBackendError(getDebugData, 'Upload arxiv_references.ris');
    await window.waitForTimeout(1000);

    console.log('✅ Arxiv RIS file added');

    // ============================================================
    // PREPROCESSING: Navigate and run all stages
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('PREPROCESSING: Navigate and run');
    console.log('='.repeat(60));

    await clearDebugLogs();

    await window.click('[data-testid="sidebar-search"]');
    await window.waitForSelector('h2:has-text("Preprocessing")', { timeout: 10000 });
    await window.waitForSelector('[data-testid="preprocessing-section"]', { timeout: 5000 });

    console.log('✅ Preprocessing page loaded');

    // Run all stages
    await clickWhenEnabled(window, '[data-testid="preprocessing-run-all-button"]');
    console.log('Clicked Run All button');

    // Poll for completion
    const maxWaitTime = 120000;
    const pollInterval = 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await failFastOnBackendError(getDebugData, 'Preprocessing operations');

      const dedupeStatus = await window.$eval(
        '[data-testid="preprocessing-step-dedupe"]',
        (el) => el.getAttribute('data-status')
      ).catch(() => 'pending');

      if (dedupeStatus === 'complete') {
        console.log('✅ All preprocessing stages completed');
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

      await window.waitForTimeout(pollInterval);
    }

    // Verify completion
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
    // VIEW RESULTS: Open results modal
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VIEW RESULTS: Open results modal');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Click "View Results" button
    await clickWhenEnabled(window, '[data-testid="view-results-button"]');
    await window.waitForSelector('[data-testid="preprocessing-results-modal"]', { timeout: 10000 });
    console.log('✅ Results modal opened');

    // Wait for records to load
    await window.waitForTimeout(2000);

    // Check Ready tab count
    const readyBadge = await window.$('[data-testid="tab-ready"] .inline-flex');
    const readyCount = readyBadge ? await readyBadge.textContent() : '0';
    console.log(`Ready records: ${readyCount}`);

    // ============================================================
    // NEEDS ATTENTION: Check attention tab (opens by default)
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('NEEDS ATTENTION: Check for records needing attention');
    console.log('='.repeat(60));

    // Check if there are attention records
    const attentionBadge = await window.$('[data-testid="tab-attention"] .inline-flex');
    const attentionCount = attentionBadge ? await attentionBadge.textContent() : '0';
    console.log(`Attention records: ${attentionCount}`);

    const attentionCountNum = parseInt(attentionCount?.trim() || '0', 10);

    if (attentionCountNum === 0) {
      console.log('ℹ️ No records need attention - all records processed successfully');
      console.log('This means the language detection worked for all records.');
      console.log('Test will verify the ready tab has all records instead.');

      // Even with 0 attention records, verify the ready records loaded
      await window.click('[data-testid="tab-ready"]');
      await window.waitForTimeout(500);
      const readyTable = await window.$('[data-testid="ready-records-table"]');
      expect(readyTable).not.toBeNull();
      console.log('✅ Ready records table is visible');
      return;
    }

    console.log(`✅ Found ${attentionCountNum} record(s) needing attention`);

    // Verify the attention records table is visible
    const attentionTable = await window.$('[data-testid="attention-records-table"]');
    expect(attentionTable).not.toBeNull();
    console.log('✅ Attention records table is visible');

    // ============================================================
    // EDIT DIALOG: Click first attention record to open edit
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('EDIT DIALOG: Open edit for first attention record');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Click the first attention record row
    await window.click('[data-testid="attention-record-row-0"]');
    await window.waitForSelector('[data-testid="record-edit-dialog"]', { timeout: 10000 });
    console.log('✅ Edit dialog opened');

    // Wait for record data to load (via get_record RPC)
    await waitForRpcResponse('get_record', 15000);
    await window.waitForTimeout(1000);

    // ============================================================
    // VERIFY: Dialog content and scrolling
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VERIFY: Dialog content, scrolling, and defects');
    console.log('='.repeat(60));

    // Check that the dialog has overflow-hidden (our fix)
    const dialogOverflow = await window.$eval(
      '[data-testid="record-edit-dialog"]',
      (el) => {
        const style = window.getComputedStyle(el);
        return {
          overflow: style.overflow,
          overflowY: style.overflowY,
          maxHeight: style.maxHeight,
          height: el.scrollHeight,
          clientHeight: el.clientHeight,
        };
      }
    );
    console.log('Dialog computed styles:', JSON.stringify(dialogOverflow));

    // The dialog should not overflow its max-height constraint
    // overflow should be 'hidden' after our fix
    expect(dialogOverflow.overflow).toBe('hidden');
    console.log('✅ Dialog has overflow-hidden (scroll fix applied)');

    // Check that the form scroll container is scrollable
    const formScroll = await window.$('[data-testid="record-edit-form-scroll"]');
    expect(formScroll).not.toBeNull();
    console.log('✅ Form scroll container exists');

    if (formScroll) {
      const scrollInfo = await formScroll.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        isScrollable: el.scrollHeight > el.clientHeight,
        overflowY: window.getComputedStyle(el).overflowY,
      }));
      console.log('Form scroll info:', JSON.stringify(scrollInfo));
      // With many fields, the form should be scrollable
      if (scrollInfo.isScrollable) {
        console.log('✅ Form content is scrollable (overflow working correctly)');
      } else {
        console.log('ℹ️ Form content fits without scrolling');
      }
    }

    // Check defect banner exists
    const defectBanner = await window.$('[data-testid="record-edit-defect-banner"]');
    if (defectBanner) {
      const defectText = await defectBanner.textContent();
      console.log(`✅ Defect banner: ${defectText?.trim()}`);

      // Check for language-unknown defect specifically (now remapped to Language field)
      const hasLanguageDefect = defectText?.includes('Language could not be auto-detected');
      if (hasLanguageDefect) {
        console.log('✅ Language defect shown with actionable message');
      }
    } else {
      console.log('ℹ️ No defect banner (record may have other issues)');
    }

    // Verify the status badge shows md_needs_manual_preparation
    const statusBadge = await window.$('[data-testid="record-edit-status-badge"]');
    if (statusBadge) {
      const statusText = await statusBadge.textContent();
      console.log(`Record status: ${statusText?.trim()}`);
      expect(statusText?.trim()).toBe('md_needs_manual_preparation');
      console.log('✅ Status is md_needs_manual_preparation');
    }

    // ============================================================
    // VERIFY: Fields are properly mapped from RIS
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VERIFY: Field mapping from RIS');
    console.log('='.repeat(60));

    // Check title field has content
    const titleField = await window.$('[data-testid="record-edit-field-title"]');
    if (titleField) {
      const titleValue = await titleField.inputValue();
      console.log(`Title: ${titleValue}`);
      expect(titleValue.length).toBeGreaterThan(0);
      console.log('✅ Title field is populated');
    }

    // Check author field
    const authorField = await window.$('[data-testid="record-edit-field-author"]');
    if (authorField) {
      const authorValue = await authorField.inputValue();
      console.log(`Author: ${authorValue}`);
      expect(authorValue.length).toBeGreaterThan(0);
      console.log('✅ Author field is populated');
    }

    // Check year field
    const yearField = await window.$('[data-testid="record-edit-field-year"]');
    if (yearField) {
      const yearValue = await yearField.inputValue();
      console.log(`Year: ${yearValue}`);
      expect(yearValue).toBe('2025');
      console.log('✅ Year is correctly mapped from RIS');
    }

    // Check DOI field
    const doiField = await window.$('[data-testid="record-edit-field-doi"]');
    if (doiField) {
      const doiValue = await doiField.inputValue();
      console.log(`DOI: ${doiValue}`);
      if (doiValue) {
        expect(doiValue).toContain('10.');
        console.log('✅ DOI is populated and valid format');
      }
    }

    // ============================================================
    // UPDATE: Modify fields to test save functionality
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('UPDATE: Test save functionality');
    console.log('='.repeat(60));

    await clearDebugLogs();

    // Verify language defect hint is shown on the Language field (not Title)
    const langDefectHint = await window.$('[data-testid="record-edit-defect-language"]');
    if (langDefectHint) {
      const langDefectText = await langDefectHint.textContent();
      console.log(`Language field defect hint: ${langDefectText?.trim()}`);
      expect(langDefectText).toContain('auto-detected');
      console.log('✅ Language defect hint correctly shown on Language field');
    }

    // Set language to English via the dropdown
    const languageSelect = await window.$('[data-testid="record-edit-field-language"]');
    if (languageSelect) {
      await window.selectOption('[data-testid="record-edit-field-language"]', 'eng');
      console.log('Set language to "eng" (English)');
    }

    // Change fields to fix the defects
    // Journal is required - set it for arxiv preprints
    const journalField = await window.$('[data-testid="record-edit-field-journal"]');
    if (journalField) {
      const journalValue = await journalField.inputValue();
      console.log(`Current journal value: "${journalValue}"`);
      await window.fill('[data-testid="record-edit-field-journal"]', 'arXiv preprint');
      console.log('Set journal to "arXiv preprint"');
    }

    // Volume is required - set it
    const volumeField = await window.$('[data-testid="record-edit-field-volume"]');
    if (volumeField) {
      const volumeValue = await volumeField.inputValue();
      console.log(`Current volume value: "${volumeValue}"`);
      await window.fill('[data-testid="record-edit-field-volume"]', '1');
      console.log('Set volume to "1"');
    }

    // Number is required - set it
    const numberField = await window.$('[data-testid="record-edit-field-number"]');
    if (numberField) {
      const numberValue = await numberField.inputValue();
      console.log(`Current number value: "${numberValue}"`);
      await window.fill('[data-testid="record-edit-field-number"]', '1');
      console.log('Set number to "1"');
    }

    // Check if save button is enabled (should be if we changed a field)
    const saveButton = await window.$('[data-testid="record-edit-save-button"]');
    if (saveButton) {
      const isDisabled = await saveButton.getAttribute('disabled');
      console.log(`Save button disabled: ${isDisabled !== null}`);

      if (isDisabled === null) {
        // Save button is enabled - click it
        await window.click('[data-testid="record-edit-save-button"]');
        console.log('Clicked save button');

        // Wait for the RPC response
        await waitForRpcResponse('prep_man_update_record', 15000);
        await window.waitForTimeout(1000);

        // Check for errors
        const debugData = await getDebugData();
        const rpcErrors = debugData.logs.filter(l => l.type === 'error');
        if (rpcErrors.length > 0) {
          console.log('⚠️ RPC errors during save:');
          rpcErrors.forEach(e => console.log(`  - ${e.message}: ${JSON.stringify(e.data)}`));
        } else {
          console.log('✅ Save completed without RPC errors');
        }

        // Check if the dialog is still open (has remaining defects) or closed (all fixed)
        const dialogStillOpen = await window.$('[data-testid="record-edit-dialog"]');
        if (dialogStillOpen) {
          const dialogVisible = await dialogStillOpen.isVisible();
          if (dialogVisible) {
            console.log('ℹ️ Dialog still open - record still has remaining defects');

            // Check for remaining defects message
            const errorMsg = await window.$('.bg-destructive\\/10');
            if (errorMsg) {
              const errorText = await errorMsg.textContent();
              console.log(`Remaining defects message: ${errorText?.trim()}`);
            }

            // Check if defect banner updated
            const updatedBanner = await window.$('[data-testid="record-edit-defect-banner"]');
            if (updatedBanner) {
              const updatedText = await updatedBanner.textContent();
              console.log(`Updated defect banner: ${updatedText?.trim()}`);
            }
          } else {
            console.log('✅ Dialog closed - record was fully fixed');
          }
        } else {
          console.log('✅ Dialog closed - record was fully fixed');
        }
      } else {
        console.log('ℹ️ Save button is disabled - no changes detected');
      }
    }

    // ============================================================
    // VERIFY: Record moves from Attention to Ready after edit
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('VERIFY: Record moved from Attention to Ready after edit + auto-dedupe');
    console.log('='.repeat(60));

    // Wait for auto-dedupe to complete (triggered by onRecordUpdated)
    await waitForRpcResponse('dedupe', 30000);
    console.log('✅ Auto-dedupe completed');

    // Wait a moment for the Ready tab to reload after dedupe
    await window.waitForTimeout(2000);

    // Check updated attention count - should have decreased
    const updatedAttentionBadge = await window.$('[data-testid="tab-attention"] .inline-flex');
    const updatedAttentionCount = updatedAttentionBadge ? await updatedAttentionBadge.textContent() : '0';
    const updatedAttentionNum = parseInt(updatedAttentionCount?.trim() || '0', 10);
    console.log(`Attention count: ${attentionCountNum} → ${updatedAttentionNum}`);
    expect(updatedAttentionNum).toBeLessThan(attentionCountNum);
    console.log('✅ Attention count decreased');

    // Switch to Ready tab and verify count increased
    await window.click('[data-testid="tab-ready"]');
    await window.waitForTimeout(1500);

    const updatedReadyBadge = await window.$('[data-testid="tab-ready"] .inline-flex');
    const updatedReadyCount = updatedReadyBadge ? await updatedReadyBadge.textContent() : '0';
    const updatedReadyNum = parseInt(updatedReadyCount?.trim() || '0', 10);
    const initialReadyNum = parseInt(readyCount?.trim() || '0', 10);
    console.log(`Ready count: ${initialReadyNum} → ${updatedReadyNum}`);
    expect(updatedReadyNum).toBeGreaterThan(initialReadyNum);
    console.log('✅ Ready count increased');

    // Verify the ready records table is visible with records
    const readyTableAfterEdit = await window.$('[data-testid="ready-records-table"]');
    expect(readyTableAfterEdit).not.toBeNull();
    console.log('✅ Ready records table is visible with records');

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

    const finalDebugData = await getDebugData();
    if (finalDebugData.hasErrors) {
      console.log('\n⚠️ Warnings/errors during test:');
      const errors = finalDebugData.logs.filter(l => l.type === 'error');
      errors.forEach(e => console.log(`  - ${e.message}`));
    }

    console.log('\n✅ Prep edit workflow test completed successfully!');
  });
});
