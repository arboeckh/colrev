# ADR 0001: The Python JSON-RPC backend stays serial; the queue lives in TypeScript

## Status

Accepted (2026-08, WP-02)

## Context

The Electron app talks to colrev through a stdio JSON-RPC server
(`colrev/ui_jsonrpc/server.py`). That server processes requests strictly one
at a time: the loop in `run_stdio_server` reads a request, dispatches it, and
writes the response before reading the next line.

Serial execution is not an accident — it is forced by two pieces of global
process state the dispatcher mutates per request
(`colrev/ui_jsonrpc/framework/dispatcher.py`, `_dispatch_project_scoped`):

1. **`os.chdir(project_path)`** — colrev core resolves many paths relative to
   the current working directory, so every project-scoped handler chdirs into
   the project and back. Two concurrent requests would race the cwd.
2. **OS-level fd 1 redirect** — fd 1 is redirected to `/dev/null` for the
   duration of each handler so stray writes (third-party libraries, child
   processes) cannot corrupt the JSON-RPC stream. This is also global.

Earlier versions hid the serialism: a `GIT_FREE_RPC_METHODS` "fast lane" in
the Electron main process skipped the JS-side git mutex, which looked like
concurrency but only changed where a request waited — every request still
queued inside Python behind whatever was running.

## Decision

- **Keep the Python server serial.** Do not add threading/asyncio around the
  dispatcher while the chdir + fd-redirect globals exist.
- **Make the serialism visible instead of pretending it away.** The queue is
  owned by `ColrevBackend` (Electron main, `src/main/colrev-backend.ts`):
  strictly one request in flight on the pipe, with `rpc-queue` events
  exposing the in-flight method and the waiting list so the renderer can
  show *why* it is busy.
- **`GIT_FREE_RPC_METHODS` is re-scoped** to what it truly is: an exemption
  from the JS-side git mutex shared with dugite handlers — not a bypass of
  the Python queue.
- Responses and progress notifications are written through a private dup of
  the original fd 1 (`colrev/ui_jsonrpc/transport.py`), so the per-request
  devnull redirect only affects writers that were never supposed to touch
  the wire.

## Consequences

- A cheap read (e.g. `get_git_status`) issued during a long `search` waits
  for the search to finish. This is inherent until the globals go away; the
  UI can at least display "waiting on: search".
- Client-side timeouts cap *processing* time only for methods classed
  `fast`; `slow` methods have no cap, because a capped-but-still-running
  operation produces "UI says failed, repo says done" divergence.

## Future unlock (not this ADR)

True request concurrency requires removing the globals:

- Pass explicit paths into colrev core instead of relying on `os.chdir`
  (a colrev-core change — out of bounds for the UI layer).
- Route all wire writes through the transport handle (done) so the fd
  redirect can eventually be dropped entirely, or scoped per-subprocess.

When that lands, the dispatcher could run handlers on worker threads and the
TS queue could allow bounded parallelism for read-only methods.
