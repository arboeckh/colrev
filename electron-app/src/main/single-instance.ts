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
 */
export function acquireSingleInstance(
  app: SingleInstanceApp,
  onSecondInstance: () => void,
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', onSecondInstance);
  return true;
}
