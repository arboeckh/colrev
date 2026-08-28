# Architectural Hardening — Work Package Overview

Origin: full architectural review (2026-07-22) of the Electron/Vue frontend + `ui_jsonrpc` layer wrapping the colrev engine. The review found the bugs cluster around three systemic causes:

1. **The wrapper doesn't trust the engine** — it reimplements colrev's state machine, merge, loaders, and status math, and disables the engine's precondition checks globally (`interactive_mode`).
2. **The RPC seam's interface lies** — it looks typed, concurrent, and progress-reporting; it is actually unvalidated, strictly serial, drops progress events, and flattens errors to strings.
3. **State freshness is nobody's job** — three refresh mechanisms, triple-cached git status, async responses applied without staleness guards.

A follow-up analysis confirmed the branch-per-reviewer managed-review workflow is **compatible** with the engine (colrev is branch-agnostic and has a native two-branch reconciliation primitive, `ops/merge.py`). The friction that motivated the workarounds is narrow: per-call statelessness vs. the engine's session model, interactive-CLI-only merge resolution, and no engine support for screen-criteria reconciliation. Each has a narrower fix than the current bypasses.

## Packages, in order

| # | File | Theme | Size |
|---|------|-------|------|
| 01 | `01-engine-preconditions.md` | Re-enable the engine's safety net; route all state writes through operations; move `managed_review.py` out of core | M |
| 02 | `02-rpc-transport.md` | Honest RPC transport: crash recovery, timeouts, structured errors, fix dead progress channel | M |
| 03 | `03-rpc-contract.md` | One type contract: generated types only, CI enforcement | S–M |
| 04 | `04-engine-owned-merge.md` | Delete `semantic-merge.ts`; merge/reconcile through `ops/merge.py` | L |
| 05 | `05-renderer-freshness.md` | Single data-freshness mechanism + request guards in the renderer | M–L |
| 06 | `06-status-derivation.md` | Status derived once, from the engine | M |
| 07 | `07-git-state-ownership.md` | One owner for git state; mutex coverage; sync error handling; stash-stranding fix | M–L |
| 08 | `08-test-architecture.md` | Store/component testability, contract tests, handler coverage | M |

## Ordering rationale & dependencies

- **01 first**: highest bug-impact-per-effort. Restoring preconditions converts silent state corruption into clean, attributable errors at the seam — which also makes every later package easier to debug.
- **02–03 next**: they make the seam honest (lifecycle, errors) and typed (single contract). All renderer work in 05–07 builds on being able to trust errors and types.
- **04** is independent of 01–03 in code but benefits from 02's structured errors; it removes the single scariest untested module.
- **05–06** are renderer-side; 05 before 06 because the freshness seam is where the single status snapshot will flow through.
- **07** touches main-process git; depends conceptually on 04 (merge flow moves to engine) and 05 (renderer subscribes instead of caching).
- **08** is infrastructure; individual test additions should also land *inside* packages 01–07 (each has acceptance criteria including tests). 08 covers the shared tooling and the gaps left over.

Cross-cutting rule for all packages: **wrapper owns orchestration and UX; engine owns every record state transition and every merge of `records.bib`.** When a package is tempted to re-derive engine behavior, widen the engine's interface instead (small, upstream-defensible patches to core are allowed; blanket bypasses are not).
