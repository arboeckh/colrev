import { describe, it, expect, vi } from 'vitest';
import { acquireSingleInstance, type SingleInstanceApp } from './single-instance';

/** The held locks of every fake `app`, which a test can release, as an exiting instance does. */
const held = new Set<string>();
const lockControl = { releaseLock: (userData: string) => held.delete(userData) };

/** Fake `app`: the lock is shared per userData directory, like Electron's. */
function fakeApps() {
  held.clear();
  const make = (userData: string) => {
    const listeners: (() => void)[] = [];
    const quit = vi.fn();
    const app = {
      requestSingleInstanceLock: () => {
        if (held.has(userData)) return false;
        held.add(userData);
        return true;
      },
      quit,
      on: (_event: 'second-instance', listener: () => void) => {
        listeners.push(listener);
      },
      secondInstance: () => listeners.forEach((l) => l()),
    } satisfies SingleInstanceApp & { secondInstance(): void };
    return app;
  };
  return make;
}

describe('acquireSingleInstance', () => {
  it('quits a second instance that shares the user-data dir and tells the first one', () => {
    const make = fakeApps();
    const onSecond = vi.fn();
    const first = make('/ud/colrev');
    const second = make('/ud/colrev');

    expect(acquireSingleInstance(first, onSecond)).toBe(true);
    expect(acquireSingleInstance(second, vi.fn())).toBe(false);

    expect(first.quit).not.toHaveBeenCalled();
    expect(second.quit).toHaveBeenCalledOnce();

    first.secondInstance();
    expect(onSecond).toHaveBeenCalledOnce();
  });

  it('lets an instance with a different user-data dir start', () => {
    const make = fakeApps();
    const alice = make('/ud/colrev-alice');
    const bob = make('/ud/colrev-bob');

    expect(acquireSingleInstance(alice, vi.fn())).toBe(true);
    expect(acquireSingleInstance(bob, vi.fn())).toBe(true);
    expect(bob.quit).not.toHaveBeenCalled();
  });

  it('waits for the lock when asked, for an instance that is replacing another', () => {
    const make = fakeApps();
    const old = make('/ud/colrev');
    const replacement = make('/ud/colrev');
    expect(acquireSingleInstance(old, vi.fn())).toBe(true);

    // The old instance exits, and lets go of the lock, after the third try.
    let slept = 0;
    const sleep = (ms: number) => {
      slept += ms;
      if (slept === 600) lockControl.releaseLock('/ud/colrev');
    };
    expect(acquireSingleInstance(replacement, vi.fn(), { waitMs: 5000, retryMs: 200, sleep })).toBe(true);
    expect(slept).toBe(600);
    expect(replacement.quit).not.toHaveBeenCalled();
  });

  it('gives up after waiting', () => {
    const make = fakeApps();
    expect(acquireSingleInstance(make('/ud/colrev'), vi.fn())).toBe(true);
    const late = make('/ud/colrev');
    const sleep = vi.fn();
    expect(acquireSingleInstance(late, vi.fn(), { waitMs: 1000, retryMs: 250, sleep })).toBe(false);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(late.quit).toHaveBeenCalledOnce();
  });
});

