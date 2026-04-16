/**
 * Single-process async mutex that serializes every path to the git repo from
 * the main process — both dugite IPC handlers (`git:*`) and JSON-RPC calls
 * forwarded to the Python backend (`colrev:call`). Guarantees one caller at a
 * time so `.git/index.lock` can't be contested between the two git runtimes.
 *
 * FIFO via a single promise chain. `acquire()` resolves when the slot is
 * exclusive; the returned callback releases it. Always call release in a
 * `finally` — a leaked release would wedge every subsequent git operation.
 */

type Release = () => void;

let chain: Promise<void> = Promise.resolve();
let holdStart: number | null = null;
let holdLabel: string | null = null;

const SLOW_HOLD_MS = 2000;

export function acquire(label: string): Promise<Release> {
  let release!: Release;
  const next = new Promise<void>((resolve) => {
    release = () => {
      if (holdStart !== null) {
        const ms = Date.now() - holdStart;
        if (ms >= SLOW_HOLD_MS) {
          console.warn(`[gitMutex] slow hold: ${holdLabel} held for ${ms}ms`);
        }
      }
      holdStart = null;
      holdLabel = null;
      resolve();
    };
  });

  const waitFor = chain;
  chain = next;

  return waitFor.then(() => {
    holdStart = Date.now();
    holdLabel = label;
    return release;
  });
}

/**
 * Convenience wrapper: acquire, run fn, release (even on throw).
 */
export async function withGitLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquire(label);
  try {
    return await fn();
  } finally {
    release();
  }
}

const LOCK_ERROR_PATTERNS: RegExp[] = [
  /index\.lock/i,
  /Unable to create .*\.lock/i,
  /File exists.*\.lock/i,
];

const LOCK_RETRY_BACKOFFS_MS = [100, 300, 900];

function isLockErrorMessage(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return LOCK_ERROR_PATTERNS.some((p) => p.test(msg));
}

function isLockErrorResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as { success?: unknown; error?: unknown };
  if (r.success !== false) return false;
  return typeof r.error === 'string' && isLockErrorMessage(r.error);
}

/**
 * Run ``fn`` with transparent retry on `.git/index.lock` contention.
 *
 * External tools (user's terminal, IDE git, antivirus on Windows) can grab
 * the lock briefly; the mutex blocks our own paths but not theirs. We retry
 * with 100/300/900 ms backoff, then surface the original failure.
 *
 * Handles both thrown errors and `{ success: false, error }` result shapes
 * that dugite wrappers return.
 */
export async function withLockRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastResult: T | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt <= LOCK_RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) {
      const ms = LOCK_RETRY_BACKOFFS_MS[attempt - 1];
      console.warn(`[gitMutex] lock contention on ${label}; retry ${attempt} in ${ms}ms`);
      await new Promise((r) => setTimeout(r, ms));
    }
    try {
      const result = await fn();
      if (isLockErrorResult(result)) {
        lastResult = result;
        continue;
      }
      return result;
    } catch (err) {
      if (!isLockErrorMessage(err instanceof Error ? err.message : String(err))) {
        throw err;
      }
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return lastResult as T;
}
