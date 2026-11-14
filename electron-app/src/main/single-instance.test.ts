import { describe, it, expect, vi } from 'vitest';
import { acquireSingleInstance, type SingleInstanceApp } from './single-instance';

/** Fake `app`: the lock is shared per userData directory, like Electron's. */
function fakeApps() {
  const held = new Set<string>();
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
});
