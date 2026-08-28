# WP-04: Engine-Owned Merge — Delete `semantic-merge.ts`

## Context

Merging `records.bib` is engine work: colrev core ships a real record-level 3-way merge (`colrev/ops/merge.py`) that uses the real BibTeX loader, tolerates only status divergence, reconciles per record, updates `status.yaml`, and computes inter-rater agreement. The app never calls it. Instead, the collaborator-sync flow reimplements merging in 798 lines of regex TypeScript (`electron-app/src/main/semantic-merge.ts`) — the single scariest untested module in the codebase — orchestrated by an untestable inline IPC lambda.

Two gaps in core's merge explain (but no longer justify) the TS reimplementation: resolution is interactive-CLI (`input()` at `merge.py:216`) and it cannot create the merge commit itself (`merge.py:248-254`). Both are fixable with a small non-interactive hook, which also serves WP-01's reconciliation notes.

## Problems being fixed

1. **Regex BibTeX parsing.** `semantic-merge.ts:372` splits records on `/^@\w+\{([^,]+),/gm`; fields via `/title\s*=\s*\{([^}]*)\}/` (`:387-391`). `[^}]*` truncates at the first `}` — any nested brace (`{A {Nested} Title}`) mis-parses; `@` inside values mis-splits records. Zero unit tests; only reachable through one e2e spec.
2. **Divergent merge semantics.** TS flags a conflict whenever raw record blocks differ but surfaces only `colrev_status` in the UI (`semantic-merge.ts:500-504`), while `applyResolutions` swaps the **entire record block** (`:779`) — silently clobbering the other side's non-status edits. Core would refuse and ask. The TS path also never updates `data/status.yaml` nor runs merge validation, so it commits inconsistent project state.
3. **Hardcoded `origin/dev` on a flow triggered from any branch.** `index.ts:497,506,561` and `semantic-merge.ts:659` all assume `origin/dev`, but `git.ts:pull()` starts divergence resolution for **any** branch that reports `DIVERGED` (`stores/git.ts:147-149`). A diverged `main` or `review/*` branch gets analyzed/merged against `origin/dev` — wrong base, wrong side.
4. **Untestable orchestration.** `git:apply-merge` (`index.ts:531-606`) is ~75 lines of merge/write/stage/commit/push/abort logic inside an inline IPC lambda; its rollback behavior has no automated coverage. Its push-failure path reports `{success: true, pushFailed: true}` and the UI promises a retry that does not exist (`index.ts:593-597`, `stores/git.ts:632`).

## Scope of work

### 1. Non-interactive merge API in core (small, defensible patch)

- Refactor `colrev/ops/merge.py` so the conflict-resolution loop accepts a resolver callback / prepared-decisions dict instead of calling `input()` directly (CLI keeps a thin `input()` resolver — behavior unchanged for CLI users). Expose "analyze" (list per-record disagreements + non-status blockers) separately from "apply" (write resolved records).
- Parameterize the branch/remote-ref explicitly everywhere (it already takes `branch`; ensure no `dev` assumptions leak in).
- Document as a core patch in `colrev/PATCHES.md` (WP-01).

### 2. New RPC methods in `ui_jsonrpc`

- `analyze_merge {project_id, ours, theirs}` → structured report: `{ auto_mergeable, status_conflicts: [{id, ours, theirs, label fields}], blockers: [{id, reason}] , settings_conflict: bool }`. Uses core's loader — no TS parsing of bib content anywhere.
- `apply_merge {project_id, theirs, resolutions: {id: "ours"|"theirs"}}` → performs the merge via core, updates `status.yaml`, runs `validate_merge_prescreen_screen`, stages everything, creates the merge commit (via `create_commit` or plain git commit with the merge parents so history reflects a real merge — this restores compatibility with `colrev validate --merge` agreement reporting).
- `settings.json` conflicts: core's merge ignores them (`merge.py:143-147`). Add a minimal wrapper-side settings reconciliation in the same handler (field-level, using real JSON parsing — port only the *decision UI* concept from `analyzeSettingsConflict`, not the implementation).

### 3. Replace the Electron flow

- `git:analyze-divergence` / `git:apply-merge` IPC handlers become thin: fetch (dugite) → call the two RPCs → push. Move them out of inline lambdas into a testable module (e.g. `merge-flow.ts`) with an injected git + backend interface (start of the WP-07 pattern for `index.ts`).
- Pass the actual current branch + tracking ref from the renderer's pull flow; delete every `origin/dev` literal.
- Fix push-failure semantics: either implement the promised retry (queue a push on next successful sync) or report honestly ("merged locally, push failed — retry from the sync menu"). No `{success: true}` on failure.
- Delete `semantic-merge.ts` and its types once the flow is switched. The conflict-resolution dialog (`ConflictResolutionDialog.vue`) re-targets the `analyze_merge` report shape.

### 4. Tests

- Python: unit tests for analyze/apply on fixture repos — status-only divergence (auto), included-vs-excluded conflict (needs resolution), non-status drift (blocked), nested-brace titles (the regex killer — now parsed correctly by the real loader).
- TS: unit tests for the orchestration module with a fake backend/git (happy path, merge-fails, push-fails rollback).

## Acceptance criteria

- `semantic-merge.ts` deleted; `grep -r "origin/dev" electron-app/src` returns nothing.
- Two-collaborator e2e (`fake-github.spec.ts` / prescreen-2-reviewer flow) passes with the new path.
- A record titled `{A {Nested} Title}` survives a divergence merge byte-identically.
- After an app-driven merge, `git log` shows a 2-parent merge commit and `colrev validate --merge` reports agreement stats on it.
- `status.yaml` is consistent with `records.bib` after every merge (assert via `check_repo` in tests).

## Out of scope

- Managed-review reconciliation (stays blob-based per WP-01 — it is not a git merge by design; revisit later if you want `validate --merge` to cover it too).
- The broader `index.ts` god-module breakup (WP-07 continues the extraction pattern started here).

## Dependencies

- WP-02's structured errors improve failure UX here but are not blocking. Independent of WP-01/03 in code.
