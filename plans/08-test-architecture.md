# WP-08: Test Architecture — Store Testability, Contract Tests, Coverage Gaps

## Context

The layers where the bugs actually live are the least tested. Renderer stores and components are structurally untestable today (`vitest` runs in `environment: 'node'` with no DOM tooling); the fake GitHub client used by e2e has behaviorally drifted from the real one with nothing pinning them; half the RPC handlers have no tests; and the e2e suite is serial with `retries: 0`, so it is run rarely — yet it is the *only* coverage for stores, components, preload, and the RPC round-trip. Packages 01–07 each add their own tests; this package builds the shared infrastructure and closes the remaining gaps.

## Current state (from review)

- **Renderer:** unit tests exist only for pure `lib/` modules (`stepStatus`, `stepPageShell`, `gitSyncState`, `sidebar`). Zero coverage for stores (`git` 817 lines, `projects` 530, `managedReview`, `pendingChanges`, `backend`, `connection`) and all `.vue` components. `vitest.config.ts`: `environment: 'node'`.
- **Python:** `tests/4_jsonrpc/` covers ~9 of 19 handlers (integration-style, real `ReviewManager` — good pattern). Missing: `data`, `dedupe`, `init`, `load`, `pdf_get`, `pdf_prep`, `pdf_share`, `prep`, `review_definition`, `system`.
- **Main process:** unit tests exist for auth/fake-github/registry/paths; `git-manager`, the IPC glue, and (pre-WP-04) `semantic-merge` have none.
- **Fake vs real GitHub drift:** duplicated `parseOwnerRepo` — the fake also accepts local file paths (`fake-github-client.ts:245-257` vs `github-manager.ts:132-139`); fake shells out to **system git** while production uses dugite (`fake-github-client.ts:194-215` vs `github-manager.ts:644-767`); `addRepoCollaborator` `invited` semantics differ (`fake-github-client.ts:78-79` vs `github-manager.ts:401-408`). Regressions in real-only branches are invisible to e2e.
- **e2e:** `workers: 1`, `timeout: 90_000` (180s packaged), `retries: 0`; snapshot cache invalidated by any seeder/fixture change. 7 pipeline specs.

## Scope of work

### 1. Make the renderer testable

- Add `happy-dom` (or jsdom) + `@vue/test-utils` + `@pinia/testing`; per-file environment so existing node tests stay fast.
- Establish the store-testing pattern: Pinia store + mocked `window.colrev`/`window.git` bridge (one shared typed mock built on the generated schema from WP-03 — so store tests break when the contract changes, which is the point).
- Seed tests for the highest-risk store logic, aligned with WP-05/07 work: request-guard/epoch behavior, post-write invalidation fan-out, `git` snapshot subscription, `managedReview` "fetch failed ≠ no tasks".
- Component tests only for logic-heavy shared components (ConflictResolutionDialog, OperationButton, step shells) — not pixel tests.

### 2. GitHub client contract tests

- One shared test suite run against **both** `FakeGitHubClient` and (recorded/mocked-HTTP) `RealGitHubClient`, pinning: `parseOwnerRepo` accepted formats, `addRepoCollaborator` invited/already-collaborator semantics, `listReleases` error behavior, and `createRepoAndPush` outcomes. Delete the fake's private `parseOwnerRepo` — share the real one.
- Decide and document what the fake is *for* (protocol-level double for e2e) and keep its surface minimal.

### 3. Python handler coverage

- Extend the `tests/4_jsonrpc` pattern to the missing handlers, prioritized by risk: `load`, `pdf_get`, `pdf_prep` (they mutate records + fs), `data`, `review_definition`, `init`, then the trivial ones.
- Add the cross-cutting dispatcher tests WP-01/02 introduce (precondition policy per method; progress emission reaches the wire; `_serialize` rejects dicts).

### 4. e2e reliability

- `retries: 1` minimum in CI (flake signal is still visible via retry counts; red-on-any-flake at `retries: 0` just trains people to ignore the suite).
- Split the monolithic serial run where possible: specs already own isolated workspaces via the fixture; evaluate `workers: 2` locally / CI matrix per spec file to cut wall-clock.
- Add the two regression e2e cases from earlier packages if not yet landed: decisions-survive-branch-switch (WP-07), progress-events-during-search (WP-02).
- Document the snapshot-cache rebuild flow (`BUILD_FIXTURES=1`) in `e2e/README.md` so cache invalidation is a known cost, not a surprise.

### 5. CI assembly

- One workflow running: Python handler tests, vitest (node + dom projects), contract suite, schema-drift check (WP-03), `tsc`/`vue-tsc`, and e2e (possibly on a schedule/label if too slow per-PR). Fail-fast ordering: cheap checks first.

## Acceptance criteria

- `pnpm test` runs store tests headlessly; a deliberately broken invalidation fan-out fails a unit test (not just e2e).
- Contract suite passes against both GitHub clients; the fake's file-path `parseOwnerRepo` divergence is resolved (shared parser + explicit test-only extension if still needed).
- Handler coverage: every registered RPC method has at least one test exercising its happy path + one failure mode (enforced by a registry-driven meta-test that fails on untested methods).
- CI runs the full ladder; e2e flake rate observable via retry stats.

## Out of scope

- Rewriting existing e2e specs; visual regression testing.

## Dependencies

- WP-03 (generated-schema mock), WP-05/07 (the store logic worth testing lands there). Infrastructure (§1, §2, §5) can start anytime — earlier is better; consider pulling §1 forward if WP-05 wants to TDD its stores.
