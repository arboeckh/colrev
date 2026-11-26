/** The part of Electron's `app` that single-instance handling uses. */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): unknown;
}

/**
 * Take the single-instance lock. Electron keys the lock on the `userData`
 * directory, so this must run after `userData` is final (COLREV_USER,
 * `--user-data-dir`): instances with different directories do not collide,
 * which `dev:alice`/`dev:bob` and the e2e suite rely on.
 *
 * Returns false (and quits) when another instance with the same `userData`
 * holds the lock; otherwise `onSecondInstance` runs whenever one tries.
 *
 * `waitMs` waits that long for the lock, trying again every `retryMs`, before
 * giving up: the preview's `electron-vite dev --watch` starts the new instance
 * while the one it is replacing is still shutting down, and a new instance that
 * quit at once would end electron-vite, and the preview with it.
 */
export function acquireSingleInstance(
  app: SingleInstanceApp,
  onSecondInstance: () => void,
  { waitMs = 0, retryMs = 200, sleep = sleepSync }: AcquireOptions = {},
): boolean {
  let locked = app.requestSingleInstanceLock();
  for (let waited = 0; !locked && waited < waitMs; waited += retryMs) {
    sleep(retryMs);
    locked = app.requestSingleInstanceLock();
  }
  if (!locked) {
    app.quit();
    return false;
  }
  app.on('second-instance', onSecondInstance);
  return true;
}

export interface AcquireOptions {
  waitMs?: number;
  retryMs?: number;
  sleep?: (ms: number) => void;
}

/** Blocks the thread for `ms`: the main process has nothing to do before it holds the lock. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
