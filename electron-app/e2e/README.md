# E2E Test Suite

Playwright-based end-to-end tests for the CoLRev Electron app.

## Directory layout

```
e2e/
├── fixtures/
│   ├── test-workspace.fixture.ts # Playwright fixture: workspace + Electron + window
│   └── data/                     # Test data: RIS files, PDFs, sample records
├── helpers/
│   ├── launch-target.ts          # dev vs packaged: what binary the fixture launches
│   └── test-utils.ts             # clickWhenEnabled
├── lib/                          # NOTE: hashed into snapshot cache keys — adding
│   │                             # files here invalidates all cached snapshots
│   ├── seeders.ts                # seedAccounts / seedAliceProject / seedRecords / ...
│   ├── snapshot-cache.ts         # tarball-backed snapshot cache (post-search, post-preprocessing, …)
│   └── test-workspace.ts         # /tmp/colrev-e2e/<test>/ harness
├── smoke/                        # packaged-app smoke suite (--project=smoke)
├── specs/                        # full pipeline suite (--project=e2e)
├── tsconfig.json
└── README.md
```

## Dev vs packaged mode

Every fixture-launched test can run against two targets, selected by
`COLREV_TEST_MODE`:

| Mode | What launches | Python backend | Git |
|------|---------------|----------------|-----|
| `dev` (default) | `node_modules` electron + `dist/main/index.js` | host conda env `~/miniforge3/envs/colrev` | host |
| `packaged` | `release/mac-arm64/ColRev.app` (or `COLREV_PACKAGED_APP`) | bundled python-build-standalone inside the app | bundled dugite git |

In packaged mode the fixture deliberately does **not** inject the conda env —
the app must be self-sufficient, and leaking `PYTHONHOME` would mask bundle
defects. See `helpers/launch-target.ts`.

**Source-skew pitfall (worktrees):** the conda env's colrev is an *editable*
install pointing at the main checkout. In a git worktree, dev-mode tests
therefore run whatever colrev source the main checkout has checked out — not
the worktree's. Packaged mode does not have this problem: the python bundle's
colrev wheel is built from the repo the packaging script ran in. If dev-mode
specs fail on missing status fields while packaged mode passes, check
`git -C <main-checkout> log -1` first. The same applies to snapshot fixtures:
rebuild them with `BUILD_FIXTURES=1 COLREV_TEST_MODE=packaged ...` when the
main checkout is behind your branch.

## Smoke tests of the packaged app

The `smoke` Playwright project (`e2e/smoke/`) is a fast integrity check of an
actual electron-builder artifact: app boots, python bundle + git shipped in
`Contents/Resources`, backend reaches `running`, and a review is created
end-to-end through the UI (init_project RPC → git commits → push to the fake
GitHub bare remote).

```bash
cd electron-app

# One command: package unsigned + run the packaged smoke suite
npm run smoketest:mac          # full (rebuilds the python bundle)
npm run smoketest:mac:fast     # reuse existing resources/python-mac-arm64

# Pieces, if you already have a build in release/:
npm run test:smoke             # smoke suite against the dev build
npm run test:smoke:packaged    # smoke suite against release/ artifact

# Full pipeline suite against the packaged app
COLREV_TEST_MODE=packaged npx playwright test --project=e2e
# or: bash ../scripts/smoketest.sh mac --skip-package --suite e2e
```

`scripts/smoketest.sh` is the CI-shaped entry point (exit code = Playwright
exit code). If the host's `python3.12` is PEP-668 managed (homebrew), point
`HOST_PYTHON` at the conda env before a full build:

```bash
HOST_PYTHON=~/miniforge3/envs/colrev/bin/python npm run smoketest:mac
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
| `COLREV_TEST_MODE` | `packaged` makes the fixture launch the electron-builder artifact instead of `dist/main/index.js` (see "Dev vs packaged mode"). |
| `COLREV_PACKAGED_APP` | Overrides the packaged binary the fixture launches. Accepts the executable or a mac `.app` bundle path. |

## Reliability and parallelism

| Setting | Value | Why |
|---------|-------|-----|
| `retries` | `1` in CI, `0` locally | A single flake at `retries: 0` reds the whole suite, which teaches people to ignore it. With one retry a flake is still visible — Playwright reports the test as **flaky** and the HTML report keeps the retry attempt with its trace — while a real regression still fails the run. Locally we keep `0` so a flake is felt immediately, while the workspace that produced it is still on disk. |
| `workers` | `1` | Each spec launches its own Electron process and Python backend. Running them concurrently on one machine oversubscribes CPU badly enough that the 90s per-test timeout starts firing on slow steps, which reads as a flake. The units of parallelism here are **CI jobs, not workers**: specs already own isolated workspaces, so a matrix of one job per spec file cuts wall-clock without sharing a machine. |

When a test is reported flaky, treat it as a bug with a workspace attached:
`/tmp/colrev-e2e/<test>/` holds the failing attempt's `rpc.jsonl`,
`renderer.log` and `backend.log`, and the retained trace is in
`playwright-report/`.

### The snapshot cache is a real cost

Most specs load a pre-built snapshot instead of walking the UI from scratch,
and any change under `SNAPSHOT_SOURCE_ROOTS` invalidates the whole chain — so
an innocuous edit to `e2e/lib/seeders.ts` means rebuilding **every** snapshot
before the suite can run again (see "Snapshot loading" above for the command).
Budget for it: the rebuild runs the full pipeline end to end. If you are about
to touch a hash input, do it in one change rather than several.

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
