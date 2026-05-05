# E2E Test Suite

Playwright-based end-to-end tests for the CoLRev Electron app.

## Directory layout

```
e2e/
├── fixtures/
│   ├── electron.fixture.ts   # Playwright fixtures (app launch, RPC helpers, debug access)
│   └── data/                 # Test data: RIS files, PDFs, sample records
│       ├── asr.ris
│       ├── asr-updated.ris
│       ├── arxiv_references.ris
│       ├── source1.ris
│       ├── source2.ris
│       └── 2601.00044v1.pdf
├── helpers/
│   └── test-utils.ts         # Shared utilities (clickWhenEnabled, failFastOnBackendError, etc.)
├── tsconfig.json
└── README.md
```

New spec files go in `e2e/` (flat) or in a `specs/` subdirectory if the suite grows large enough to warrant it.

## How to write a new test

1. Create a `.spec.ts` file under `e2e/`.
2. Import the extended test and expect from the fixture:
   ```ts
   import { test, expect } from './fixtures/electron.fixture';
   import { clickWhenEnabled, failFastOnBackendError } from './helpers/test-utils';
   ```
3. Use the provided fixtures in your test signature:
   - `window` — Playwright `Page` for the Electron renderer.
   - `waitForBackend(timeout?)` — polls until the JSON-RPC backend is `running`.
   - `waitForRpcResponse(method?, timeout?)` — waits for a specific RPC response.
   - `clearDebugLogs()` — clears accumulated debug/RPC logs between test steps.
   - `getDebugData()` — returns `{ logs, backendLogs, backendStatus, hasErrors }`.
   - `getRpcLogs()` — returns only RPC request/response/error entries.
4. Add `data-testid` attributes to any new Vue components you interact with.
5. Use `clickWhenEnabled()` for buttons that may be disabled (form validation).
6. Call `failFastOnBackendError(getDebugData, 'context')` after RPC calls to surface Python tracebacks immediately instead of waiting for a timeout.

### Minimal example

```ts
import { test, expect } from './fixtures/electron.fixture';
import { clickWhenEnabled, failFastOnBackendError } from './helpers/test-utils';

test('backend starts and responds to RPC', async ({
  window, waitForBackend, getDebugData,
}) => {
  await window.waitForSelector('#app', { timeout: 15_000 });

  const ready = await waitForBackend(30_000);
  expect(ready).toBe(true);

  await failFastOnBackendError(getDebugData, 'after backend start');
});
```

### Test data fixtures

All sample data files live under `e2e/fixtures/data/`. Reference them with:

```ts
import path from 'path';
const dataDir = path.join(__dirname, 'fixtures', 'data');
const risFile = path.join(dataDir, 'asr.ris');
```

When adding new test data (bib, RIS, PDF, etc.), place it in `fixtures/data/` so all tests share a single well-known location.

## Where state lives on disk

### Dev mode

In dev mode, each test gets an isolated temporary `--user-data-dir` created by the Electron fixture. Projects created during a test live inside that temp directory, not in the real Application Support folder.

The Electron fixture cleans up the temp directory after each test. On failure, Playwright retains traces and screenshots in `electron-app/test-results/`.

### Packaged mode

Same isolation via `--user-data-dir`. Requires a prior build (`npm run build:fast`).

## Snapshot lifecycle

The PRD (#5) specifies a layered snapshot system (L1-L4) cached at `~/.cache/colrev-test-fixtures/`. This is not yet implemented. When it lands:

- **Build**: `build-fixtures.spec.ts` walks the real UI flow and emits tarball snapshots at each layer.
- **Load**: Tests call `SnapshotCache.load(level)` to restore a snapshot in < 1 second.
- **Staleness**: Each snapshot carries a hash of relevant source files. Loading a stale snapshot errors with a message telling you to regenerate.
- **Regenerate**: Run the build-fixtures spec to rebuild all layers:
  ```bash
  npx playwright test build-fixtures.spec.ts
  ```
- Snapshots are derived artifacts, not committed to the repo.

## Log and trace file paths

### Current (Pinia-based)

Logs are currently held in-memory in Pinia stores and accessed via the `getDebugData()` / `getRpcLogs()` fixtures. Backend stderr is captured by the Electron fixture and exposed through `backendLogs`.

### Planned (file-based, per PRD #5)

Each test will write to a predictable directory at `/tmp/colrev-e2e/<test-name>/`:

| File | Contents |
|------|----------|
| `rpc.jsonl` | JSON-lines RPC trace (one request/response per line) |
| `backend.log` | Python backend stderr |
| `renderer.log` | Renderer console output |
| `last-state.json` | End-of-test snapshot: active account, project paths, bare remote, registry path, last RPC |

These paths are stable across runs. The directory is wiped at the **start** of the next run, not on failure — so the failing state is always available for inspection.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `COLREV_TEST_MODE` | `dev` (default) or `packaged` — selects whether to launch from `dist/main/index.js` with conda Python or from the built `.app` bundle |
| `COLREV_FAKE_GITHUB_REGISTRY` | Path to a JSON file. When set, the app uses `FakeGitHubClient` instead of real GitHub REST calls and registers the `__test/switchAccount` IPC method. (Planned, PRD #5) |
| `COLREV_E2E_PINNED_DATES` | When `1`, the JSON-RPC bridge pins `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` for snapshot determinism during fixture builds. (Planned, PRD #5) |

## Running tests

```bash
cd electron-app

# Dev mode (requires: npm run build && conda activate colrev)
npm run test:e2e

# With visible Electron window
npm run test:e2e:headed

# With Playwright inspector
npm run test:e2e:debug

# Against packaged build (requires: npm run build:fast)
npm run test:e2e:packaged
npm run test:e2e:packaged:headed
```

### Running inside Sandcastle / Docker

The test suite works in containers without code changes. Requirements:

- Node.js and npm installed
- The conda environment at `~/miniforge3/envs/colrev` (or update the path in `fixtures/electron.fixture.ts`)
- `npm run build` completed (for dev mode)
- A display server or `xvfb-run` for Electron's GUI:
  ```bash
  xvfb-run npm run test:e2e
  ```

The fixture automatically prepends the conda env to `PATH`, so manually activating conda is not required.

## How an agent debugs a failed test

When a test fails, follow this sequence:

### 1. Read the test output

Playwright prints the failure and any `console.log` output from the test. Look for:
- Python tracebacks in backend logs (lines starting with `ERROR`, `Traceback`, `Exception`)
- RPC error responses (JSON-RPC error codes: `-32000` repo setup, `-32001` operation, `-32004` parameter)
- Timeout messages indicating which step hung

### 2. Check Playwright artifacts

```bash
ls electron-app/test-results/
```

Playwright retains traces, screenshots, and video on failure (configured in `playwright.config.ts`). View a trace:
```bash
npx playwright show-trace electron-app/test-results/<test-folder>/trace.zip
```

### 3. Inspect on-disk state (when file-based logging lands)

Once PRD #5 is implemented, each test leaves its full state at `/tmp/colrev-e2e/<test-name>/`:

```bash
# Orient yourself
cat /tmp/colrev-e2e/<test-name>/last-state.json

# Check the RPC conversation
cat /tmp/colrev-e2e/<test-name>/rpc.jsonl | jq .

# Read backend errors
grep -i error /tmp/colrev-e2e/<test-name>/backend.log

# Inspect the project state
ls /tmp/colrev-e2e/<test-name>/userData/projects/
git -C /tmp/colrev-e2e/<test-name>/userData/projects/<project>/ log --oneline

# Check renderer console
cat /tmp/colrev-e2e/<test-name>/renderer.log
```

### 4. Common failure patterns

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Timeout waiting for backend | Python import error or missing dependency | Check backend stderr for `ModuleNotFoundError` |
| `clickWhenEnabled` timeout | Button never becomes enabled; form validation blocking | Check that prerequisite fields are filled and valid |
| RPC returns error code `-32000` | CoLRev project not initialized or path wrong | Verify `project_id` and `base_path` in the RPC params |
| `last-state.json` missing | Test crashed before teardown wrote it | Fall back to Playwright trace and backend stderr |
| Snapshot hash mismatch | Source files changed since last `build-fixtures` | Regenerate: `npx playwright test build-fixtures.spec.ts` |

### 5. Re-run a single test

```bash
npx playwright test --grep "test name substring"
npx playwright test e2e/my-test.spec.ts
```

Add `--headed` to watch the Electron window, or `--debug` to step through with the Playwright inspector.
