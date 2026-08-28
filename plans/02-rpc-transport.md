# WP-02: Honest RPC Transport — Lifecycle, Timeouts, Structured Errors, Progress

## Context

The Electron↔Python seam (`electron-app/src/main/colrev-backend.ts` ↔ `colrev/ui_jsonrpc/server.py`) presents itself as a typed, concurrent, progress-reporting API. In reality it is a strictly serial pipe with no crash recovery, a flat 120s timeout, string-flattened errors, and a progress channel that is discarded wholesale. This package makes the transport's interface match its actual semantics.

## Problems being fixed

1. **Progress events go to `/dev/null`.** The dispatcher redirects OS fd 1 to devnull for the duration of every project-scoped handler (`dispatcher.py:136-139`, restored in `finally` at `:162-165`) to protect the JSON-RPC wire. But the progress emitter writes via `sys.stdout` (`framework/events.py:46-47`) — which *is* fd 1 — and handlers emit progress exactly inside that window. Every progress notification during search/prep/dedupe/pdf_get is silently dropped. The whole renderer progress pipeline (`preload/index.ts:57-61`, `stores/backend.ts:81-121`) is dead code; bars jump 0→done.
2. **Crash strands callers.** On process `close`, `colrev-backend.ts:115-118` calls `cleanup()` which does **not** reject the `pending` map (only `stop()` does, `:252-262`). A Python crash mid-request leaves the UI spinning for the full 120s timeout. There is no supervision/auto-restart: `index.ts:222-225` nulls the backend and every later call throws `Backend not running` until app restart.
3. **Timeout lies.** Flat 120s timeout for all methods (`colrev-backend.ts:225`). Long ops (big searches, pdf_get) legitimately exceed it: the request rejects, but the op **completes and commits on disk**; the late response is silently dropped (`:283-284`). UI says "failed", repo says "done".
4. **Head-of-line blocking hidden by a fake fast lane.** The Python server is a strict FIFO of one (`server.py:68-79`). The `GIT_FREE_RPC_METHODS` bypass in `index.ts:60-67` only skips the *JS-side* mutex — a `get_git_status` or `ping` still queues inside Python behind a 90s search. The UI freezes behind any long op, invisibly.
5. **Errors flattened.** Python emits structured `{code, message, data}` (`error_handler.py:78-108`), but the bridge rejects with `new Error(\`${code}: ${message}\`)` (`colrev-backend.ts:298-300`), dropping `code`/`data`. Coarse mapping upstream: any `ValueError` → `-32602 INVALID_PARAMS` (`error_handler.py:41-42`). No call site can distinguish "locked" from "invalid" from "crashed" except by regexing strings.

## Scope of work

### 1. Fix the progress channel (small, do first)

- The dispatcher already saves the real stdout fd (`saved_stdout_fd`). Create the transport handle **once at server startup**: `dup` fd 1 before any redirect, `os.fdopen` it, and make both `write_jsonrpc_response` and the progress emitter write through that handle exclusively. The per-request devnull redirect then only affects stray third-party writes, never the wire.
- Add a regression test: a handler that emits progress inside a project-scoped dispatch; assert the notification reaches the client side (or a captured pipe).

### 2. Lifecycle: reject-on-close + supervised restart

- `close` handler must reject all `pending` with a distinct `BackendCrashedError` before cleanup.
- Add supervision in `index.ts`/`ColrevBackend`: on unexpected exit, auto-restart with capped exponential backoff (e.g. 3 attempts), emit a renderer event so `stores/backend.ts` can show "backend restarting…" instead of dying to `stopped` forever. After restart, the renderer must treat all project state as stale (hook into WP-05's invalidation seam; until then, trigger the existing `refreshCurrentProject`).

### 3. Timeouts that match reality

- Per-method timeout classes on `MethodSpec`/schema (fast: 10s — status/queues/reads; slow: none-or-long — search, pdf_get, prep, dedupe, load, reconcile). Export through the generated schema so TS picks them up without a second hand-maintained list (ties into WP-03).
- For slow methods, prefer **no timeout + liveness**: rely on progress events (now working, §1) and process-alive checks rather than an arbitrary cap. If a cap is kept, on expiry do not just reject — mark the op "still running server-side" so the UI can reconcile when the response eventually arrives instead of silently dropping it.

### 4. Make serialization visible (and honest)

- Keep the Python server serial for now (the `os.chdir` + fd-redirect globals in `dispatcher.py:131-165` force it; removing chdir by passing explicit paths is the future unlock — record as an ADR, don't do it here).
- Move the queue to the TS side where it can be observed: `ColrevBackend` maintains an explicit FIFO with the in-flight method name exposed. `stores/backend.ts` surfaces "waiting on: search" so the UI shows *why* it's busy instead of freezing.
- Delete the misleading `GIT_FREE_RPC_METHODS` fast-lane concept in `index.ts:60-67` or re-scope it to what it truly is (JS-mutex exemption only), with a comment stating Python is serial.

### 5. Structured errors end-to-end

- Bridge: reject with a typed `RpcError extends Error { code: number; data?: unknown; method: string }` preserving the wire fields.
- Preload/renderer: `stores/backend.ts` catches `RpcError` and exposes `code`-based handling; add the `PRECONDITION_FAILED` mapping from WP-01 ("commit or discard changes first" UX).
- Python: fix the coarse mapping in `error_handler.py:41-46` — domain errors (not-found, locked, precondition) get their own codes instead of `-32602`.

## Acceptance criteria

- Progress bars advance during a real `search`/`pdf_get` run (verify via e2e or the rpc.jsonl trace showing `progress` notifications between request and response).
- Kill -9 the Python process mid-request: all pending calls reject within ~1s with `BackendCrashedError`; backend restarts automatically; next RPC succeeds.
- A deliberately slow method no longer produces "timeout + succeeded on disk" divergence: either it completes (no cap) or the late response is reconciled, never silently dropped.
- Renderer can branch on `error.code`; no new string-matching on error messages.
- Unit tests for `ColrevBackend` (it is pure Node — spawn a fake child script): pending-rejection on close, restart, queue order, RpcError mapping.

## Out of scope

- True Python-side concurrency (needs chdir removal — ADR only).
- Cancellation of running operations (note as future work; requires engine cooperation).
- Renderer freshness reactions beyond wiring the restart event (WP-05).

## Dependencies

- Benefits from WP-01's new error codes existing, but shippable independently.
