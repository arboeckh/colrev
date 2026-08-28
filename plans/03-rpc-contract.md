# WP-03: One RPC Contract — Generated Types Only, CI-Enforced

## Context

The RPC contract exists in three copies: the Pydantic models (truth), the generated `rpc.d.ts`/`rpc-schemas.json` (accurate mirror, barely used), and the hand-written `types/api.ts` (used everywhere, already wrong). Nothing validates responses at runtime and nothing in CI keeps the copies in sync. Result: the compiler actively vouches for shapes that are wrong on the wire, producing `undefined`-at-point-of-use bugs.

## Problems being fixed

1. **Hand-written types drift.** `electron-app/src/renderer/types/api.ts` (861 lines) is imported by ~35 renderer files; the generated `types/generated/rpc.d.ts` by only 3 (`stores/backend.ts`, `git.ts`, `pendingChanges.ts`). Confirmed drift: `api.ts:209-212` declares `SearchResponse = { success, source, rerun }` while Python returns `{ success, project_id, operation, message, details: { source, rerun, message } }` (`search_handler.py:60-63`). Any code reading `resp.source` gets `undefined` with full compiler approval.
2. **No CI guard.** `gen-types:full` (`electron-app/package.json:43-44`) is a manual two-step (`export_rpc_schemas.py` → `gen-rpc-types.ts`); no workflow runs it. Changing a Pydantic model and forgetting regeneration leaves the committed schema and all TS types silently stale.
3. **Loose serialization escape hatches.** `model_dump(exclude_none=True)` (`dispatcher.py:172`) makes nullable fields vanish from the wire, which pushed `get_operation_info` to bypass its response model and return a raw dict (`status_handler.py:233-238`); the dict branch in `_serialize` (`dispatcher.py:173-174`) then skips response typing entirely.
4. **`WRITER_METHODS` correctness depends on the schema.** The renderer's post-write refresh triggers off `writes: true` flags in the generated schema (`stores/backend.ts:15-19, 230`). A mutating method not flagged `writes` gets no refresh at all — the schema is load-bearing beyond types.

## Scope of work

### 1. Make the generated types the only types

- Migrate all ~35 importers of `api.ts` RPC shapes to the generated types via the existing typed `call<M>` overload (`stores/backend.ts:272-275`). Prefer making `call` *only* accept known method names + typed params/results; delete the generic `call<T>` fallback (or restrict it to a clearly-named `callUntyped` used nowhere in views).
- Delete the RPC request/response interfaces from `api.ts`. Keep genuinely renderer-local types (UI view-models) — move them to a differently-named module so "api" can't silently reaccumulate wire types.
- Fix call sites that were reading drifted shapes (each is a latent bug being surfaced — e.g. the `SearchResponse.details` nesting).

### 2. CI enforcement

- Add a CI step (and a make/npm script for local use): run `export_rpc_schemas.py` + `gen-rpc-types.ts`, then `git diff --exit-code` on `rpc-schemas.json` + `rpc.d.ts`. Fails when Python models changed without regeneration.
- Run `vue-tsc`/`tsc --noEmit` in the same job so a regenerated schema that breaks renderer code fails visibly at the PR, not at runtime.

### 3. Tighten serialization

- Decide the null policy once: drop `exclude_none=True` in `_serialize` (`dispatcher.py:172`) so nullable fields arrive as `null`, matching the generated optional types; or keep it and encode optionality accurately in the schema. Dropping is preferred — it removes the raw-dict escape hatch.
- Convert `get_operation_info` (and any other dict-returning handler — audit via `_serialize`'s dict branch) back to proper response models; then make `_serialize` **reject** plain dicts (delete the migration helper branch, `dispatcher.py:173-178`).
- Audit `writes` flags on every method against what the handler actually does to disk (one-time pass; add a comment convention that any handler committing/saving must set it).

### 4. Optional: dev-mode response validation

- In development builds only, validate responses against `rpc-schemas.json` (ajv in the preload or main) and log loudly on mismatch. Cheap insurance for the next drift; skip in production for perf.

## Acceptance criteria

- `grep -r "from.*types/api" src/renderer` shows no RPC wire types imported; views compile against generated types only.
- Deliberately changing a Pydantic response field without regenerating fails CI.
- `_serialize` raises on non-model returns; no handler returns a raw dict.
- The `SearchResponse` drift bug (and any others surfaced by the migration) fixed with the correct `details.` access.
- `writes` audit documented in the PR (list of methods checked, any flags corrected).

## Out of scope

- Runtime validation in production.
- Redesigning payload shapes (this package syncs, it does not redesign; shape changes belong in the packages that own those methods).

## Dependencies

- None hard. Do after WP-02 so `RpcError` typing can be included in the same `call<M>` signature cleanup. Small enough to interleave.
