# ADR 0006: Review-walkthrough navigation is optimistic; the backend catches up

## Status

Accepted (2026-09)

## Context

Prescreen and screen are the two surfaces where a reviewer makes hundreds of
decisions in a sitting. Both were built to advance to the next record only
*after* `prescreen_record` / `screen_record` returned. Under ADR-0001 the
Python backend is strictly serial, and under ADR-0002 every writer RPC pulls a
refresh tail behind it, so "one decision" was never one round trip.

Measured on a real project (16 records, macOS, GitHub remote):

| operation | cost |
| --- | --- |
| `prescreen_record` | 130-220 ms |
| `get_git_status` | 180-380 ms |
| `get_status` | 170-360 ms |
| `git fetch` (GitHub) | 320-730 ms |

A single decision therefore cost the write, plus an immediate
`get_git_status`, plus — 400 ms later, on the seam's debounce — a full project
re-derivation whose `managedReview.refresh()` did an unconditional `git fetch`.
Every one of those held the main-process git mutex, so the *next* decision's
RPC queued behind them. Clicking Include took 1-3 s to show the next abstract
on an eight-record queue, and none of that time was spent on the decision
itself.

Entering the review step was worse: 28 serialized operations, four of them
network fetches, most of them duplicates. `switchBranch` reloaded the project
and then invalidated it (reloading it again); the invalidation re-ran the
page's own access check, which reloaded the queue a second time; and
`managedReview.refresh()` fetched on each of those passes.

The record count makes all of this steeper, because every project-scoped call
re-parses `data/records.bib`. At 5,000 records `get_prescreen_queue` took 6.6 s
and one `prescreen_record` 3.7 s — a second, independent problem (addressed
under Consequences). At eight records the entire delay was orchestration.

## Decision

### The click and the write are separated

A decision is applied to the local queue and the walkthrough advances
immediately. The write is flushed on a per-page promise chain, so decisions
still reach the backend strictly in click order — a parallel fan-out would let
two writes race for the same `records.bib`.

This is a real trade of consistency for latency, and the budget it spends is
the time the reviewer takes to read the next abstract. Two things still wait:

- **The last decision of a queue.** What the screen shows next (another page
  of records, or the completion counts) is a backend fact, so that one
  decision blocks — and it is the one place a spinner is honest.
- **A failed write**, which rolls the record back to `undecided`, restores the
  remaining count, and raises a notification. The reviewer sees the record
  return to the queue rather than losing a decision silently.

While writes are still queued, the server's `remaining_count` describes the
tree as of *that* write and lags the optimistic count; it is adopted only once
the chain drains, so the "remaining" badge never counts back up.

### `git fetch` is opt-in, not a side effect of refreshing

`managedReview.refresh()` no longer fetches by default. Task *membership* only
changes when someone launches or reconciles a task, so local refs are the right
answer on the write path; ADR-0004's background fetch keeps them current.
Callers that specifically need another reviewer's progress — arriving at the
managed-review workflow page, opening the reconciliation panel — ask for the
fetch explicitly.

### Each entry does one pass

`switchBranch` no longer calls `projects.loadProject()` before
`invalidateAll()`; the invalidation is the one reload. And because
`ensureManagedTaskAccess` *causes* a full invalidation (checking out the
reviewer branch replaces the working tree), the page guards its own re-entry
so the access probe, checkout and queue load happen once per entry rather than
twice.

Entry now costs 18 serialized operations with 2 fetches, down from 28 with 4.
`managed-review-entry-cost.test.ts` holds that as a budget: exceeding it means
a duplicate pass has come back, and the failure names the call that multiplied.

## Consequences

- The queue on screen can be momentarily ahead of `records.bib`. Anything that
  reads the tree directly (the sync coordinator's cleanliness checks, the
  commit button) sees the pre-write state for up to one RPC. Both already
  tolerate this: the seam refreshes git state after every write, and ADR-0004
  holds sync off during a walkthrough anyway.
- Navigation is no longer a signal that a decision was saved. The completion
  screen, which reads server-side counts, is.
- A reviewer who closes the app mid-streak can lose the last unflushed
  decision. The window is one RPC (~200 ms) rather than the seconds it takes
  to read an abstract, so it is smaller than the equivalent window under the
  old shape — but it is not zero.
- The per-call cost of parsing `records.bib` — O(records) on every
  project-scoped call — bounded how fast the backend could drain a streak even
  once the click stopped waiting for it. That is now cached in
  `colrev/dataset.py` (registered in `colrev/PATCHES.md`): the parsed dict is
  held process-wide, keyed on the file's `(mtime_ns, size)`, and writers update
  the entry rather than dropping it. It has to be process-wide because the
  dispatcher builds a fresh `ReviewManager` per request, so an instance-level
  cache would never be read twice. At 5,000 records `get_prescreen_queue` went
  6.6 s → 0.3 s warm and `prescreen_record` 3.7 s → 1.0 s; the remaining floor
  is the deep copy handed to each caller (~325 ms) plus the in-place file
  rewrite (~380 ms).
- That cache lives in vendored core rather than the RPC layer deliberately —
  the app already reaches into core internals once (`install_lazy_git_repo`),
  and a second white-box patch is worse than a change the patch registry
  tracks and upstream could absorb.
