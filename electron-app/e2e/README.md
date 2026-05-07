# E2E Test Suite

Playwright-based end-to-end tests for the CoLRev Electron app.

## Directory layout

```
e2e/
├── fixtures/
│   ├── test-workspace.fixture.ts # Playwright fixture: workspace + Electron + window
│   └── data/                     # Test data: RIS files, PDFs, sample records
├── helpers/
│   └── test-utils.ts             # clickWhenEnabled
├── lib/
│   ├── seeders.ts                # seedAccounts / seedAliceProject / seedRecords / ...
│   ├── snapshot-cache.ts         # tarball-backed snapshot cache (post-search, post-preprocessing, …)
│   └── test-workspace.ts         # /tmp/colrev-e2e/<test>/ harness
├── specs/                        # *.spec.ts files
├── tsconfig.json
└── README.md
```

## How to write a new test

1. Create a `.spec.ts` file under `e2e/specs/`.
2. Import the extended test from the workspace fixture:
   ```ts
   import { test, expect, ALICE, BOB } from '../fixtures/test-workspace.fixture';
   import { clickWhenEnabled } from '../helpers/test-utils';
   ```
3. Use the provided fixtures in your test signature:
   - `workspace` — `TestWorkspace` rooted at `/tmp/colrev-e2e/<safe-test-title>/`.
   - `electronApp` — Playwright `ElectronApplication`. Launched with `COLREV_FAKE_GITHUB_REGISTRY=<workspace.registryPath>` so the app uses `FakeGitHubClient` and exposes `window.__test`.
   - `window` — Playwright `Page` for the renderer. Console output and pageerrors are auto-captured to `<workspace>/renderer.log`.
4. Add `data-testid` attributes to any new Vue components you interact with.
5. Use `clickWhenEnabled()` for buttons that may be disabled (form validation).
6. Between distinct phases, call `await workspace.markPhase(electronApp, 'phase-name')` — this dumps every Pinia store's `$state` to `<workspace>/state-after-<phase-name>.json` and writes a `phase` line into `rpc.jsonl` so traces correlate across layers.

### Snapshot loading

Most specs start from a pre-built named snapshot rather than walking the UI from scratch. Snapshots are produced by per-stage specs and named after the stage they capture (`post-search`, `post-preprocessing`, `post-prescreen`, `post-pdf-get`):

```ts
import { SnapshotCache, SNAPSHOT_SOURCE_ROOTS } from '../fixtures/test-workspace.fixture';

const cache = new SnapshotCache({
  cacheDir: path.join(os.homedir(), '.cache', 'colrev-test-fixtures'),
  sourceRoots: SNAPSHOT_SOURCE_ROOTS,
});
cache.load('post-preprocessing', workspace.root);
```

`SnapshotCache.load` rewrites stale absolute paths (registry `cloneUrl` and each cloned project's `origin` remote) to point at the new workspace, so specs don't need a per-test fixup helper.

If `SnapshotCache.load` errors with "stale", rebuild the chain with `BUILD_FIXTURES=1`:

```bash
BUILD_FIXTURES=1 npx playwright test e2e/specs/01-search.spec.ts \
                                     e2e/specs/02-preprocessing.spec.ts \
                                     e2e/specs/03-prescreen-2-reviewer.spec.ts \
                                     e2e/specs/04-pdf-get.spec.ts
```

The hash inputs are listed in `SNAPSHOT_SOURCE_ROOTS` and currently include `e2e/lib/`, `e2e/fixtures/data/`, `src/main/auth-manager.ts`, and `src/main/fake-github-registry.ts` — touching any of those invalidates the cache.

## Where state lives on disk

Each test's workspace is at `/tmp/colrev-e2e/<safe-test-title>/`. The directory is wiped at the **start** of the next run, not on failure — so the failing state is always available for inspection.

| File | Contents |
|------|----------|
| `rpc.jsonl` | JSON-lines RPC trace: one `request` / `response` per line, plus `phase` markers from `markPhase` |
| `backend.log` | Python backend stderr (capped at 10 MB; truncated to last 5 MB beyond that) |
| `renderer.log` | Renderer console messages and pageerrors |
| `state-after-<name>.json` | Snapshot of every Pinia store's `$state` at the corresponding `markPhase` call |
| `last-state.json` | Written in afterEach: `{ activeAccount, registryPath, bareRemotePath, lastRpc }`. Derived from disk so it survives a crashed Electron process. |
| `userData/` | Electron `--user-data-dir`. Contains `auth.json` and `projects/<login>/<projectId>/.git/...` |
| `bare-remote/<owner>/<repo>.git` | Bare git repos that stand in for GitHub remotes |
| `registry.json` | Backing store for `FakeGitHubRegistry` (accounts, repos, collaborators, invitations, releases) |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `COLREV_FAKE_GITHUB_REGISTRY` | Path to a JSON file. When set, the app uses `FakeGitHubClient` instead of real GitHub REST calls and registers the `__test/switchAccount` IPC method. The fixture sets this automatically. |
| `COLREV_E2E_PINNED_DATES` | When `1`, the JSON-RPC bridge pins `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` for snapshot determinism during fixture builds. |

## Running tests

```bash
cd electron-app

# Build first (required by the fixture, which launches dist/main/index.js)
npm run build

# Run the full e2e suite
npm run test:e2e

# Or run a single spec
npx playwright test e2e/specs/03-prescreen-2-reviewer.spec.ts
```

The fixture prepends `~/miniforge3/envs/colrev/bin` to `PATH` so the JSON-RPC backend resolves `python` / `colrev-jsonrpc` against the project's conda env without manual activation.

### Running inside Sandcastle / Docker

The test suite works in containers without code changes. Requirements:

- Node.js and npm installed
- The conda environment at `~/miniforge3/envs/colrev`
- `npm run build` completed
- A display server or `xvfb-run` for Electron's GUI:
  ```bash
  xvfb-run npm run test:e2e
  ```

## How an agent debugs a failed test

When a spec fails, everything you need is at `/tmp/colrev-e2e/<test-name>/`:

```bash
# Orient yourself: which account was active, what was the last RPC?
cat /tmp/colrev-e2e/<test>/last-state.json

# Walk the RPC conversation, including phase markers
cat /tmp/colrev-e2e/<test>/rpc.jsonl | jq .

# Per-phase Pinia state
ls /tmp/colrev-e2e/<test>/state-after-*.json

# Backend stderr
grep -i 'error\|traceback\|exception' /tmp/colrev-e2e/<test>/backend.log

# Renderer console + pageerrors
cat /tmp/colrev-e2e/<test>/renderer.log

# Project state
git -C /tmp/colrev-e2e/<test>/userData/projects/<login>/<projectId> log --oneline
```

Common patterns:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `clickWhenEnabled` timeout | Button never becomes enabled; form validation blocking | Check that prerequisite fields are filled and valid |
| RPC error code `-32000` | CoLRev project not initialized or path wrong | Verify `project_id` and `base_path` in the RPC params |
| Snapshot hash mismatch | A file in `SNAPSHOT_SOURCE_ROOTS` changed | Regenerate the chain with `BUILD_FIXTURES=1` (see "Snapshot loading" above) |
| `state-after-*.json` empty `{}` | Renderer not yet mounted when `markPhase` ran | Wait for a stable selector before calling `markPhase` |

To re-run a single test:

```bash
npx playwright test --grep "test name substring"
```

Add `--headed` to watch the Electron window, or `--debug` to step through with the Playwright inspector.
