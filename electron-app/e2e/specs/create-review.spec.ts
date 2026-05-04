/**
 * End-to-end test: create a local review.
 *
 * Goal: prove the full stack works in both dev and packaged modes.
 *   1. Electron window mounts.
 *   2. Backend (`python -m colrev.ui_jsonrpc.server` in dev, the bundled
 *      `colrev-jsonrpc` shim in packaged mode) reaches `running`.
 *   3. The user can create a local review and see it on the landing page.
 *
 * Mode is selected by COLREV_TEST_MODE:
 *   - unset / 'dev'    → unpacked dist/main/index.js + conda Python
 *   - 'packaged'       → built ColRev.app + python-build-standalone bundle
 */
import { test, expect } from '../fixtures/electron.fixture';
import { clickWhenEnabled, failFastOnBackendError, printDebugData } from '../helpers/test-utils';

const MODE = process.env.COLREV_TEST_MODE === 'packaged' ? 'packaged' : 'dev';
// First boot of the python-build-standalone bundle pays the colrev import
// cost on a cold disk; dev mode reuses the user's warm conda env.
const BACKEND_TIMEOUT = MODE === 'packaged' ? 90_000 : 30_000;
const INIT_TIMEOUT = 90_000;

test.describe(`create-review (${MODE})`, () => {
  test('launches, starts the backend, creates a local review', async ({
    window,
    waitForBackend,
    waitForRpcResponse,
    clearDebugLogs,
    getDebugData,
  }) => {
    // 1. Window mounts.
    await window.waitForSelector('#app', { timeout: 15_000 });

    // 2. First-launch login screen — the test user-data-dir has no auth.
    //    "Continue without login" puts us on the landing page.
    const continueBtn = window.locator('[data-testid="continue-without-login"]');
    await continueBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await continueBtn.click();

    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 10_000 });

    // 3. Backend running.
    const backendReady = await waitForBackend(BACKEND_TIMEOUT);
    if (!backendReady) {
      printDebugData(await getDebugData());
      throw new Error(`Backend did not start within ${BACKEND_TIMEOUT}ms`);
    }
    expect(backendReady).toBe(true);

    await clearDebugLogs();

    // 4. Open the New Review dialog. The trigger is disabled until backend is
    //    running — clickWhenEnabled waits for the :not([disabled]) state.
    await clickWhenEnabled(window, '[data-testid="new-review-trigger"]', 10_000);

    const projectName = `smoke ${Date.now()}`;
    // The slug generator lowercases + dashes; we predict the resulting ID.
    const expectedSlug = projectName.toLowerCase().replace(/\s+/g, '-');

    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5_000 });
    await window.fill('[data-testid="project-id-input"]', projectName);

    await clickWhenEnabled(window, '[data-testid="submit-create-project"]', 5_000);

    // 5. init_project completes.
    const rpcResponse = await waitForRpcResponse('init_project', INIT_TIMEOUT);
    if (!rpcResponse) {
      printDebugData(await getDebugData());
      throw new Error(`init_project did not respond within ${INIT_TIMEOUT}ms`);
    }
    expect(rpcResponse).not.toBeNull();

    // Surface backend errors immediately rather than waiting for the next
    // assertion to time out.
    await failFastOnBackendError(getDebugData, 'after init_project');

    // 6. The project is reachable. Either the router pushed to /project/<slug>
    //    or the new row is visible on the landing page.
    await window.waitForFunction(
      (slug) => {
        const url = window.location.href;
        if (url.includes(`/project/${slug}`)) return true;
        return !!document.querySelector(`[data-testid="project-row-${slug}"]`);
      },
      expectedSlug,
      { timeout: 30_000 },
    );

    // Final sanity: backend still healthy.
    const debug = await getDebugData();
    expect(debug.backendStatus).toBe('running');
  });
});
