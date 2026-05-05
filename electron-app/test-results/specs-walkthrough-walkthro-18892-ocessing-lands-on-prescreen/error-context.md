# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: specs/walkthrough.spec.ts >> walkthrough (dev) >> creates a review, runs PubMed search, completes preprocessing, lands on prescreen
- Location: e2e/specs/walkthrough.spec.ts:34:7

# Error details

```
TimeoutError: page.waitForFunction: Timeout 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - region "Notifications alt+T":
    - list
  - button "53" [ref=e4]:
    - img
    - generic [ref=e5]: "53"
  - generic [ref=e6]:
    - banner [ref=e7]:
      - generic [ref=e8]:
        - generic [ref=e9]:
          - button "Reviews" [ref=e10]:
            - img
            - generic [ref=e11]: Reviews
          - heading "walk 1777988470355" [level=1] [ref=e13]
        - generic [ref=e14]:
          - generic [ref=e15]:
            - generic [ref=e16]:
              - img
              - generic [ref=e17]: In sync
            - button "MANUAL" [ref=e18]
          - button "Toggle theme" [ref=e19]:
            - img
            - generic [ref=e20]: Toggle theme
          - button "Refresh project and git state" [ref=e21]:
            - img
    - generic [ref=e22]:
      - complementary [ref=e23]:
        - generic [ref=e26]:
          - link "Overview" [ref=e27] [cursor=pointer]:
            - /url: "#/project/walk-1777988470355"
            - img [ref=e28]
            - generic [ref=e33]: Overview
          - navigation [ref=e34]:
            - link "Definition" [ref=e35] [cursor=pointer]:
              - /url: "#/project/walk-1777988470355/review-definition"
              - img [ref=e39]
              - generic [ref=e42]: Definition
            - link "Search" [ref=e43] [cursor=pointer]:
              - /url: "#/project/walk-1777988470355/search"
              - generic [ref=e50]: Search
            - link "Preprocessing" [ref=e51] [cursor=pointer]:
              - /url: "#/project/walk-1777988470355/preprocessing"
              - generic [ref=e57]: Preprocessing
            - link "Prescreen" [ref=e58] [cursor=pointer]:
              - /url: "#/project/walk-1777988470355/prescreen"
              - generic [ref=e64]: Prescreen
            - link "PDFs" [ref=e65] [cursor=pointer]:
              - /url: "#/project/walk-1777988470355/pdfs"
              - generic [ref=e71]: PDFs
            - link "Screen" [ref=e72] [cursor=pointer]:
              - /url: "#/project/walk-1777988470355/screen"
              - generic [ref=e78]: Screen
            - link "Data" [ref=e79] [cursor=pointer]:
              - /url: "#/project/walk-1777988470355/data"
              - generic [ref=e84]: Data
        - button "Local Mode" [ref=e86]:
          - img [ref=e89]
          - paragraph [ref=e93]: Local Mode
          - img [ref=e94]
      - main [ref=e98]:
        - generic [ref=e100]:
          - generic [ref=e101]:
            - generic [ref=e102]:
              - heading "Search" [level=2] [ref=e103]:
                - img [ref=e104]
                - text: Search
              - paragraph [ref=e107]: Configure and execute searches for literature
            - generic [ref=e109]:
              - img [ref=e110]
              - generic [ref=e113]: No sources configured
          - generic [ref=e115]:
            - heading "Search Sources" [level=3] [ref=e116]
            - generic [ref=e117]: 0 sources
```

# Test source

```ts
  1   | /**
  2   |  * End-to-end walkthrough: create review → PubMed search → preprocessing → prescreen.
  3   |  *
  4   |  * This is the smoke test that exposes "low-hanging" packaged-build bugs the
  5   |  * dev mode never sees. The query is intentionally narrow so the dataset is
  6   |  * small (no need to wait minutes for the search itself); the failure mode
  7   |  * we're chasing — multiprocessing.Pool() hanging in dedupe — fires regardless
  8   |  * of record count, so a tiny set is sufficient to reproduce.
  9   |  *
  10  |  * Mode is selected by COLREV_TEST_MODE:
  11  |  *   - unset / 'dev'    → unpacked dist/main + conda Python
  12  |  *   - 'packaged'       → built ColRev.app + python-build-standalone bundle
  13  |  */
  14  | import { test, expect } from '../fixtures/electron.fixture';
  15  | import {
  16  |   clickWhenEnabled,
  17  |   failFastOnBackendError,
  18  |   printDebugData,
  19  | } from '../helpers/test-utils';
  20  | 
  21  | const MODE = process.env.COLREV_TEST_MODE === 'packaged' ? 'packaged' : 'dev';
  22  | 
  23  | const BACKEND_TIMEOUT = MODE === 'packaged' ? 90_000 : 30_000;
  24  | const INIT_TIMEOUT = 90_000;
  25  | const SEARCH_TIMEOUT = 90_000;
  26  | const PREPROCESSING_TIMEOUT = 180_000;
  27  | 
  28  | // Narrow PubMed query — small enough to keep the run fast, but broad enough
  29  | // to reliably return >0 records across PubMed indexing changes.
  30  | const PUBMED_QUERY =
  31  |   '"systematic review"[Title] AND "machine learning"[Title] AND 2018[PDAT]';
  32  | 
  33  | test.describe(`walkthrough (${MODE})`, () => {
  34  |   test('creates a review, runs PubMed search, completes preprocessing, lands on prescreen', async ({
  35  |     window,
  36  |     waitForBackend,
  37  |     waitForRpcResponse,
  38  |     clearDebugLogs,
  39  |     getDebugData,
  40  |   }) => {
  41  |     test.setTimeout(MODE === 'packaged' ? 600_000 : 360_000);
  42  | 
  43  |     // 1. Window mounts.
  44  |     console.log('[walkthrough] waiting for app mount');
  45  |     await window.waitForSelector('#app', { timeout: 15_000 });
  46  | 
  47  |     // 2. Skip login.
  48  |     const continueBtn = window.locator('[data-testid="continue-without-login"]');
  49  |     await continueBtn.waitFor({ state: 'visible', timeout: 10_000 });
  50  |     await continueBtn.click();
  51  |     await window.waitForSelector('h2:has-text("Reviews")', { timeout: 10_000 });
  52  | 
  53  |     // 3. Backend running.
  54  |     console.log('[walkthrough] waiting for backend');
  55  |     const backendReady = await waitForBackend(BACKEND_TIMEOUT);
  56  |     if (!backendReady) {
  57  |       printDebugData(await getDebugData());
  58  |       throw new Error(`Backend did not start within ${BACKEND_TIMEOUT}ms`);
  59  |     }
  60  |     expect(backendReady).toBe(true);
  61  | 
  62  |     await clearDebugLogs();
  63  | 
  64  |     // 4. Create review.
  65  |     console.log('[walkthrough] creating project');
  66  |     await clickWhenEnabled(window, '[data-testid="new-review-trigger"]', 10_000);
  67  | 
  68  |     const projectName = `walk ${Date.now()}`;
  69  |     const slug = projectName.toLowerCase().replace(/\s+/g, '-');
  70  | 
  71  |     await window.waitForSelector('[data-testid="project-id-input"]', { timeout: 5_000 });
  72  |     await window.fill('[data-testid="project-id-input"]', projectName);
  73  |     await clickWhenEnabled(window, '[data-testid="submit-create-project"]', 5_000);
  74  | 
  75  |     const initResp = await waitForRpcResponse('init_project', INIT_TIMEOUT);
  76  |     if (!initResp) {
  77  |       printDebugData(await getDebugData());
  78  |       throw new Error(`init_project did not respond within ${INIT_TIMEOUT}ms`);
  79  |     }
  80  |     await failFastOnBackendError(getDebugData, 'after init_project');
  81  | 
  82  |     // Land on the project — the router pushes to /project/<slug>.
  83  |     await window.waitForFunction(
  84  |       (s) => window.location.href.includes(`/project/${s}`),
  85  |       slug,
  86  |       { timeout: 30_000 },
  87  |     );
  88  | 
  89  |     // 5. Navigate to Search via hash route, then add a PubMed source.
  90  |     console.log('[walkthrough] navigating to search');
  91  |     await window.evaluate((s) => {
  92  |       window.location.hash = `#/project/${s}/search`;
  93  |     }, slug);
  94  | 
  95  |     // Project init creates a dev branch asynchronously; the search page is
  96  |     // read-only while the gitStore still says we're on main, which hides the
  97  |     // Add Source affordance. Poll until the auto-switch settles before
  98  |     // continuing.
> 99  |     await window.waitForFunction(
      |                  ^ TimeoutError: page.waitForFunction: Timeout 30000ms exceeded.
  100 |       () => {
  101 |         // @ts-expect-error pinia
  102 |         const pinia = window.__pinia__;
  103 |         const g = pinia?._s.get('git');
  104 |         return g && g.currentBranch === 'dev';
  105 |       },
  106 |       undefined,
  107 |       { timeout: 30_000 },
  108 |     );
  109 | 
  110 |     await window.waitForSelector('[data-testid="add-source-card"]', { timeout: 15_000 });
  111 | 
  112 |     console.log('[walkthrough] adding PubMed source');
  113 |     await window.click('[data-testid="add-source-card"]');
  114 |     await window.waitForSelector('[data-testid="db-tile-pubmed"]', { timeout: 10_000 });
  115 |     await window.click('[data-testid="db-tile-pubmed"]');
  116 | 
  117 |     await window.waitForSelector('[data-testid="search-query-input"]', { timeout: 5_000 });
  118 |     await window.fill('[data-testid="search-query-input"]', PUBMED_QUERY);
  119 |     await clickWhenEnabled(window, '[data-testid="submit-add-source"]', 5_000);
  120 | 
  121 |     const addSourceResp = await waitForRpcResponse('add_source', 30_000);
  122 |     if (!addSourceResp) {
  123 |       printDebugData(await getDebugData());
  124 |       throw new Error('add_source did not respond');
  125 |     }
  126 |     await failFastOnBackendError(getDebugData, 'after add_source');
  127 | 
  128 |     // 6. Run the search.
  129 |     console.log('[walkthrough] running PubMed search');
  130 |     await clickWhenEnabled(window, '[data-testid="run-all-searches-button"]', 15_000);
  131 |     const searchResp = await waitForRpcResponse('search', SEARCH_TIMEOUT);
  132 |     if (!searchResp) {
  133 |       printDebugData(await getDebugData());
  134 |       throw new Error(`search did not respond within ${SEARCH_TIMEOUT}ms`);
  135 |     }
  136 |     await failFastOnBackendError(getDebugData, 'after search');
  137 | 
  138 |     // Wait for the source row to show a non-zero record count, with a short
  139 |     // poll — the SearchPage refreshes get_sources async after the search.
  140 |     const sourceCount = await window
  141 |       .waitForFunction(
  142 |         () => {
  143 |           const el = document.querySelector('[data-testid="add-source-card"]');
  144 |           if (!el) return null;
  145 |           // Fish a count out of the rendered DOM as a sanity check.
  146 |           const records = Array.from(document.querySelectorAll('span'))
  147 |             .map((s) => s.textContent ?? '')
  148 |             .find((t) => /\d+\s+records?/i.test(t));
  149 |           return records ?? null;
  150 |         },
  151 |         { timeout: 30_000 },
  152 |       )
  153 |       .then((h) => h.jsonValue())
  154 |       .catch(() => null);
  155 |     console.log(`[walkthrough] post-search source row text: ${sourceCount}`);
  156 | 
  157 |     // 7. Navigate to preprocessing.
  158 |     console.log('[walkthrough] navigating to preprocessing');
  159 |     await window.evaluate((s) => {
  160 |       window.location.hash = `#/project/${s}/preprocessing`;
  161 |     }, slug);
  162 |     await window.waitForSelector('[data-testid="preprocessing-page"]', { timeout: 15_000 });
  163 |     await window.waitForSelector('[data-testid="preprocessing-run-all-button"]:not([disabled])', {
  164 |       timeout: 30_000,
  165 |     });
  166 | 
  167 |     // 8. Run preprocessing — this is where the packaged-build dedupe hang
  168 |     //    used to surface. Wait for the dedupe step to reach status="complete".
  169 |     console.log('[walkthrough] running preprocessing (load → prep → dedupe)');
  170 |     await clearDebugLogs();
  171 |     await window.click('[data-testid="preprocessing-run-all-button"]');
  172 | 
  173 |     // Track stage progression for clearer diagnostics on failure.
  174 |     const stageLog: string[] = [];
  175 |     const start = Date.now();
  176 |     let dedupeComplete = false;
  177 |     while (Date.now() - start < PREPROCESSING_TIMEOUT) {
  178 |       const statuses = await window.evaluate(() => {
  179 |         const get = (id: string) =>
  180 |           document
  181 |             .querySelector(`[data-testid="preprocessing-step-${id}"]`)
  182 |             ?.getAttribute('data-status') ?? 'missing';
  183 |         return {
  184 |           load: get('load'),
  185 |           prep: get('prep'),
  186 |           dedupe: get('dedupe'),
  187 |         };
  188 |       });
  189 |       const fingerprint = `${statuses.load}/${statuses.prep}/${statuses.dedupe}`;
  190 |       if (stageLog[stageLog.length - 1] !== fingerprint) {
  191 |         stageLog.push(fingerprint);
  192 |         console.log(`[walkthrough] stages: ${fingerprint}`);
  193 |       }
  194 |       if (statuses.dedupe === 'complete') {
  195 |         dedupeComplete = true;
  196 |         break;
  197 |       }
  198 |       // Surface backend errors mid-flight rather than hitting the loop timeout.
  199 |       const debug = await getDebugData();
```