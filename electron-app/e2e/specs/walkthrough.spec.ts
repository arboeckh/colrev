/**
 * End-to-end walkthrough: create review → PubMed search → preprocessing → prescreen.
 *
 * This is the smoke test that exposes "low-hanging" packaged-build bugs the
 * dev mode never sees. The query is intentionally narrow so the dataset is
 * small (no need to wait minutes for the search itself); the failure mode
 * we're chasing — multiprocessing.Pool() hanging in dedupe — fires regardless
 * of record count, so a tiny set is sufficient to reproduce.
 *
 * Mode is selected by COLREV_TEST_MODE:
 *   - unset / 'dev'    → unpacked dist/main + conda Python
 *   - 'packaged'       → built ColRev.app + python-build-standalone bundle
 */
import { test, expect } from '../fixtures/electron.fixture';
import {
  clickWhenEnabled,
  failFastOnBackendError,
  printDebugData,
} from '../helpers/test-utils';

const MODE = process.env.COLREV_TEST_MODE === 'packaged' ? 'packaged' : 'dev';

const BACKEND_TIMEOUT = MODE === 'packaged' ? 90_000 : 30_000;
const INIT_TIMEOUT = 90_000;
const SEARCH_TIMEOUT = 90_000;
const PREPROCESSING_TIMEOUT = 180_000;

// Narrow PubMed query — small enough to keep the run fast, but broad enough
// to reliably return >0 records across PubMed indexing changes.
const PUBMED_QUERY =
  '"systematic review"[Title] AND "machine learning"[Title] AND 2018[PDAT]';

test.describe(`walkthrough (${MODE})`, () => {
  test('creates a review, runs PubMed search, completes preprocessing, lands on prescreen', async ({
    window,
    waitForBackend,
    waitForRpcResponse,
    clearDebugLogs,
    getDebugData,
  }) => {
    test.setTimeout(MODE === 'packaged' ? 600_000 : 360_000);

    // 1. Window mounts.
    console.log('[walkthrough] waiting for app mount');
    await window.waitForSelector('#app', { timeout: 15_000 });

    // 2. Skip login.
    const continueBtn = window.locator('[data-testid="continue-without-login"]');
    await continueBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await continueBtn.click();
    await window.waitForSelector('h2:has-text("Reviews")', { timeout: 10_000 });

    // 3. Backend running.
    console.log('[walkthrough] waiting for backend');
    const backendReady = await waitForBackend(BACKEND_TIMEOUT);
    if (!backendReady) {
      printDebugData(await getDebugData());
      throw new Error(`Backend did not start within ${BACKEND_TIMEOUT}ms`);
    }
    expect(backendReady).toBe(true);

    await clearDebugLogs();

    // 4. Create review.
    console.log('[walkthrough] creating project');
    await clickWhenEnabled(window, '[data-testid="new-review-trigger"]', 10_000);

    const projectName = `walk ${Date.now()}`;
    const slug = projectName.toLowerCase().replace(/\s+/g, '-');

    await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5_000 });
    await window.fill('[data-testid="project-id-input"]', projectName);
    await clickWhenEnabled(window, '[data-testid="submit-create-project"]', 5_000);

    const initResp = await waitForRpcResponse('init_project', INIT_TIMEOUT);
    if (!initResp) {
      printDebugData(await getDebugData());
      throw new Error(`init_project did not respond within ${INIT_TIMEOUT}ms`);
    }
    await failFastOnBackendError(getDebugData, 'after init_project');

    // Land on the project — the router pushes to /project/<slug>.
    await window.waitForFunction(
      (s) => window.location.href.includes(`/project/${s}`),
      slug,
      { timeout: 30_000 },
    );

    // 5. Navigate to Search via hash route, then add a PubMed source.
    console.log('[walkthrough] navigating to search');
    await window.evaluate((s) => {
      window.location.hash = `#/project/${s}/search`;
    }, slug);

    // Project init creates a dev branch asynchronously; the search page is
    // read-only while the gitStore still says we're on main, which hides the
    // Add Source affordance. Poll until the auto-switch settles before
    // continuing.
    await window.waitForFunction(
      () => {
        // @ts-expect-error pinia
        const pinia = window.__pinia__;
        const g = pinia?._s.get('git');
        return g && g.currentBranch === 'dev';
      },
      undefined,
      { timeout: 30_000 },
    );

    await window.waitForSelector('[data-testid="add-source-card"]', { timeout: 15_000 });

    console.log('[walkthrough] adding PubMed source');
    await window.click('[data-testid="add-source-card"]');
    await window.waitForSelector('[data-testid="db-tile-pubmed"]', { timeout: 10_000 });
    await window.click('[data-testid="db-tile-pubmed"]');

    await window.waitForSelector('[data-testid="search-query-input"]', { timeout: 5_000 });
    await window.fill('[data-testid="search-query-input"]', PUBMED_QUERY);
    await clickWhenEnabled(window, '[data-testid="submit-add-source"]', 5_000);

    const addSourceResp = await waitForRpcResponse('add_source', 30_000);
    if (!addSourceResp) {
      printDebugData(await getDebugData());
      throw new Error('add_source did not respond');
    }
    await failFastOnBackendError(getDebugData, 'after add_source');

    // 6. Run the search.
    console.log('[walkthrough] running PubMed search');
    await clickWhenEnabled(window, '[data-testid="run-all-searches-button"]', 15_000);
    const searchResp = await waitForRpcResponse('search', SEARCH_TIMEOUT);
    if (!searchResp) {
      printDebugData(await getDebugData());
      throw new Error(`search did not respond within ${SEARCH_TIMEOUT}ms`);
    }
    await failFastOnBackendError(getDebugData, 'after search');

    // Wait for the source row to show a non-zero record count, with a short
    // poll — the SearchPage refreshes get_sources async after the search.
    const sourceCount = await window
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="add-source-card"]');
          if (!el) return null;
          // Fish a count out of the rendered DOM as a sanity check.
          const records = Array.from(document.querySelectorAll('span'))
            .map((s) => s.textContent ?? '')
            .find((t) => /\d+\s+records?/i.test(t));
          return records ?? null;
        },
        { timeout: 30_000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    console.log(`[walkthrough] post-search source row text: ${sourceCount}`);

    // 7. Navigate to preprocessing.
    console.log('[walkthrough] navigating to preprocessing');
    await window.evaluate((s) => {
      window.location.hash = `#/project/${s}/preprocessing`;
    }, slug);
    await window.waitForSelector('[data-testid="preprocessing-page"]', { timeout: 15_000 });
    await window.waitForSelector('[data-testid="preprocessing-run-all-button"]:not([disabled])', {
      timeout: 30_000,
    });

    // 8. Run preprocessing — this is where the packaged-build dedupe hang
    //    used to surface. Wait for the dedupe step to reach status="complete".
    console.log('[walkthrough] running preprocessing (load → prep → dedupe)');
    await clearDebugLogs();
    await window.click('[data-testid="preprocessing-run-all-button"]');

    // Track stage progression for clearer diagnostics on failure.
    const stageLog: string[] = [];
    const start = Date.now();
    let dedupeComplete = false;
    while (Date.now() - start < PREPROCESSING_TIMEOUT) {
      const statuses = await window.evaluate(() => {
        const get = (id: string) =>
          document
            .querySelector(`[data-testid="preprocessing-step-${id}"]`)
            ?.getAttribute('data-status') ?? 'missing';
        return {
          load: get('load'),
          prep: get('prep'),
          dedupe: get('dedupe'),
        };
      });
      const fingerprint = `${statuses.load}/${statuses.prep}/${statuses.dedupe}`;
      if (stageLog[stageLog.length - 1] !== fingerprint) {
        stageLog.push(fingerprint);
        console.log(`[walkthrough] stages: ${fingerprint}`);
      }
      if (statuses.dedupe === 'complete') {
        dedupeComplete = true;
        break;
      }
      // Surface backend errors mid-flight rather than hitting the loop timeout.
      const debug = await getDebugData();
      if (debug.backendStatus === 'error') {
        printDebugData(debug);
        throw new Error('Backend errored during preprocessing');
      }
      await window.waitForTimeout(500);
    }

    if (!dedupeComplete) {
      printDebugData(await getDebugData());
      throw new Error(
        `Preprocessing did not complete within ${PREPROCESSING_TIMEOUT}ms. ` +
          `Stage transitions seen: ${stageLog.join(' → ')}`,
      );
    }

    await failFastOnBackendError(getDebugData, 'after preprocessing');

    // 9. Click "Prescreen" → land on the prescreen page. The route component
    //    is ManagedReviewWorkflowPage; it shows a launch panel until the user
    //    creates a prescreen task, so we assert on the workflow wrapper
    //    rather than the embedded PrescreenPage's testid.
    console.log('[walkthrough] going to prescreen');
    await clickWhenEnabled(window, '[data-testid="go-to-prescreen-button"]', 10_000);
    await window.waitForSelector('[data-testid="managed-review-prescreen"]', {
      timeout: 30_000,
    });
    expect(window.url()).toContain('/prescreen');

    // Final sanity: backend still healthy.
    const finalDebug = await getDebugData();
    expect(finalDebug.backendStatus).toBe('running');
  });
});
