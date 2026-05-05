# PRD: E2E Testing Framework for the Electron App (2-Reviewer GitHub Workflow)

## Problem Statement

The Electron app's only legitimate end-to-end flow is a GitHub-based collaboration in which two reviewers prescreen and screen records on separate clones of a shared repo. There is currently no reliable way to test this flow:

- The existing Playwright specs (`create-review.spec.ts`, `walkthrough.spec.ts`) reflect an older single-user "solo lifecycle" that no longer represents real product behavior.
- Real GitHub authentication and remote operations make automated tests slow, flaky, network-dependent, and unable to run inside hermetic environments (CI, sandboxed agents).
- All projects currently live in one shared `userData/projects/` directory regardless of the active GitHub account, so switching accounts in the app shows the same project list — a state the production product should not allow and that makes "two reviewers on one machine" untestable.
- A Claude Code agent running tests has no predictable on-disk layout to inspect when something breaks; logs and intermediate state are scattered or held only in memory.

The result: the team cannot lock down regressions in the multi-reviewer flow, cannot iterate on UI changes with confidence, and cannot hand a failing test to an agent and expect it to diagnose without the human re-explaining the scenario each time.

## Solution

Build a Playwright-based E2E testing framework that exercises the real 2-reviewer GitHub-collab flow end-to-end without ever contacting github.com:

- A **bare local git repository** acts as the shared remote. All `git push` / `pull` / `fetch` / `merge` operations are real.
- A **fake GitHub client** replaces the REST calls in the app's `github-manager` when an environment variable is set. It reads and writes a JSON registry file standing in for github.com (accounts, repos, collaborators, invitations, releases). The real client is unchanged in production builds.
- The app gains **per-account project isolation** so two logged-in accounts on the same machine see two separate project lists with separate clones — fixing both the test obstacle and a real product correctness bug.
- Tests run as a **single Electron process** that switches between accounts via a test-only IPC method, exercising the actual `AuthManager.switchAccount` path.
- A **layered fixture model** with **snapshot caching** lets the framework rebuild expensive setup once and reuse it across many tests. A single "build-fixtures" run produces tarball checkpoints (L1 = accounts seeded, L2 = empty project pushed, L3 = project with seeded records, L4 = collaborator added and accepted). Sub-step tests load the latest snapshot of the level they need; stale snapshots fail loudly with a clear regenerate command.
- Every test runs in a **predictable on-disk path** (`/tmp/colrev-e2e/<test-name>/`) that is wiped at the *start* of the next run, never on failure. Backend stderr, renderer console, and the full RPC trace are persisted to plain files at known paths. An agent investigates failures with `cat`, `git log`, `ls`, and `grep` — no inspection APIs to learn.

What the framework does *not* deliver in this PRD: a battery of scenario tests. Only one proof-of-life test (full 2-reviewer prescreen path loaded from L4) ships with the framework. All further scenarios are follow-up work owned by the team building on the framework.

## User Stories

1. As a developer working on the Electron app, I want a Playwright suite that exercises the real 2-reviewer GitHub flow without contacting github.com, so that I can run tests offline and in CI without managing test GitHub accounts or rate limits.

2. As a developer, I want the test framework to drive the same code paths as production (real `AuthManager`, real `git` operations, real JSON-RPC backend), so that passing tests give me real confidence rather than confidence in mocks.

3. As a developer, I want each test to start from a pinned, predictable directory under `/tmp/colrev-e2e/`, so that I always know where to look when a test fails.

4. As a developer, I want the test framework to leave the failing test's full state on disk (not tear it down), so that I can inspect the exact world the failure occurred in.

5. As a Claude Code agent running with bash access, I want backend logs, renderer logs, and RPC traces persisted to plain files at known paths inside the test directory, so that I can investigate failures with shell tools without needing fixture-specific helpers.

6. As a Claude Code agent, I want a `last-state.json` file dropped at the end of each test capturing the active account, account directories, bare remote path, registry path, and last RPC, so that I can orient myself in the test world in seconds.

7. As a developer, I want layered fixtures (L1 accounts, L2 empty project, L3 project with records, L4 collaborator accepted) so that each test only pays for the setup it actually needs.

8. As a developer, I want a single `build-fixtures` run to produce tarball snapshots of every layer, and individual tests to load the layer they need in under a second, so that the inner-loop iteration speed for a single test is dominated by the assertion, not the setup.

9. As a developer, I want snapshots cached in `~/.cache/colrev-test-fixtures/` (not committed to the repo), so that the repo stays clean and snapshots are treated as derived artifacts.

10. As a developer, I want each snapshot to carry a hash key over the relevant source files, so that loading a stale snapshot after a code change fails loudly with a clear "rebuild fixtures" message instead of silently passing against outdated state.

11. As a developer, I want git commits inside snapshots to be byte-stable (pinned author/committer dates), so that snapshot diffs reflect real changes and not timestamp churn.

12. As a developer running the app in production, I want my GitHub account's projects to be isolated from any other account's projects on the same machine, so that switching accounts shows me only my own clones.

13. As a developer, I want a brand-new project always to belong to the currently active account (no "ownerless" projects), so that the project-to-account relationship is unambiguous everywhere.

14. As a developer, I want the fake GitHub registry to model accounts, repos, collaborators, pending invitations, and releases, so that every GitHub-touching path in the app has an honest fake to run against.

15. As a developer, I want the fake/real `GitHubClient` selection driven entirely by a single environment variable, so that production builds have zero added surface area and tests have a single switch to flip.

16. As a developer, I want a test-only IPC method to switch accounts (`__test/switchAccount`) that is only registered when the test env var is set, so that tests do not have to navigate the account dropdown UI but production binaries do not expose the method.

17. As a developer, I want the fake `GitHubClient` to be a deep module with a narrow interface and a single JSON file as its backing store, so that I can read and edit the registry by hand when debugging.

18. As a developer, I want one proof-of-life test that drives the full 2-reviewer prescreen flow from L4, so that the framework's first-day output proves the architecture works end-to-end.

19. As a developer, I want the existing outdated Playwright specs deleted as part of this work, so that the suite has a single authoritative baseline.

20. As a developer, I want a short README in `electron-app/e2e/` describing how to write a new test, where state lives, how snapshots work, and how to regenerate them, so that the framework is self-documenting.

21. As a developer, I want test data fixtures (sample bib/RIS files, deterministic record IDs) placed under a known fixtures path, so that adding a new test does not require inventing test data each time.

22. As a Claude Code agent debugging a failed test, I want the exact RPC trace as JSON-lines (one request/response per line) at `<test-dir>/rpc.jsonl`, so that I can grep, jq, and reason about the conversation without parsing pretty-printed logs.

23. As a developer, I want the framework to be runnable inside Sandcastle / Docker without code changes, so that automated agent runs in containers do not require a special path.

## Implementation Decisions

### Modules to build or modify

**App-side (Electron main process):**

- **`AccountScopedProjectPaths` (new, deep module)** — single source of truth for resolving any per-project filesystem path given an account login. Replaces the ~5 inlined `path.join(app.getPath('userData'), 'projects')` call sites in the main process. Interface is small (`projectsRootForAccount(login)`, `projectPath(login, projectId)`); implementation reads the active account from `AuthManager`. This is the keystone for "switch account, see different projects" both in production and in tests.
- **`GitHubClient` interface + `RealGitHubClient` + `FakeGitHubClient` (new)** — the existing exported functions in the github-manager module are reorganized behind a single client interface (list user repos, list colrev repos, list/add collaborators, list/accept invitations, list/create releases, create-repo-and-push, delete repo, parse owner/repo). `RealGitHubClient` keeps the current REST behavior. `FakeGitHubClient` reads/writes a JSON registry file. A factory selects which to use based on the `COLREV_FAKE_GITHUB_REGISTRY` env var.
- **`FakeGitHubRegistry` (new, deep module)** — encapsulates the on-disk registry schema and atomic read/modify/write. Single JSON file, documented schema (accounts, repos, collaborators, invitations, releases). All `FakeGitHubClient` methods route through this. Deep enough to test in isolation without Electron.
- **`AuthManager` (modified)** — small additions only. The existing `switchAccount` is reused. A test-only IPC handler `__test/switchAccount` is registered when the fake-GitHub env var is set; it calls `switchAccount` directly.
- **JSON-RPC bridge wiring (modified)** — when the test env var is set, the bridge passes account-scoped `base_path` to the Python backend (already a parameter on every RPC). When pinning is needed for snapshot determinism, the bridge sets `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` env vars before spawning git operations.

**Test-side (under `electron-app/e2e/`):**

- **`TestWorkspace` (new, deep module)** — represents one test's on-disk world. Pinned at `/tmp/colrev-e2e/<test-name>/`. Owns subpaths for `userData/`, `bare-remote/`, `registry.json`, `backend.log`, `renderer.log`, `rpc.jsonl`, `last-state.json`. Wipes itself only at the start of a run. Exposed to tests as a Playwright fixture.
- **Direct-disk seeders (new)** — small idempotent functions: `seedAccounts(workspace, accounts)`, `seedBareRemote(workspace, repoName)`, `seedAliceProject(workspace)`, `seedRecords(workspace, recordsBibFixturePath)`. Each writes the minimal real artifacts to disk; no UI involved.
- **`SnapshotCache` (new, deep module)** — encapsulates checkpoint write/read against `~/.cache/colrev-test-fixtures/`. Tarballs the `TestWorkspace`. Computes and stores a hash key per snapshot over the relevant source roots. `loadCheckpoint(name)` errors if the hash is stale with a precise regenerate instruction. Deep module: simple interface (`checkpoint`, `load`, `isStale`), encapsulates tar/untar, hashing, and metadata.
- **`switchAccount(workspace, login)` test helper (new)** — invokes the test-only IPC method through Playwright's Electron evaluation, then awaits the renderer's auth-state update.
- **`build-fixtures.spec.ts` (new)** — the single Playwright spec that walks the full real flow and emits L1–L4 snapshots. Run on demand or before any test that loads a checkpoint.
- **`prescreen-2-reviewer.spec.ts` (new, proof-of-life)** — loads L4 and drives the prescreen flow for both reviewers. The framework's own smoke test.
- **`README.md` under `electron-app/e2e/`** — short author guide.

### Environment-variable surface

- `COLREV_FAKE_GITHUB_REGISTRY=<path>` — when set, the app uses `FakeGitHubClient` against the file at that path and registers the `__test/switchAccount` IPC. When unset, production behavior.
- `COLREV_E2E_PINNED_DATES=1` (optional) — when set during `build-fixtures`, the JSON-RPC bridge pins git author/committer dates for snapshot determinism.

### Removed / deprecated

- `electron-app/e2e/specs/create-review.spec.ts` and `electron-app/e2e/specs/walkthrough.spec.ts` are deleted. Test data fixtures (RIS, PDF) are kept and re-organized under a known fixtures path.

### Out-of-band concerns explicitly addressed

- **CoLRev core (Python) is not touched.** Per repo conventions, the Python core is read-only here. Only the JSON-RPC bridge in `colrev_jsonrpc/` is touched, and only minimally (env-var passthrough for date pinning).
- **GitHub-agnostic production mode is not introduced.** The `GitHubClient` abstraction is a pure refactor with one production implementation. The fake exists for tests only. A future production "self-hosted" or "local-FS-only" backend can slot in later behind the same interface.

## Testing Decisions

### What makes a good test in this framework

- Tests assert **observable external behavior**: UI state, RPC responses, git history on the bare remote, files on disk under the account's project directory. They do not assert internal class state, private fields, or implementation details.
- Tests **drive the UI for the action under test** but use direct-disk seeders and snapshot loads for everything *before* that action. This keeps tests fast without hiding bugs in the path being tested.
- Tests **leave their state on disk on failure** and never depend on cleanup running. Cleanup is the next run's responsibility.
- Tests **must be re-runnable in any order** and **must not share global mutable state** beyond the snapshot cache (which is read-only at test time).

### Modules to be tested in isolation (deep modules)

The deep modules introduced by this PRD are individually testable without launching the full Electron app:

1. **`FakeGitHubRegistry`** — unit tests over the JSON schema, atomic write, edge cases (concurrent reads, missing file, malformed file, invitation lifecycle, collaborator lifecycle, release creation).
2. **`FakeGitHubClient`** — unit tests asserting it satisfies the `GitHubClient` interface contract and produces the same observable results as the registry would imply.
3. **`SnapshotCache`** — unit tests over checkpoint write/read, hash-key staleness detection (rebuild-on-source-change), portability across temp-dir paths, error messages on stale load.
4. **`AccountScopedProjectPaths`** — unit tests over the path-resolution logic, including the "no active account" edge case.
5. **`TestWorkspace`** — unit tests over directory layout, log-file creation, `last-state.json` emission, start-of-run wipe semantics.

These five modules carry the bulk of the framework's complexity. End-to-end Playwright tests then verify the integration: the real Electron app + real backend + fake GitHub + bare remote, behaving as a 2-reviewer collaboration.

### End-to-end test coverage shipped with this PRD

- `build-fixtures.spec.ts` — real-flow build of L1 through L4. Runs as a precondition to the proof-of-life. Doubles as the integration test that proves direct-disk seeders and snapshots are coherent with the app's real behavior.
- `prescreen-2-reviewer.spec.ts` — single proof-of-life loading L4. Validates the architecture is sound. Not a battery; just one passing test.

### Prior art

- The current `electron-app/e2e/fixtures/electron.fixture.ts` already shows the Playwright + Electron fixture pattern in use (custom fixtures, debug-data accessors, backend log capture). The new framework keeps that shape but replaces what the fixtures expose: instead of in-memory log accessors, it returns a `TestWorkspace` rooted at `/tmp/colrev-e2e/<test>/` with files an agent can read directly.
- The CoLRev Python suite under `tests/` uses a pattern of `conf.run_around_tests()` for state restoration; the new Electron framework deliberately diverges (start-of-run wipe, never end-of-run) because the consumer is an agent doing forensics, not a CI matrix optimizing throughput.

## Out of Scope

- The full battery of scenario tests (solo lifecycle, dedupe disagreement, PDF retrieval failure paths, project recovery, settings changes, search-source variants). Only one proof-of-life test ships.
- A GitHub-agnostic production backend (LocalFS or self-hosted git). The `GitHubClient` abstraction is introduced, but the second production implementation is future work.
- Real-GitHub integration tests against a sandbox org. Out of scope; the fake is the contract.
- Two-process tests where two Electron instances run concurrently against the same bare remote. Single-process with `switchAccount` is the default. Concurrency-bug coverage is future work.
- Sandcastle/CI pipeline configuration. The framework will work in those environments by virtue of being on-disk and bash-inspectable, but wiring it into a specific CI workflow is a separate ticket.
- Mocking time, RNG, or network at any layer beyond the GitHub client. Date pinning during `build-fixtures` is the only determinism control introduced.
- Visual regression / screenshot diffing.
- Performance benchmarking of the suite.

## Further Notes

- The `needs-triage` label specified by the `to-prd` skill is not present in this repo's label vocabulary. This issue is filed with `enhancement` instead. If the team wants the skill's standard triage flow, they should add the `needs-triage` label and rerun the skill setup.
- The biggest risk in this PRD is that direct-disk seeders construct states the app cannot actually reach via real flows. The `build-fixtures.spec.ts` run mitigates this: it builds every snapshot layer through real UI/RPC before any direct seeder exists, so the seeders' job is only to recreate states the build run has already proven reachable. If a direct seeder ever drifts from reality, the snapshot it produced will mismatch the next `build-fixtures` regeneration and surface immediately.
- The framework intentionally has no "test helpers for inspection." A Claude Code agent with bash access does its own forensics. Helpers are limited to setup (seeding, switching accounts, loading snapshots) and a single end-of-test `last-state.json` orientation file.
